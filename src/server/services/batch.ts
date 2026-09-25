/**
 * 批次操作（Phase 3-4 F）：搜尋結果批次改分類／加標籤／刪除。
 *
 * 三條硬規則：
 *   1. **批次刪除逐筆走既有的 `deleteTransactionIn()`**，不是 `deleteMany()`。
 *      基金額度、退款關聯、任務獎金入金、餘額調整、收據收回、AuditLog、軟刪除語意
 *      全部由那個函式決定，這裡一條都不重寫。
 *   2. **整批在同一個 `lockBook` + 同一個 DB transaction 內，任何一筆失敗就全部回滾**
 *      （docs/09 F 的原始設計），不會出現做到一半的金流變動。
 *   3. 批次只動**非金額欄位**：分類與標籤。金額、日期、帳戶、付款人、Payment、Split、
 *      Fund、Debt、交易型別一律不支援批次修改。
 */
import { prisma, lockBook, type Tx } from "../db";
import { assert, DomainError } from "../domain/errors";
import { MAX_BATCH, normalizeSelection } from "../domain/batch";
import { normalizeTags } from "../domain/search";
import { assertCanWrite, type BookContext } from "./books";
import { deleteTransactionIn, setTags } from "./ledger";
import { auditIn } from "./funds";

export { MAX_BATCH };

/** 可以批次改分類／加標籤的型別：與單筆編輯（`updateTransaction`）完全一致。 */
const EDITABLE_TYPES: string[] = ["EXPENSE", "INCOME"];

export interface BatchResult {
  /** 實際處理的筆數 */
  done: number;
  /** 使用者選了幾筆（去重之後） */
  selected: number;
}

/** 讀出這一批交易並確認每一筆都屬於目前帳本；不存在或跨帳本回同一個錯誤。 */
async function loadSelected(tx: Tx, ctx: BookContext, ids: string[]) {
  const rows = await tx.transaction.findMany({
    where: { id: { in: ids }, bookId: ctx.book.id },
    select: { id: true, type: true, categoryId: true, deletedAt: true, title: true },
  });
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  assert(missing.length === 0, "BATCH_NOT_FOUND", `有 ${missing.length} 筆紀錄找不到（可能已被刪除），請重新整理頁面再試`);
  return rows;
}

/**
 * 批次作廢。逐筆呼叫 `deleteTransactionIn()`，任何一筆不能刪就整批回滾並說明是哪一筆。
 * 已經作廢的紀錄會被 `deleteTransactionIn()` 視為重複送出而略過（與單筆行為一致）。
 */
export async function batchDeleteTransactions(ctx: BookContext, rawIds: readonly string[]): Promise<BatchResult> {
  assertCanWrite(ctx);
  const ids = normalizeSelection(rawIds);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const rows = await loadSelected(tx, ctx, ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      try {
        await deleteTransactionIn(tx, ctx, id);
      } catch (e) {
        // 整批回滾，但要讓使用者知道是哪一筆、為什麼
        const row = byId.get(id);
        const label = row?.title ? `「${row.title}」` : "其中一筆";
        const why = e instanceof DomainError ? e.message : "無法刪除";
        throw new DomainError(
          e instanceof DomainError ? e.code : "BATCH_FAILED",
          `${label}不能刪除：${why}。整批都沒有刪除，請取消選取它再試一次。`,
        );
      }
    }
    await auditIn(tx, ctx, "BATCH_DELETE", "Transaction", ctx.book.id, null, { count: ids.length });
    return { done: ids.length, selected: ids.length };
  });
}

/**
 * 批次改分類。只改 `categoryId`（非金額欄位），不動 Payment／Split／金額／日期。
 * 分類規則與單筆編輯相同：必須屬於本帳本、類型要相符、已停用的分類不能指派給紀錄。
 */
