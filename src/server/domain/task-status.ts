/**
 * 「今天這張卡到底算完成了沒」的唯一定義（純函式，沒有資料庫相依）。
 *
 * 任務頁有兩個清單：佈告欄「今天完成的」與下面的「今天」。
 * 如果兩邊各自判斷一次，同一張卡就會同時出現在兩個清單裡（原本就是這樣）。
 * 這裡把規則寫死成一份，兩個清單都用它，而且互斥。
 *
 * 三種週期的差別：
 *   - 每日：今天打過卡（含待確認）就算完成
 *   - 每週：這一週打過就算完成，今天沒打也一樣
 *   - 每次（做一次賺一次）：做過了也還可以再做，所以它會**同時**算完成、也還留在待做清單裡
 *     —— 這是刻意的，不然打完一次就找不到「再一次」的按鈕。
 *
 * EACH 任務的「我」與「另一半」是兩張獨立的卡（subjectKey 不同），
 * 所以一方完成不會影響另一方那張卡的判斷。
 */

/** 判斷只需要這幾個欄位；完整的 TaskCard 也符合這個形狀。 */
export interface TaskTodayState {
  /** 「每次」任務：做一次賺一次 */
  perTime: boolean;
  /** 「每週」任務：一週內任一天完成一次即可 */
  weekly: boolean;
  /** 「每週」任務這一週已經完成（含待確認） */
  doneThisWeek: boolean;
  /** 今天最後一筆打卡（已排除取消與被退回的） */
  today: { status: string } | null;
  /** 現在還能不能打卡（權限、是否排定、週期都算進去了） */
  canCheckIn: boolean;
}

/** 今天（或這一週）已經完成過了嗎？ */
export function isDoneToday(c: TaskTodayState): boolean {
  if (c.weekly) return c.doneThisWeek;
  return c.today?.status === "APPROVED" || c.today?.status === "PENDING";
}

/**
 * 還要不要出現在「今天」待做清單裡？
 *
 * 已經完成、而且也不能再打卡的，就只留在佈告欄，不要在待做清單裡重複出現。
 * 「每次」任務完成後 canCheckIn 仍然是 true，所以會留下來讓人再做一次。
 */
export function isPendingToday(c: TaskTodayState): boolean {
  return !isDoneToday(c) || c.canCheckIn;
}
