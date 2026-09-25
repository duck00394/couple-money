/**
 * 任務排程與連續打卡（純函式）。
 * daysOfWeek 位元遮罩：bit0 = 週日 … bit6 = 週六；127 = 每天。
 * 「連續」是指連續的「排定日」都有打卡：週一三五的任務，一三五都打卡就算連續，不看週二。
 */
import { addDays, dayOfWeek, weekStart } from "../../lib/dates";

export const EVERY_DAY = 127;

export function isScheduled(key: string, mask: number, startKey?: string): boolean {
  if (startKey && key < startKey) return false;
  return (mask & (1 << dayOfWeek(key))) !== 0;
}

/** key 之前（不含 key）最近的排定日；早於 startKey 回傳 null。 */
export function prevScheduled(key: string, mask: number, startKey: string): string | null {
  if (!(mask & EVERY_DAY)) return null;
  let d = addDays(key, -1);
  for (let i = 0; i < 7; i++) {
    if (d < startKey) return null;
    if (isScheduled(d, mask)) return d;
    d = addDays(d, -1);
  }
  return null;
}

/** 以 endKey 為最後一天往回數的連續長度（endKey 本身沒打卡 → 0）。 */
export function streakEndingAt(
  checked: ReadonlySet<string>,
  mask: number,
  startKey: string,
  endKey: string,
): { length: number; startDate: string | null } {
  let length = 0;
  let startDate: string | null = null;
  let cursor: string | null = endKey;
  while (cursor && checked.has(cursor) && isScheduled(cursor, mask, startKey)) {
    length++;
    startDate = cursor;
    cursor = prevScheduled(cursor, mask, startKey);
  }
  return { length, startDate };
}

/** 目前連續：今天還沒打卡不會中斷（從上一個排定日算起）。 */
export function currentStreak(checked: ReadonlySet<string>, mask: number, startKey: string, todayKey: string) {
  if (isScheduled(todayKey, mask, startKey) && checked.has(todayKey)) {
    return streakEndingAt(checked, mask, startKey, todayKey);
  }
  const prev = prevScheduled(todayKey, mask, startKey);
  return prev ? streakEndingAt(checked, mask, startKey, prev) : { length: 0, startDate: null };
}

/** 歷史最長連續。 */
export function longestStreak(checked: ReadonlySet<string>, mask: number, startKey: string): number {
  let best = 0;
  for (const key of checked) {
    if (!isScheduled(key, mask, startKey)) continue;
    const prev = prevScheduled(key, mask, startKey);
    if (prev && checked.has(prev)) continue; // 不是一段的起點
    // 從起點往後數
    let len = 0;
    let cursor: string | null = key;
    while (cursor && checked.has(cursor)) {
      len++;
      let next = addDays(cursor, 1);
      let found: string | null = null;
      for (let i = 0; i < 7; i++) {
        if (isScheduled(next, mask, startKey)) {
          found = next;
          break;
        }
        next = addDays(next, 1);
      }
      cursor = found;
    }
    best = Math.max(best, len);
  }
  return best;
}

/** 這次連續長度剛好達成、而且尚未領取的里程碑。 */
export function reachedMilestones<M extends { days: number }>(milestones: M[], streakLength: number): M[] {
  return milestones.filter((m) => m.days === streakLength);
}

export function maskLabel(mask: number): string {
  if ((mask & EVERY_DAY) === EVERY_DAY) return "每天";
  if (mask === 0b0111110) return "平日";
  if (mask === 0b1000001) return "週末";
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  return "每週" + names.filter((_, i) => mask & (1 << i)).join("、");
}

export type TaskFrequency = "DAILY" | "WEEKLY" | "CUSTOM" | "PER_TIME";

/** 「每次」：做一次賺一次，不排程、同一天可以重複完成、不產生懲罰。 */
export const isPerTime = (f: string) => f === "PER_TIME";

/**
 * 「每週」：一週內任意一天完成一次即可（不綁星期幾）。
 * 所以排程遮罩是每天，真正的限制是「同一個人、同一個任務、同一週最多一筆」。
 */
export const isWeekly = (f: string) => f === "WEEKLY";

export const FREQUENCY_LABEL: Record<TaskFrequency, string> = {
  DAILY: "每日",
  WEEKLY: "每週",
  CUSTOM: "自訂",
  PER_TIME: "每次",
};

/** 給使用者看的一句話說明（任務卡片與建立畫面都用這個，不要出現 DAILY/WEEKLY 這種字）。 */
export const FREQUENCY_HINT: Record<TaskFrequency, string> = {
  DAILY: "每天最多一次",
  WEEKLY: "一週內完成一次即可",
  CUSTOM: "選定的日子每天最多一次",
  PER_TIME: "做一次賺一次，同一天可以重複完成",
};

/** 連續的單位：每週任務數的是「週」，其他數的是「天」。 */
export const STREAK_UNIT: Record<TaskFrequency, string> = {
  DAILY: "天", WEEKLY: "週", CUSTOM: "天", PER_TIME: "次",
};

/**
 * 依頻率整理星期遮罩。
 * 每日／每週／每次都不綁星期幾（每週的限制是「一週一次」，不是「星期幾」），
 * 只有「自訂」才真的用到遮罩，而且至少要選一天。
 */
export function normalizeSchedule(frequency: TaskFrequency, mask: number): number {
  if (frequency === "DAILY" || frequency === "PER_TIME" || frequency === "WEEKLY") return EVERY_DAY;
  const m = mask & EVERY_DAY;
  if (m === 0) throw new Error("CUSTOM_EMPTY");
  return m;
}

// ───────────────────────── 每週任務的「週」統計 ─────────────────────────

/** 把打卡日期換算成「那一週的星期一」。 */
export const weeksOf = (dates: Iterable<string>) => new Set([...dates].map(weekStart));

/**
 * 每週任務的連續週數：從這週（或上一週，如果這週還沒做）往回數。
 * 這週還沒完成不算中斷 —— 跟每日任務「今天還沒打卡不會中斷」是同一個原則。
 */
export function currentWeekStreak(weeks: ReadonlySet<string>, startKey: string, todayKey: string) {
  const startWeek = weekStart(startKey);
  let cursor = weeks.has(weekStart(todayKey)) ? weekStart(todayKey) : addDays(weekStart(todayKey), -7);
  let length = 0;
  let startDate: string | null = null;
  while (cursor >= startWeek && weeks.has(cursor)) {
    length++;
    startDate = cursor;
    cursor = addDays(cursor, -7);
  }
  return { length, startDate };
}

/** 歷史最長連續週數。 */
export function longestWeekStreak(weeks: ReadonlySet<string>): number {
  let best = 0;
  for (const w of weeks) {
    if (weeks.has(addDays(w, -7))) continue; // 不是一段的起點
    let len = 0;
    for (let c = w; weeks.has(c); c = addDays(c, 7)) len++;
    best = Math.max(best, len);
  }
  return best;
}

/** [fromKey, toKey] 之間有幾個「週」（每週任務的分母）。 */
export function weekCount(fromKey: string, toKey: string, startKey: string): number {
  const from = fromKey < startKey ? startKey : fromKey;
  if (from > toKey) return 0;
  let n = 0;
  for (let w = weekStart(from); w <= toKey; w = addDays(w, 7)) n++;
  return n;
}

/** [fromKey, toKey] 之間排定日的數量。 */
export function scheduledCount(fromKey: string, toKey: string, mask: number, startKey: string): number {
  let n = 0;
  for (let d = fromKey < startKey ? startKey : fromKey; d <= toKey; d = addDays(d, 1)) if (isScheduled(d, mask)) n++;
  return n;
}