export async function batchSetCategory(
  ctx: BookContext,
  rawIds: readonly string[],
  categoryId: string | null,
): Promise<BatchResult> {
  assertCanWrite(ctx);
  const ids = normalizeSelection(rawIds);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const rows = await loadSelected(tx, ctx, ids);
    let category: { id: string; kind: string; name: string; isArchived: boolean } | null = null;
    if (categoryId) {
      category = await tx.category.findFirst({
        where: { id: categoryId, bookId: ctx.book.id },
        select: { id: true, kind: true, name: true, isArchived: true },
      });
      assert(category, "TX_CATEGORY", "分類不存在");
      assert(!category.isArchived, "TX_CATEGORY_ARCHIVED", `「${category.name}」已停用，請選擇其他分類`);
    }
    for (const row of rows) {
      assert(!row.deletedAt, "BATCH_DELETED", "選取的紀錄裡有已經作廢的，請重新整理頁面再試");
      assert(
        EDITABLE_TYPES.includes(row.type),
        "BATCH_NOT_EDITABLE",
        `${row.title ? `「${row.title}」` : "其中一筆"}是${row.type === "REFUND" ? "退款" : "轉帳、結算或餘額調整"}，不能批次改分類。整批都沒有變更。`,
      );
      if (category) assert(category.kind === row.type, "TX_CATEGORY_KIND", `「${category.name}」是${category.kind === "EXPENSE" ? "支出" : "收入"}分類，不能套用到${row.type === "EXPENSE" ? "支出" : "收入"}以外的紀錄`);
    }
    for (const row of rows) {
      if (row.categoryId === (categoryId ?? null)) continue; // 沒變就不用寫
      await tx.transaction.update({ where: { id: row.id }, data: { categoryId: categoryId ?? null, updatedById: ctx.me.userId } });
      await auditIn(tx, ctx, "UPDATE", "Transaction", row.id, { categoryId: row.categoryId }, { categoryId: categoryId ?? null });
    }
    await auditIn(tx, ctx, "BATCH_CATEGORY", "Transaction", ctx.book.id, null, { count: ids.length, name: category?.name ?? null });
    return { done: ids.length, selected: ids.length };
  });
}

/**
 * 批次加標籤（在既有標籤上疊加，不會蓋掉原本的）。
 * 標籤整理沿用 `normalizeTags()`，寫入沿用 `setTags()`，與單筆記帳同一套。
 */
export async function batchAddTags(ctx: BookContext, rawIds: readonly string[], rawTags: string | string[]): Promise<BatchResult> {
  assertCanWrite(ctx);
  const ids = normalizeSelection(rawIds);
  const adding = normalizeTags(rawTags);
  assert(adding.length > 0, "BATCH_TAGS_EMPTY", "請輸入要加上的標籤");
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const rows = await loadSelected(tx, ctx, ids);
    for (const row of rows) {
      assert(!row.deletedAt, "BATCH_DELETED", "選取的紀錄裡有已經作廢的，請重新整理頁面再試");
      assert(
        EDITABLE_TYPES.includes(row.type),
        "BATCH_NOT_EDITABLE",
        `${row.title ? `「${row.title}」` : "其中一筆"}不是支出或收入，不能批次加標籤。整批都沒有變更。`,
      );
    }
    for (const row of rows) {
      const existing = await tx.transactionTag.findMany({ where: { transactionId: row.id }, include: { tag: true } });
      const merged = normalizeTags([...existing.map((t) => t.tag.name), ...adding]);
      if (merged.length === existing.length && existing.every((t) => merged.includes(t.tag.name))) continue;
      await setTags(tx, ctx.book.id, row.id, merged);
      await auditIn(tx, ctx, "UPDATE", "Transaction", row.id, { tags: existing.map((t) => t.tag.name) }, { tags: merged });
    }
    await auditIn(tx, ctx, "BATCH_TAGS", "Transaction", ctx.book.id, null, { count: ids.length, tags: adding });
    return { done: ids.length, selected: ids.length };
  });
}
