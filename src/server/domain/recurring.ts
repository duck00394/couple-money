/**
 * 固定支出的週期規則（純函式，無資料庫相依）。
 *
 * 只支援三種週期：每週、每月、每年。
 * 所有日期都是帳本時區（台灣）的 YYYY-MM-DD 字串，計算全部用字串／UTC 基準，不會有時區偏移。
 *   每月 31 日、每年 2/30 這種不存在的日期 → 自動用「該月最後一天」。
 */
import { addDays, dayOfWeek } from "../../lib/dates";
import { assert, DomainError } from "./errors";

export const RECURRING_FREQUENCIES = ["WEEKLY", "MONTHLY", "YEARLY"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const FREQUENCY_LABEL: Record<RecurringFrequency, string> = {
  WEEKLY: "每週",
  MONTHLY: "每月",
  YEARLY: "每年",
};

export const WEEKDAY_NAMES = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"] as const;

export interface RecurringSchedule {
  frequency: RecurringFrequency;
  /** WEEKLY：0 = 週日 … 6 = 週六 */
  dayOfWeek?: number | null;
  /** MONTHLY / YEARLY：1～31 */
  dayOfMonth?: number | null;
  /** YEARLY：1～12 */
  month?: number | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** 某年某月有幾天（1 月 = 1）。 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 把「每月幾號」夾到該月實際存在的日期（31 → 2 月會變成 28／29）。 */
export function clampDay(year: number, month: number, day: number): string {
  return key(year, month, Math.min(day, daysInMonth(year, month)));
}

export function validateSchedule(s: RecurringSchedule): void {
  assert((RECURRING_FREQUENCIES as readonly string[]).includes(s.frequency), "RECURRING_FREQUENCY", "請選擇每週、每月或每年");
  if (s.frequency === "WEEKLY") {
    assert(Number.isInteger(s.dayOfWeek) && s.dayOfWeek! >= 0 && s.dayOfWeek! <= 6, "RECURRING_DAY_OF_WEEK", "請選擇星期幾");
    return;
  }
  assert(Number.isInteger(s.dayOfMonth) && s.dayOfMonth! >= 1 && s.dayOfMonth! <= 31, "RECURRING_DAY_OF_MONTH", "請選擇每月幾號（1～31）");
  if (s.frequency === "YEARLY") {
    assert(Number.isInteger(s.month) && s.month! >= 1 && s.month! <= 12, "RECURRING_MONTH", "請選擇月份（1～12）");
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const parse = (k: string) => {
  if (!DATE.test(k)) throw new DomainError("RECURRING_DATE", "日期格式不正確");
  const [y, m, d] = k.split("-").map(Number);
  return { y, m, d };
};

/** 第一個「>= from」的應付日。 */
export function occurrenceOnOrAfter(s: RecurringSchedule, from: string): string {
  validateSchedule(s);
  const { y, m } = parse(from);
  if (s.frequency === "WEEKLY") {
    return addDays(from, (s.dayOfWeek! - dayOfWeek(from) + 7) % 7);
  }
  if (s.frequency === "MONTHLY") {
    const thisMonth = clampDay(y, m, s.dayOfMonth!);
    if (thisMonth >= from) return thisMonth;
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return clampDay(ny, nm, s.dayOfMonth!);
  }
  const thisYear = clampDay(y, s.month!, s.dayOfMonth!);
  return thisYear >= from ? thisYear : clampDay(y + 1, s.month!, s.dayOfMonth!);
}

/** 嚴格晚於 after 的下一個應付日。 */
export function nextOccurrenceAfter(s: RecurringSchedule, after: string): string {
  return occurrenceOnOrAfter(s, addDays(after, 1));
}

/**
 * 設定變動或重新啟用之後，下一次的應付日。
 *   from = max(開始日期, 今天)：重新啟用不會補停用期間漏掉的付款。
 *   超過結束日期就回傳 null（＝已結束）。
 */
export function computeNextDueDate(
  s: RecurringSchedule,
  opts: { startDate: string; endDate?: string | null; today: string; after?: string | null },
): string | null {
  const from = opts.after ? addDays(opts.after, 1) : (opts.startDate > opts.today ? opts.startDate : opts.today);
  const due = occurrenceOnOrAfter(s, from < opts.startDate ? opts.startDate : from);
  if (opts.endDate && due > opts.endDate) return null;
  return due;
}

export type DueState = "OVERDUE" | "TODAY" | "UPCOMING" | "ENDED";

export function dueState(nextDueDate: string | null, today: string): DueState {
  if (!nextDueDate) return "ENDED";
  if (nextDueDate < today) return "OVERDUE";
  if (nextDueDate === today) return "TODAY";
  return "UPCOMING";
}

/** 是否可以產生（今天或已逾期才能產生，未到期不行）。 */
export function isDue(nextDueDate: string | null, today: string): boolean {
  const s = dueState(nextDueDate, today);
  return s === "OVERDUE" || s === "TODAY";
}

/** 週期的文字描述：每月 1 日、每週三、每年 1 月 15 日。 */
export function scheduleLabel(s: RecurringSchedule): string {
  if (s.frequency === "WEEKLY") return `每${WEEKDAY_NAMES[s.dayOfWeek ?? 0]}`;
  if (s.frequency === "MONTHLY") return `每月 ${s.dayOfMonth} 日${(s.dayOfMonth ?? 0) > 28 ? "（該月沒有就當月最後一天）" : ""}`;
  return `每年 ${s.month} 月 ${s.dayOfMonth} 日`;
}
