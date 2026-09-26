/**
 * 首頁「最近紀錄」的挑選與分組（純函式，沒有資料庫相依）。
 *
 * 規則（依使用者指定）：
 *   - 今天記的全部都要看得到，不會被「首頁只顯示 N 筆」截掉
 *   - 但今天超過 15 筆時先顯示前 15 筆，其餘收在「查看今天全部」裡，避免首頁過長
 *   - 今天以前的只顯示最近 5 筆
 *   - 依日期分組（今天／昨天／其他日期），同一天最新記的排最上面
 *
 * 顯示邏輯仍然是既有的 <TxRow />，這裡只負責「要顯示哪幾筆、怎麼分堆」。
 */

/** 今天最多先顯示幾筆，其餘收起來。 */
export const HOME_TODAY_CAP = 15;
/** 今天以前顯示幾筆。 */
export const HOME_HISTORY_TAKE = 5;

/** 今天的紀錄拆成「先顯示的」與「收起來的」。傳入的陣列必須已經由新到舊排好。 */
export function splitToday<T>(todays: T[], cap = HOME_TODAY_CAP): { shown: T[]; hidden: T[] } {
  if (cap < 0) return { shown: [], hidden: [...todays] };
  return { shown: todays.slice(0, cap), hidden: todays.slice(cap) };
}

export interface DateGroup<T> {
  key: string;
  items: T[];
}

/**
 * 依日期分組，保持傳入的順序（由新到舊）。
 * 不排序、不重組，所以同一天內「最新記的排最上面」完全由查詢的 orderBy 決定。
 */
export function groupByDateKey<T>(rows: T[], keyOf: (row: T) => string): Array<DateGroup<T>> {
  const out: Array<DateGroup<T>> = [];
  for (const row of rows) {
    const key = keyOf(row);
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(row);
    else out.push({ key, items: [row] });
  }
  return out;
}

/**
 * 今天的紀錄改用「記錄的先後」排序（由新到舊）。
 *
 * 交易的 occurredAt 大多只有日期（一律存成當地中午），只有轉帳／退款會帶實際時間。
 * 如果直接用 occurredAt 排，下午 2 點退的款會永遠壓在剛剛才記的那一筆上面，
 * 跟「剛記完要馬上確認」的直覺相反。今天這一組改看 createdAt，就是「最新記的在最上面」。
 */
export function sortTodayByEntry<T extends { createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
