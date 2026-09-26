import { APP } from "@/config/app";

/** 取得某個時間點在帳本時區的 YYYY-MM-DD。 */
export function toDateKey(d: Date, timeZone: string = APP.timeZone): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** 表單的 YYYY-MM-DD → 儲存用時間（當地中午，避免時區換算跨日）。 */
export function fromDateKey(key: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("invalid date");
  const d = new Date(`${key}T12:00:00+08:00`);
  if (Number.isNaN(d.getTime()) || toDateKey(d) !== key) throw new Error("invalid date");
  return d;
}

/** 取得某個時間點在帳本時區的 HH:MM。 */
export function toTimeKey(d: Date, timeZone: string = APP.timeZone): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** 表單的日期 + 時間（HH:MM，選填）→ 儲存用時間；沒填時間就沿用當地中午。 */
export function fromDateTime(key: string, time?: string | null): Date {
  const t = (time ?? "").trim();
  if (!t) return fromDateKey(key);
  if (!/^\d{2}:\d{2}$/.test(t)) throw new Error("invalid time");
  fromDateKey(key); // 先驗證日期
  const d = new Date(`${key}T${t}:00+08:00`);
  if (Number.isNaN(d.getTime()) || toDateKey(d) !== key || toTimeKey(d) !== t) throw new Error("invalid time");
  return d;
}

/** 台灣時間某一天的起訖 [start, end)。台灣沒有日光節約時間，所以整天恰好 24 小時。 */
export function dayRange(key: string): { start: Date; end: Date } {
  fromDateKey(key); // 先驗證格式
  const start = new Date(`${key}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 86400_000) };
}

/** 這個時間點有沒有實際填時間（中午＝只填了日期）。 */
export function hasTimeOfDay(d: Date): boolean {
  return toTimeKey(d) !== "12:00";
}

/** 台灣時間本月的起訖 [start, end)。 */
export function monthRange(now = new Date()): { start: Date; end: Date; label: string } {
  const [y, m] = toDateKey(now).split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return {
    start: new Date(`${y}-${pad(m)}-01T00:00:00+08:00`),
    end: new Date(`${ny}-${pad(nm)}-01T00:00:00+08:00`),
    label: `${m} 月`,
  };
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/** 列表分組標題：今天／昨天／9月15日（週二）。 */
export function dateHeading(key: string, now = new Date()): string {
  const today = toDateKey(now);
  const yesterday = toDateKey(new Date(now.getTime() - 86400_000));
  if (key === today) return "今天";
  if (key === yesterday) return "昨天";
  const d = fromDateKey(key);
  const [y, m, day] = key.split("-").map(Number);
  const sameYear = today.slice(0, 4) === String(y);
  return `${sameYear ? "" : `${y}年`}${m}月${day}日（週${WEEK[d.getUTCDay()]}）`;
}

// ───────── 純日期（YYYY-MM-DD）運算，全部以 UTC 計算避免時區誤差 ─────────

const keyToUtc = (key: string) => new Date(`${key}T00:00:00Z`);

export function addDays(key: string, n: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = 週日 … 6 = 週六 */
export function dayOfWeek(key: string): number {
  return keyToUtc(key).getUTCDay();
}

export function diffDays(a: string, b: string): number {
  return Math.round((keyToUtc(a).getTime() - keyToUtc(b).getTime()) / 86400_000);
}

/** Prisma @db.Date 欄位 ↔ YYYY-MM-DD */
export const keyToDbDate = keyToUtc;
export const dbDateToKey = (d: Date) => d.toISOString().slice(0, 10);

export const WEEKDAY_LABEL = WEEK;

/** 週一為一週開始（台灣習慣）。 */
export function weekStart(key: string): string {
  return addDays(key, -((dayOfWeek(key) + 6) % 7));
}

export function monthStartKey(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

/** [from, to] 之間（含）的所有日期 */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
