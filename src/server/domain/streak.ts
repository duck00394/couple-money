/**
 * 任務排程與連續打卡（純函式）。
 * daysOfWeek 位元遮罩：bit0 = 週日 … bit6 = 週六；127 = 每天。
 * 「連續」是指連續的「排定日」都有打卡：週一三五的任務，一三五都打卡就算連續，不看週二。
 */
import { addDays, dayOfWeek } from "../../lib/dates";

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

export type TaskFrequency = "DAILY" | "WEEKLY" | "CUSTOM";

/** 依頻率整理星期遮罩：每日 = 全部；每週 = 只能一天；自訂 = 至少一天。 */
export function normalizeSchedule(frequency: TaskFrequency, mask: number): number {
  if (frequency === "DAILY") return EVERY_DAY;
  const m = mask & EVERY_DAY;
  if (frequency === "WEEKLY") {
    if (m === 0 || (m & (m - 1)) !== 0) throw new Error("WEEKLY_ONE_DAY");
    return m;
  }
  if (m === 0) throw new Error("CUSTOM_EMPTY");
  return m;
}

/** [fromKey, toKey] 之間排定日的數量。 */
export function scheduledCount(fromKey: string, toKey: string, mask: number, startKey: string): number {
  let n = 0;
  for (let d = fromKey < startKey ? startKey : fromKey; d <= toKey; d = addDays(d, 1)) if (isScheduled(d, mask)) n++;
  return n;
}
