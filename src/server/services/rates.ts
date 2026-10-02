/**
 * 帳本自訂匯率。
 *
 * 這裡存的是「之後新增交易時要用的匯率」。改這裡**只影響新交易** ——
 * 歷史交易的匯率鎖在 Transaction 的 rateForeignUnits / rateBaseMinor 上，
 * 這個檔案裡沒有任何一行會去更新既有的 Transaction。
 */
import { prisma, type Tx } from "../db";
import { assert } from "../domain/errors";
import { assertRate, type LockedRate } from "../domain/exchange";
import { CURRENCIES, isCurrencyCode } from "@/lib/currency";
import { fromDateKey } from "@/lib/dates";
import { assertCanWrite, type BookContext } from "./books";

type Client = Tx | typeof prisma;

export interface RateRow {
  currency: string;
  foreignUnits: number;
  baseMinor: number;
}

/** 這本帳本設定過的匯率（不含本位幣本身）。 */
export async function listRates(ctx: BookContext, client: Client = prisma): Promise<RateRow[]> {
  const rows = await client.exchangeRate.findMany({
    where: { bookId: ctx.book.id },
    orderBy: { currency: "asc" },
  });
  return rows
    .filter((r) => r.currency !== ctx.book.baseCurrency)
    .map((r) => ({ currency: r.currency, foreignUnits: r.foreignUnits, baseMinor: r.baseMinor }));
}

/**
 * 設定頁要顯示的清單：每個支援的幣別一列，沒設過的 rate 是 null。
 * 本位幣自己不列出來（1 TWD = 1 TWD 沒有意義）。
 */
export async function ratesForSettings(ctx: BookContext) {
  const set = new Map((await listRates(ctx)).map((r) => [r.currency, r]));
  return CURRENCIES.filter((c) => c.code !== ctx.book.baseCurrency).map((c) => ({
    ...c,
    rate: set.get(c.code) ?? null,
  }));
}

/** 新增或更新一個幣別的匯率。 */
export async function setRate(ctx: BookContext, input: RateRow) {
  assertCanWrite(ctx);
  assert(isCurrencyCode(input.currency), "RATE_CURRENCY", "不支援的幣別");
  assert(input.currency !== ctx.book.baseCurrency, "RATE_BASE", "本位幣不需要設定匯率");
  assertRate(input);
  return prisma.exchangeRate.upsert({
    where: { bookId_currency: { bookId: ctx.book.id, currency: input.currency } },
    create: {
      bookId: ctx.book.id,
      currency: input.currency,
      foreignUnits: input.foreignUnits,
      baseMinor: input.baseMinor,
      updatedById: ctx.me.userId,
    },
    update: { foreignUnits: input.foreignUnits, baseMinor: input.baseMinor, updatedById: ctx.me.userId },
  });
}

/** 刪掉一個幣別的匯率設定。已經記過的交易不受影響（匯率鎖在交易上）。 */
export async function removeRate(ctx: BookContext, currency: string) {
  assertCanWrite(ctx);
  await prisma.exchangeRate.deleteMany({ where: { bookId: ctx.book.id, currency } });
}

/**
 * 記帳時要用的匯率。
 *
 * 回傳 null 代表「這筆就是本位幣」，呼叫端不要做任何換算。
 * 找不到設定時直接擋下來 —— 與其偷偷用 1:1 記成錯的金額，
 * 不如叫使用者先去設定匯率。
 */
export async function rateFor(
  ctx: BookContext,
  currency: string | null | undefined,
  client: Client = prisma,
): Promise<LockedRate | null> {
  const code = (currency || ctx.book.baseCurrency).toUpperCase();
  if (code === ctx.book.baseCurrency) return null;
  assert(isCurrencyCode(code), "RATE_CURRENCY", "不支援的幣別");
  const row = await client.exchangeRate.findUnique({
    where: { bookId_currency: { bookId: ctx.book.id, currency: code } },
  });
  assert(row, "RATE_MISSING", `還沒設定 ${code} 的匯率，請先到「幣別與匯率」設定`);
  return { currency: code, foreignUnits: row!.foreignUnits, baseMinor: row!.baseMinor };
}

/**
 * 某段期間內「各幣別各花了多少」。
 *
 * 規格點 12：統計一律用本位幣，但明細裡要看得到「其中 JPY ¥12,000、USD $50」。
 * 刻意**不把不同幣別直接相加** —— 每一列是各自的原幣加總，外加它當初換算出來的本位幣。
 * 全部是本位幣的帳本不會有任何一列，所以這一區塊在台灣記帳時完全不會出現。
 */
export async function currencyBreakdown(
  ctx: BookContext,
  /** 期間。與 /stats 一致，用的是 monthKeyRange 回傳的 YYYY-MM-DD 字串。 */
  range: { from: string; to: string },
  client: Client = prisma,
) {
  const rows = await client.transaction.findMany({
    where: {
      bookId: ctx.book.id,
      deletedAt: null,
      status: "POSTED",
      type: { in: ["EXPENSE", "REFUND"] },
      occurredAt: { gte: fromDateKey(range.from), lt: fromDateKey(range.to) },
      NOT: { foreignAmount: null },
    },
    select: { currency: true, foreignAmount: true, amount: true, type: true },
  });
  const byCode = new Map<string, { currency: string; foreign: number; base: number; count: number }>();
  for (const r of rows) {
    // 退款是負向的：原幣與本位幣都要反過來扣
    const sign = r.type === "REFUND" ? -1 : 1;
    const cur = byCode.get(r.currency) ?? { currency: r.currency, foreign: 0, base: 0, count: 0 };
    cur.foreign += (r.foreignAmount ?? 0) * sign;
    cur.base += r.amount * sign;
    cur.count += 1;
    byCode.set(r.currency, cur);
  }
  return [...byCode.values()].sort((a, b) => b.base - a.base);
}
