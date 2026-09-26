/**
 * 逐筆欠款（純函式，沒有資料庫相依，也沒有任何新的資料表）。
 *
 * ## 為什麼是「推導」而不是「儲存」
 *
 * 這個 App 的欠款一直都是**淨額聚合**：`netPositions()` 把每一筆的付款與分帳
 * 加總起來，得到「誰欠誰多少」。資料庫裡沒有、也不會有「這筆消費你還欠我多少」
 * 這種狀態欄位，`Settlement` 也沒有指向任何一筆消費。
 *
 * 所以這裡不發明第二套帳務核心，只做一件事：**把同一份資料換個方式呈現**。
 *   1. 每筆交易對「我欠對方」的貢獻 = 我的分帳 − 我的付款
 *   2. 貢獻為正的是「欠款項目」；為負的（我多付的、退款、已經還過的結算）是「沖銷額」
 *   3. 沖銷額由**最早記錄的欠款項目**開始扣（FIFO）
 *
 * 所有項目的「尚未還款」加總，恆等於 `maxSettleAmount()` 算出來的欠款總額——
 * 這是這個檔案唯一需要保證的不變式，測試會直接驗證它。
 *
 * ## 誠實揭露
 *
 * 結算**沒有**被綁定到任何一筆交易。畫面上勾選項目只是在決定「這次還多少錢」，
 * 實際沖銷順序永遠是「最早記錄的先沖銷」。UI 必須把這件事寫出來。
 */
import { affectsDebt, type LedgerTx } from "./balance";

/** 推導逐筆欠款需要的最少欄位。 */
export interface DebtSourceTx extends LedgerTx {
  id: string;
  /** YYYY-MM-DD（帳本時區） */
  dateKey: string;
  title: string;
  /** 原始金額（畫面顯示用，不參與計算） */
  amount: number;
  icon: string;
}

export interface DebtItem {
  id: string;
  dateKey: string;
  title: string;
  icon: string;
  /** 這筆交易的原始金額 */
  amount: number;
  /** 我應負擔的金額（這筆的分帳結果） */
  myShare: number;
  /** 這筆讓我欠對方多少（= 我的分帳 − 我自己付掉的部分），恆 > 0 */
  owed: number;
  /** 已經被還款沖銷掉多少 */
  settled: number;
  /** 還沒還的部分 */
  remaining: number;
}

export interface DebtItemsView {
  /** 尚未還款總額，恆等於 maxSettleAmount() */
  total: number;
  /** 已經被沖銷掉的總額（結算、退款、我多付的部分） */
  settled: number;
  /** 由舊到新 */
  items: DebtItem[];
  /**
   * 沖銷額比所有欠款項目加起來還多時，多出來的部分。
   * 正常情況恆為 0；有歷史資料算不出來時寧可顯示「未分配」，也不要自己猜。
   */
  unassignedCredit: number;
}

const sumBy = <T>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);

/** 已經還清的項目最多留幾筆（讓人看得到剛還掉什麼，又不會無限長）。 */
export const KEEP_SETTLED = 10;

/**
 * @param txs   帳本裡所有 POSTED、未刪除的交易，**必須依記錄順序（createdAt）由舊到新排好**
 * @param meId  要看誰的欠款（我）
 *
 * 兩個刻意的設計：
 *
 * 1. **結算永遠不是「欠款項目」**。結算是還錢的動作，不是欠錢的原因，
 *    所以它只會進到沖銷額，不會出現在可勾選的清單裡。
 * 2. **兩人一旦互不相欠，前面的帳就翻頁**。走到某個時間點欠款歸零（或反向）時，
 *    之前的項目全部標記為已還清、不再參與之後的沖銷。這樣清單永遠是
 *    「目前這一輪還沒還清的項目」，也不會出現「還了錢但舊項目還掛著」的怪狀態。
 */
export function buildDebtItems(txs: DebtSourceTx[], meId: string, keepSettled = KEEP_SETTLED): DebtItemsView {
  const items: DebtItem[] = [];
  let credit = 0;
  /** 這一輪的起點：在它之前的項目已經結清，不再參與沖銷 */
  let round = 0;
  /** 我目前欠對方多少（負數 = 對方欠我） */
  let running = 0;

  for (const tx of txs) {
    // 用的是既有的同一個判斷式：共同帳戶付款不產生個人欠款
    if (!affectsDebt(tx)) continue;
    const myPaid = sumBy(tx.payments, (p) => (p.userId === meId ? p.amount : 0));
    const myShare = sumBy(tx.splits, (s) => (s.userId === meId ? s.amount : 0));
    const delta = myShare - myPaid; // > 0 = 這筆讓我欠更多
    running += delta;

    if (delta > 0 && tx.type !== "SETTLEMENT") {
      items.push({
        id: tx.id,
        dateKey: tx.dateKey,
        title: tx.title,
        icon: tx.icon,
        amount: tx.amount,
        myShare,
        owed: delta,
        settled: 0,
        remaining: delta,
      });
    } else {
      // 我多付的、退款、以及所有結算，一律當成沖銷額
      credit += -delta;
    }

    // 走到互不相欠（或變成對方欠我）：這一輪結清，前面的項目翻頁
    if (running <= 0) {
      for (let i = round; i < items.length; i++) {
        items[i].settled = items[i].owed;
        items[i].remaining = 0;
      }
      round = items.length;
      credit = Math.max(0, -running); // 對方多還的部分留著，抵掉之後的新帳（避免 -0）
    }
  }

  // FIFO：沖銷額從這一輪最早記錄的一筆開始扣
  let left = credit;
  for (let i = round; i < items.length; i++) {
    if (left <= 0) break;
    const take = Math.min(left, items[i].remaining);
    items[i].settled += take;
    items[i].remaining -= take;
    left -= take;
  }

  // 已還清的只留最近幾筆，清單不會無限長
  const settledBefore = items.slice(0, round);
  const kept = settledBefore.slice(Math.max(0, settledBefore.length - keepSettled));

  return {
    total: sumBy(items, (i) => i.remaining),
    settled: credit - left,
    items: [...kept, ...items.slice(round)],
    unassignedCredit: left,
  };
}
