/**
 * 分類管理（Phase 3-4 D）。
 *
 * 沿用既有的 `Category`（`isArchived` 就是停用），**沒有新增 schema 或 migration**。
 *
 * 分類管理完全不碰金流：不產生 Transaction／Payment／Split，不影響餘額、欠款、基金與 /stats 的金額。
 * 停用只是「新紀錄不能再選」，歷史交易的 `categoryId` 一個字都不會動。
 */
import { prisma, lockBook } from "../db";
import { assert } from "../domain/errors";
import {
  assertCategoryKind, assertCategoryName, categoryNameKey, normalizeCategoryIcon,
  type CategoryKind,
} from "../domain/category";
import { assertCanWrite, type BookContext } from "./books";
import { auditIn } from "./funds";

export interface CategoryRow {
  id: string;
  name: string;
  icon: string;
  kind: CategoryKind;
  isArchived: boolean;
  sortOrder: number;
  /** 有幾筆記帳用了它（含已作廢的，因為歷史仍然指著它） */
  usedByTransactions: number;
  /** 有幾筆固定支出設定用了它 */
  usedByRecurring: number;
  /** 有幾個月設了它的預算 */
  usedByBudget: number;
  /** 完全沒被用過才可以真的刪掉 */
  deletable: boolean;
}

/** 管理頁用：所有分類（含已停用）＋ 使用次數。三個查詢，不會 N+1。 */
export async function listCategoriesForManage(ctx: BookContext): Promise<CategoryRow[]> {
  const [categories, txGroups, recurringGroups, budgetGroups] = await Promise.all([
    prisma.category.findMany({
      where: { bookId: ctx.book.id },
      orderBy: [{ kind: "asc" }, { isArchived: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { bookId: ctx.book.id, categoryId: { not: null } },
      _count: { _all: true },
    }),
    prisma.recurringExpense.groupBy({
      by: ["categoryId"],
      where: { bookId: ctx.book.id, categoryId: { not: null }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.budget.groupBy({ by: ["categoryId"], where: { bookId: ctx.book.id }, _count: { _all: true } }),
  ]);
  const txCount = new Map(txGroups.map((g) => [g.categoryId!, g._count._all]));
  const recCount = new Map(recurringGroups.map((g) => [g.categoryId!, g._count._all]));
  const budgetCount = new Map(budgetGroups.map((g) => [g.categoryId, g._count._all]));
  return categories.map((c) => {
    const usedByTransactions = txCount.get(c.id) ?? 0;
    const usedByRecurring = recCount.get(c.id) ?? 0;
    const usedByBudget = budgetCount.get(c.id) ?? 0;
    return {
      id: c.id,
      name: c.name,
      icon: c.icon,
      kind: c.kind as CategoryKind,
      isArchived: c.isArchived,
      sortOrder: c.sortOrder,
      usedByTransactions,
      usedByRecurring,
      usedByBudget,
      deletable: usedByTransactions === 0 && usedByRecurring === 0 && usedByBudget === 0,
    };
  });
}

/** 同帳本、同類型不可以有同名分類（忽略大小寫與空白差異；已停用的也算）。 */
async function assertNameFree(
  client: typeof prisma | Parameters<typeof auditIn>[0],
  ctx: BookContext,
  kind: CategoryKind,
  name: string,
  exceptId?: string,
) {
  const key = categoryNameKey(name);
  const siblings = await (client as typeof prisma).category.findMany({
    where: { bookId: ctx.book.id, kind },
    select: { id: true, name: true },
  });
  const clash = siblings.find((c) => c.id !== exceptId && categoryNameKey(c.name) === key);
  assert(!clash, "CATEGORY_DUPLICATE", `已經有一個叫「${clash?.name}」的分類了`);
}

export async function createCategory(ctx: BookContext, input: { name: string; kind: string; icon?: string }) {
  assertCanWrite(ctx);
  const name = assertCategoryName(input.name);
  const kind = assertCategoryKind(input.kind);
  const icon = normalizeCategoryIcon(input.icon);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    await assertNameFree(tx, ctx, kind, name);
    const last = await tx.category.findFirst({ where: { bookId: ctx.book.id, kind }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const created = await tx.category.create({
      data: { bookId: ctx.book.id, kind, name, icon, sortOrder: (last?.sortOrder ?? 0) + 1 },
    });
    await auditIn(tx, ctx, "CREATE", "Category", created.id, null, { name, kind, icon });
    return created;
  });
}

/** 改名與換圖示。**不會動到任何既有交易**，舊紀錄仍然指著同一個分類。 */
export async function updateCategory(ctx: BookContext, id: string, input: { name: string; icon?: string }) {
  assertCanWrite(ctx);
  const name = assertCategoryName(input.name);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.category.findFirst({ where: { id, bookId: ctx.book.id } });
    assert(before, "CATEGORY_NOT_FOUND", "找不到這個分類");
    const icon = normalizeCategoryIcon(input.icon ?? before.icon);
    await assertNameFree(tx, ctx, before.kind as CategoryKind, name, id);
    const updated = await tx.category.update({ where: { id }, data: { name, icon } });
    await auditIn(tx, ctx, "UPDATE", "Category", id, { name: before.name, icon: before.icon }, { name, icon });
    return updated;
  });
}

/** 停用／重新啟用。停用只影響「新紀錄能不能選」，歷史交易完全不受影響。 */
export async function setCategoryArchived(ctx: BookContext, id: string, archived: boolean) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.category.findFirst({ where: { id, bookId: ctx.book.id } });
    assert(before, "CATEGORY_NOT_FOUND", "找不到這個分類");
    if (before.isArchived === archived) return before; // 重複送出不報錯
    const updated = await tx.category.update({ where: { id }, data: { isArchived: archived } });
    await auditIn(tx, ctx, archived ? "ARCHIVE" : "RESTORE", "Category", id, { isArchived: before.isArchived }, { isArchived: archived, name: before.name });
    return updated;
  });
}

/**
 * 真的刪掉一個分類。**只有完全沒被用過的分類可以刪**，
 * 有歷史交易或固定支出在用的一律要求改用停用，避免歷史資料斷裂。
 */
export async function deleteCategory(ctx: BookContext, id: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.category.findFirst({ where: { id, bookId: ctx.book.id } });
    assert(before, "CATEGORY_NOT_FOUND", "找不到這個分類");
    const [used, usedByRecurring, usedByBudget] = await Promise.all([
      tx.transaction.count({ where: { bookId: ctx.book.id, categoryId: id } }),
      tx.recurringExpense.count({ where: { bookId: ctx.book.id, categoryId: id, deletedAt: null } }),
      tx.budget.count({ where: { bookId: ctx.book.id, categoryId: id } }),
    ]);
    assert(
      used === 0 && usedByRecurring === 0 && usedByBudget === 0,
      "CATEGORY_IN_USE",
      `「${before.name}」已經有 ${used + usedByRecurring + usedByBudget} 筆紀錄在用，不能刪除。請改用「停用」，舊紀錄才不會失去分類。`,
    );
    await tx.category.delete({ where: { id } });
    await auditIn(tx, ctx, "DELETE", "Category", id, { name: before.name, kind: before.kind }, null);
  });
}
