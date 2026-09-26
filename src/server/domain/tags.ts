/**
 * 標籤快選的排序（純函式，沒有資料庫相依）。
 *
 * 標籤本身早就有自己的資料表（Tag / TransactionTag），所以這裡不存任何東西，
 * 只是把「最近的那幾筆記帳用過哪些標籤」歸納成一排可以直接點的 chip。
 *
 * 排序規則（依使用者指定）：
 *   1. 最近使用 —— 越晚用過的排越前面
 *   2. 使用次數 —— 同樣新的時候，用得多的排前面
 *   3. 名稱 —— 讓結果可重現，不會每次重新整理就跳來跳去
 */

/** 一筆記帳用到的標籤名稱；陣列由新到舊。 */
export interface TaggedRow {
  tags: string[];
}

export function rankTags(rows: TaggedRow[], take = 12): string[] {
  // firstSeen = 在「由新到舊」的列表裡第一次出現的位置，越小代表越近期用過
  const stat = new Map<string, { firstSeen: number; count: number }>();
  rows.forEach((row, i) => {
    for (const raw of row.tags) {
      const name = raw.trim();
      if (!name) continue;
      const hit = stat.get(name);
      if (hit) hit.count++;
      else stat.set(name, { firstSeen: i, count: 1 });
    }
  });

  return [...stat.entries()]
    .sort((a, b) => a[1].firstSeen - b[1].firstSeen || b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, take))
    .map(([name]) => name);
}
