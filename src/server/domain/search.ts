/**
 * 記帳搜尋與篩選條件（純函式：解析網址參數、驗證、組回網址）。
 * 金額一律是最小單位整數；日期是帳本時區的 YYYY-MM-DD。
 */
import { parseAmount } from "../../lib/money";

export const SEARCH_KINDS = ["EXPENSE", "INCOME", "REFUND", "TRANSFER", "SETTLEMENT", "FUND_EXPENSE", "RECURRING", "REWARD_DEPOSIT", "OPENING_BALANCE", "ADJUSTMENT"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  EXPENSE: "支出",
  INCOME: "收入",
  REFUND: "退款",
  TRANSFER: "帳戶間轉帳",
  SETTLEMENT: "結算",
  FUND_EXPENSE: "基金支出",
  RECURRING: "固定支出產生",
  REWARD_DEPOSIT: "任務獎金入金",
  OPENING_BALANCE: "期初餘額",
  ADJUSTMENT: "餘額調整",
};

export interface TransactionFilter {
  q: string | null;
  from: string | null; // YYYY-MM-DD（含）
  to: string | null; // YYYY-MM-DD（含）
  kind: SearchKind | null;
  categoryId: string | null;
  /** 付款／收款人：userId 或 "JOINT"（共同帳戶） */
  person: string | null;
  accountId: string | null;
  fundId: string | null;
  tag: string | null;
  min: number | null;
  max: number | null;
}

export const EMPTY_FILTER: TransactionFilter = {
  q: null, from: null, to: null, kind: null, categoryId: null, person: null, accountId: null, fundId: null, tag: null, min: null, max: null,
};

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string) => {
  const v = p[k];
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s ? s : null;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\w-]{1,64}$/;

/** 解析網址參數；不合法的條件直接忽略（不讓畫面壞掉）。 */
export function parseFilter(params: Params): TransactionFilter {
  const kind = one(params, "kind");
  const f: TransactionFilter = {
    q: one(params, "q")?.slice(0, 50) ?? null,
    from: DATE.test(one(params, "from") ?? "") ? one(params, "from") : null,
    to: DATE.test(one(params, "to") ?? "") ? one(params, "to") : null,
    kind: kind && (SEARCH_KINDS as readonly string[]).includes(kind) ? (kind as SearchKind) : null,
    categoryId: ID.test(one(params, "category") ?? "") ? one(params, "category") : null,
    person: ID.test(one(params, "person") ?? "") ? one(params, "person") : null,
    accountId: ID.test(one(params, "account") ?? "") ? one(params, "account") : null,
    fundId: ID.test(one(params, "fund") ?? "") ? one(params, "fund") : null,
    tag: one(params, "tag")?.replace(/^#/, "").slice(0, 20) || null,
    min: one(params, "min") ? parseAmount(one(params, "min")) : null,
    max: one(params, "max") ? parseAmount(one(params, "max")) : null,
  };
  // 日期或金額區間顛倒時自動對調
  if (f.from && f.to && f.from > f.to) [f.from, f.to] = [f.to, f.from];
  if (f.min !== null && f.max !== null && f.min > f.max) [f.min, f.max] = [f.max, f.min];
  return f;
}

const PARAM_NAME: Record<keyof TransactionFilter, string> = {
  q: "q", from: "from", to: "to", kind: "kind", categoryId: "category", person: "person", accountId: "account", fundId: "fund", tag: "tag", min: "min", max: "max",
};

/** 條件 → 網址查詢字串（金額轉回元）。omit：要移除的條件。 */
export function filterToQuery(f: TransactionFilter, omit: Array<keyof TransactionFilter> = []): string {
  const sp = new URLSearchParams();
  for (const key of Object.keys(PARAM_NAME) as Array<keyof TransactionFilter>) {
    if (omit.includes(key)) continue;
    const v = f[key];
    if (v === null || v === "") continue;
    sp.set(PARAM_NAME[key], key === "min" || key === "max" ? String((v as number) / 100) : String(v));
  }
  return sp.toString();
}

export function activeFilterKeys(f: TransactionFilter): Array<keyof TransactionFilter> {
  return (Object.keys(f) as Array<keyof TransactionFilter>).filter((k) => f[k] !== null);
}

/** 標籤整理：去掉 #、空白、重複；最多 10 個、每個 20 字。 */
export function normalizeTags(input: string | string[]): string[] {
  const list = Array.isArray(input) ? input : input.split(/[,，、\s]+/);
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.trim().replace(/^#+/, "").slice(0, 20);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

export interface SearchTotals {
  count: number;
  expense: number;
  refund: number;
  income: number;
  /** 實際淨支出 = 支出 − 退款 */
  netExpense: number;
  transferCount: number;
  transferAmount: number;
}

/** 結果統計：只有支出／退款／收入算收支；轉帳、結算、期初餘額另外列出，不算收支。 */
export function totalsFromGroups(groups: Array<{ type: string; count: number; amount: number; sourceType?: string | null }>): SearchTotals {
  const t: SearchTotals = { count: 0, expense: 0, refund: 0, income: 0, netExpense: 0, transferCount: 0, transferAmount: 0 };
  for (const g of groups) {
    t.count += g.count;
    if (g.type === "EXPENSE") t.expense += g.amount;
    else if (g.type === "REFUND") t.refund += g.amount;
    else if (g.type === "INCOME") t.income += g.amount;
    else if (g.type === "TRANSFER") {
      t.transferCount += g.count;
      t.transferAmount += g.amount;
    }
  }
  t.netExpense = t.expense - t.refund;
  return t;
}
