/**
 * CSV 匯出（Phase 3-4 G）：把「目前搜尋條件下的記帳」變成一份試算表打得開的檔案。
 *
 * 兩條硬規則（與 /stats 同一套）：
 *   1. 篩選條件一律交給 `buildTransactionWhere()`（與搜尋頁同一個函式），不另寫一套
 *   2. 「算不算收支」一律沿用 `INCOME_EXPENSE_TYPES`，不在這裡重新定義
 *
 * 匯出是**唯讀**的：除了寫一筆 AuditLog 之外不會改動任何資料。
 * CSV 是給人看、給試算表算的，**不是完整備份**（備份見 scripts/backup.sh）。
 */
import { prisma } from "../db";
import { INCOME_EXPENSE_TYPES, TX_TYPE_LABEL, type TxType } from "../domain/ledger";
import { csvAmount, toCsv } from "../domain/csv";
import type { TransactionFilter } from "../domain/search";
import { toDateKey, toTimeKey, hasTimeOfDay } from "@/lib/dates";
import { buildTransactionWhere, TX_INCLUDE } from "./search";
import type { BookContext } from "./books";

/** 一次最多匯出幾筆（私人使用綽綽有餘，避免一次拉爆記憶體）。 */
export const EXPORT_LIMIT = 5000;

const nameOf = (ctx: BookContext, userId: string | null | undefined) =>
  userId === null || userId === undefined
    ? "共同帳戶"
    : ctx.members.find((m) => m.userId === userId)?.nickname ?? "已離開的成員";

/** 這筆交易的類型顯示名稱；餘額調整、期初餘額、任務獎金入金都要看得出來。 */
function typeLabel(tx: { type: string; sourceType: string | null; recurringExpenseId: string | null; fundEntry: unknown }) {
  if (tx.type === "TRANSFER" && tx.sourceType === "REWARD_DEPOSIT") return "任務獎金入金";
  const base = TX_TYPE_LABEL[tx.type as TxType] ?? tx.type;
  if (tx.type === "EXPENSE" && tx.fundEntry) return `${base}（基金支出）`;
  if (tx.recurringExpenseId) return `${base}（固定支出）`;
  return base;
}

export interface ExportResult {
  csv: string;
  count: number;
  /** 超過上限時為 true（CSV 只含最新的 EXPORT_LIMIT 筆） */
  truncated: boolean;
}

export async function exportTransactionsCsv(ctx: BookContext, filter: TransactionFilter): Promise<ExportResult> {
  const where = buildTransactionWhere(ctx.book.id, filter);
  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: EXPORT_LIMIT,
      include: TX_INCLUDE,
    }),
    prisma.transaction.count({ where }),
  ]);

  // 收據張數：一次 groupBy 取回，不要每筆再查一次
  const receiptCount = new Map<string, number>();
  if (items.length > 0) {
    const groups = await prisma.attachment.groupBy({
      by: ["ownerId"],
      where: {
        bookId: ctx.book.id,
        ownerType: "TRANSACTION",
        deletedAt: null,
        ownerId: { in: items.map((t) => t.id) },
      },
      _count: { _all: true },
    });
    for (const g of groups) if (g.ownerId) receiptCount.set(g.ownerId, g._count._all);
  }

  const me = ctx.me;
  const partner = ctx.partner;
  const headers = [
    "交易ID", "日期", "時間", "類型", "算收支", "金額", "收支金額",
    "分類", "名稱", "商家", "備註", "標籤",
    "付款帳戶", "對方帳戶", "付款人",
    `${me.nickname}付款`, ...(partner ? [`${partner.nickname}付款`] : []), "共同帳戶付款",
    `${me.nickname}負擔`, ...(partner ? [`${partner.nickname}負擔`] : []),
    "基金", "固定支出", "關聯交易ID", "收據張數", "狀態", "建立時間", "更新時間",
  ];

  const rows = items.map((t) => {
    const counts = INCOME_EXPENSE_TYPES.includes(t.type as TxType);
    // 收支金額：支出為負、收入與退款為正，其他型別一律 0 → 直接 SUM 這一欄就是淨收支
    const signed = !counts ? 0 : t.type === "EXPENSE" ? -t.amount : t.amount;
    const payments = t.payments;
    // 轉帳／結算：金額為正的那筆是轉出，負的是轉入
    const out = payments.find((p) => p.amount > 0) ?? payments[0];
    const into = payments.find((p) => p.amount < 0);
    const twoSided = t.type === "TRANSFER" || t.type === "SETTLEMENT";
    const accountLabel = (p?: (typeof payments)[number]) =>
      p ? `${nameOf(ctx, p.account.ownerId)}・${p.account.name}` : "";
    const paidBy = (userId: string | null) =>
      csvAmount(payments.filter((p) => p.userId === userId).reduce((a, p) => a + p.amount, 0));
    const borneBy = (userId: string) =>
      csvAmount(t.splits.filter((s) => s.userId === userId).reduce((a, s) => a + s.amount, 0));

    return [
      t.id,
      toDateKey(t.occurredAt),
      hasTimeOfDay(t.occurredAt) ? toTimeKey(t.occurredAt) : "",
      typeLabel(t),
      counts ? "是" : "否",
      csvAmount(t.amount),
      csvAmount(signed),
      t.category?.name ?? "",
      t.title ?? "",
      t.merchant ?? "",
      t.note ?? "",
      t.tags.map((x) => x.tag.name).join(" "),
      accountLabel(twoSided ? out : payments[0]),
      twoSided ? accountLabel(into) : "",
      nameOf(ctx, (twoSided ? out : payments[0])?.account.ownerId),
      paidBy(me.userId),
      ...(partner ? [paidBy(partner.userId)] : []),
      paidBy(null),
      borneBy(me.userId),
      ...(partner ? [borneBy(partner.userId)] : []),
      t.fundEntry && !t.fundEntry.deletedAt ? t.fundEntry.fund.name : "",
      t.recurring?.name ?? "",
      t.relatedId ?? "",
      receiptCount.get(t.id) ?? 0,
      t.status,
      `${toDateKey(t.createdAt)} ${toTimeKey(t.createdAt)}`,
      `${toDateKey(t.updatedAt)} ${toTimeKey(t.updatedAt)}`,
    ];
  });

  return { csv: toCsv(headers, rows), count: items.length, truncated: total > items.length };
}

/** 匯出紀錄：沿用既有 AuditLog，不改動任何既有語意。 */
export async function recordExport(ctx: BookContext, info: { count: number; filter: TransactionFilter }) {
  await prisma.auditLog.create({
    data: {
      bookId: ctx.book.id,
      actorId: ctx.me.userId,
      action: "EXPORT",
      entityType: "Transaction",
      entityId: ctx.book.id,
      after: { count: info.count, filter: JSON.parse(JSON.stringify(info.filter)) },
    },
  });
}
