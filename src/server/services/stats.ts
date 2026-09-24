/**
 * 統計與報表（Phase 3-4 A）：**只讀取**，沒有任何寫入。
 *
 * 兩條硬規則：
 *   1. 「什麼算支出／退款／收入／轉帳」一律交給 `totalsFromGroups()`（與搜尋頁同一個函式）
 *   2. 「期間與帳本範圍」一律交給 `buildTransactionWhere()`（與搜尋頁同一個函式）
 * 這個檔案不重新定義任何財務規則。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { EMPTY_FILTER, totalsFromGroups, type SearchTotals } from "../domain/search";
import { bucketByMonth, categoryShares, monthKeyRange, type CategoryShare } from "../domain/stats";
import { buildTransactionWhere } from "./search";
import { fundBalances, pendingByFund } from "./funds";
import { getBalances } from "./ledger";
import type { BookContext } from "./books";
import { toIconKey } from "../../lib/icons";

/** 會進入「誰掏錢／誰負擔」統計的型別（轉帳、結算、期初餘額都不算收支）。 */
const FLOW_TYPES: Prisma.EnumTxTypeFilter = { in: ["EXPENSE", "REFUND"] };

/** 某個月的交易範圍（沿用搜尋的日期解析，含頭含尾、帳本時區）。 */
function monthWhere(bookId: string, month: string): Prisma.TransactionWhereInput {
  const { from, to } = monthKeyRange(month);
  return buildTransactionWhere(bookId, { ...EMPTY_FILTER, from, to });
}

export interface PersonSplit {
  me: number;
  partner: number;
  /** 共同帳戶（payment.userId = null）：獨立呈現，不分攤給任何一個人 */
  joint: number;
}

export interface MonthStats {
  month: string;
  /** 支出／退款／淨支出／收入／轉帳（與搜尋頁同一個計算） */
  totals: SearchTotals;
  /** 誰實際掏錢（Payment 側，退款會沖銷）：三者加總 = 淨支出 */
  paid: PersonSplit;
  /** 誰實際負擔（Split 側）：兩者加總 = 淨支出。共同帳戶付款仍然由兩人負擔 */
  borne: { me: number; partner: number };
  /** 收入進到誰的帳戶（Payment 側） */
  income: PersonSplit;
  categories: Array<CategoryShare & { name: string; icon: string }>;
}

export async function monthStats(ctx: BookContext, month: string): Promise<MonthStats> {
  const where = monthWhere(ctx.book.id, month);
  const flowWhere = { transaction: { is: { AND: [where, { type: FLOW_TYPES }] } } };

  const [typeGroups, paidGroups, borneGroups, incomeGroups, categoryGroups, categories] = await Promise.all([
    prisma.transaction.groupBy({ by: ["type"], where, _count: { _all: true }, _sum: { amount: true } }),
    prisma.transactionPayment.groupBy({ by: ["userId"], where: flowWhere, _sum: { amount: true } }),
    prisma.transactionSplit.groupBy({ by: ["userId"], where: flowWhere, _sum: { amount: true } }),
    prisma.transactionPayment.groupBy({
      by: ["userId"],
      where: { transaction: { is: { AND: [where, { type: "INCOME" as const }] } } },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["categoryId", "type"],
      where: { AND: [where, { type: FLOW_TYPES }] },
      _sum: { amount: true },
    }),
    prisma.category.findMany({ where: { bookId: ctx.book.id }, select: { id: true, name: true, icon: true } }),
  ]);

  const totals = totalsFromGroups(typeGroups.map((g) => ({ type: g.type, count: g._count._all, amount: g._sum.amount ?? 0 })));

  const partnerId = ctx.partner?.userId ?? null;
  const pick = (rows: Array<{ userId: string | null; _sum: { amount: number | null } }>, sign: 1 | -1): PersonSplit => {
    const get = (uid: string | null) => sign * (rows.find((r) => r.userId === uid)?._sum.amount ?? 0);
    return { me: get(ctx.me.userId), partner: partnerId ? get(partnerId) : 0, joint: get(null) };
  };

  const paid = pick(paidGroups, 1);
  const bornePick = pick(borneGroups as Array<{ userId: string | null; _sum: { amount: number | null } }>, 1);
  const income = pick(incomeGroups, -1);

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const shares = categoryShares(categoryGroups.map((g) => ({ categoryId: g.categoryId, type: g.type, amount: g._sum.amount ?? 0 })));

  return {
    month,
    totals,
    paid,
    borne: { me: bornePick.me, partner: bornePick.partner },
    income,
    categories: shares.map((s) => {
      const c = s.categoryId ? catMap.get(s.categoryId) : undefined;
      return { ...s, name: c?.name ?? "未分類", icon: toIconKey(c?.icon) };
    }),
  };
}

