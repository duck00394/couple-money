/**
 * 統計的純函式（月份切換、分月、分類佔比）。
 *
 * 重要：這裡**不重新定義**什麼算支出／收入／轉帳。
 * 每個月的收支數字一律交給 `totalsFromGroups()`（與搜尋頁同一個函式）計算。
 * 這個檔案只負責「把資料切成月份／分類」，不碰財務規則。
 */
import { toDateKey } from "@/lib/dates";
import { totalsFromGroups, type SearchTotals } from "./search";

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** YYYY-MM 往前／往後移動 n 個月。 */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** 某個日期（YYYY-MM-DD）屬於哪個月。 */
export function monthOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/** 最近 n 個月（含 todayKey 當月），由舊到新。 */
export function recentMonths(todayKey: string, n: number): string[] {
  const now = monthOf(todayKey);
  return Array.from({ length: n }, (_, i) => shiftMonth(now, i - n + 1));
}

/** 某個月的起訖日（含頭含尾，YYYY-MM-DD）。自動處理 30／31 天與閏年 2 月。 */
export function monthKeyRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** 顯示用：同一年只顯示「9 月」，跨年顯示「2025 年 12 月」。 */
export function monthLabel(month: string, todayKey: string): string {
  const [y, m] = month.split("-").map(Number);
  return todayKey.slice(0, 4) === String(y) ? `${m} 月` : `${y} 年 ${m} 月`;
}

/**
 * 把網址的 ?m= 參數變成可用的月份：
 * 格式不對、未來月份、超過 maxBack 個月以前 → 一律回到本月（不丟錯，與 parseFilter 的寬容策略一致）。
 */
export function clampMonth(input: string | null | undefined, todayKey: string, maxBack = 12): string {
  const now = monthOf(todayKey);
  const m = (input ?? "").trim();
  if (!MONTH.test(m)) return now;
  if (m > now) return now;
  if (m < shiftMonth(now, -(maxBack - 1))) return now;
  return m;
}

export interface FlowRow {
  occurredAt: Date;
  type: string;
  amount: number;
}

/**
 * 依帳本時區把交易分到各月份，每個月的數字交給 totalsFromGroups。
 * months 裡沒有交易的月份會補 0（不是缺列），畫面才不會跳格。
 */
export function bucketByMonth(rows: FlowRow[], months: string[]): Array<{ month: string; totals: SearchTotals }> {
  const byMonth = new Map<string, Map<string, { count: number; amount: number }>>();
  for (const r of rows) {
    const key = monthOf(toDateKey(r.occurredAt));
    const types = byMonth.get(key) ?? new Map();
    const cur = types.get(r.type) ?? { count: 0, amount: 0 };
    types.set(r.type, { count: cur.count + 1, amount: cur.amount + r.amount });
    byMonth.set(key, types);
  }
  return months.map((month) => {
    const types = byMonth.get(month) ?? new Map();
    const groups = [...types].map(([type, v]) => ({ type, count: v.count, amount: v.amount }));
    return { month, totals: totalsFromGroups(groups) };
  });
}

export interface CategoryRow {
  categoryId: string | null;
  type: string;
  amount: number;
}

export interface CategoryShare {
  categoryId: string | null;
  /** 淨支出（支出 − 退款） */
  amount: number;
  /** 佔淨支出的百分比（0～100，一位小數） */
  share: number;
}

/**
 * 分類佔比：同一個分類的「支出 − 退款」（退款沿用原始消費的分類）。
 * 分母是淨支出總額；淨支出 ≤ 0 時一律回傳 0，不會出現 NaN 或 Infinity。
 */
export function categoryShares(rows: CategoryRow[]): CategoryShare[] {
  const byCategory = new Map<string | null, number>();
  for (const r of rows) {
    if (r.type !== "EXPENSE" && r.type !== "REFUND") continue;
    const delta = r.type === "EXPENSE" ? r.amount : -r.amount;
    byCategory.set(r.categoryId, (byCategory.get(r.categoryId) ?? 0) + delta);
  }
  const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
  return [...byCategory]
    .filter(([, amount]) => amount !== 0)
    .map(([categoryId, amount]) => ({
      categoryId,
      amount,
      share: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}