/**
 * 「每個分類、每個人實際負擔多少」（個人預算用）。
 *
 * **與 `monthStats()` 完全同一套口徑**：同一個 `monthWhere()`、同一組 `FLOW_TYPES`
 * （支出 + 退款），資料來源同樣是 `TransactionSplit`（分帳後的實際負擔），
 * 所以下面這條不變式一定成立，也有測試釘住：
 *
 *     Σ(某分類所有人的負擔) === 該分類在 `monthStats().categories` 的金額
 *
 * 退款的 split 是負數，所以會自動回沖；共同帳戶付款的 payment.userId 是 null，
 * 但 split 仍然分給兩個人，所以照樣計入個人負擔。
 */
export async function monthBorneByCategory(
  ctx: BookContext,
  month: string,
): Promise<Map<string | null, Map<string, number>>> {
  const where = monthWhere(ctx.book.id, month);
  const rows = await prisma.transactionSplit.findMany({
    where: { transaction: { is: { AND: [where, { type: FLOW_TYPES }] } } },
    select: { userId: true, amount: true, transaction: { select: { categoryId: true } } },
  });
  const out = new Map<string | null, Map<string, number>>();
  for (const r of rows) {
    const key = r.transaction.categoryId;
    const byUser = out.get(key) ?? new Map<string, number>();
    byUser.set(r.userId, (byUser.get(r.userId) ?? 0) + r.amount);
    out.set(key, byUser);
  }
  return out;
}

export interface TrendPoint {
  month: string;
  netExpense: number;
  income: number;
}

/** 最近幾個月的趨勢：一次查詢 + 純函式分月（不寫原生 SQL，時區與其他地方一致）。 */
export async function statsTrend(ctx: BookContext, months: string[]): Promise<TrendPoint[]> {
  if (months.length === 0) return [];
  const from = monthKeyRange(months[0]).from;
  const to = monthKeyRange(months[months.length - 1]).to;
  const rows = await prisma.transaction.findMany({
    where: buildTransactionWhere(ctx.book.id, { ...EMPTY_FILTER, from, to }),
    select: { occurredAt: true, type: true, amount: true },
  });
  return bucketByMonth(rows, months).map(({ month, totals }) => ({
    month,
    netExpense: totals.netExpense,
    income: totals.income,
  }));
}

/** 頁面一次取用：當月統計 + 趨勢 + 目前欠款 + 目前基金。 */
export async function statsOverview(ctx: BookContext, month: string, months: string[]) {
  const [stats, trend, balances, funds] = await Promise.all([
    monthStats(ctx, month),
    statsTrend(ctx, months),
    getBalances(ctx),
    listFundSnapshot(ctx),
  ]);
  return { stats, trend, debt: balances.debts[0] ?? null, funds };
}

/** 目前基金：實際金額與尚未入金的獎金分開（尚未入金的不是真實現金）。 */
async function listFundSnapshot(ctx: BookContext) {
  const rows = await prisma.fund.findMany({
    where: { bookId: ctx.book.id, deletedAt: null, isArchived: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, emoji: true },
  });
  if (rows.length === 0) return [];
  const ids = rows.map((f) => f.id);
  const [real, pending] = await Promise.all([fundBalances(prisma, ctx.book.id, ids), pendingByFund(prisma, ctx.book.id, ids)]);
  return rows.map((f) => ({ ...f, real: real.get(f.id) ?? 0, pending: pending.get(f.id)?.net ?? 0 }));
}
