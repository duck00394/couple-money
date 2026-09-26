/**
 * 預購的純邏輯。
 *
 * 最重要的一條規則：**待結款不是支出**。
 * 還沒付的錢仍然在你的帳戶裡，所以它不扣餘額、也不進任何月份的統計；
 * 只有真的建立那一筆 Transaction 的時候，錢才算花出去。
 *
 * 因此這裡完全不存「已付多少」「還欠多少」——那兩個數字一律由
 * 這張單底下的 Transaction 現算，不可能跟帳務對不起來。
 */

/** 訂單狀態：不存在資料庫裡，由「有沒有取消」＋「還欠多少」算出來。 */
export type PreorderState = "ACTIVE" | "SETTLED" | "CANCELLED";

export const STATE_LABEL: Record<PreorderState, string> = {
  ACTIVE: "進行中",
  SETTLED: "已結清",
  CANCELLED: "已取消",
};

export interface PreorderMoney {
  /** 商品 + 運費 */
  total: number;
  /** 已經真的付出去的（扣掉退款） */
  paid: number;
  /** 還沒付的：total − paid，不會是負數 */
  remaining: number;
  /** 付太多的部分（退款比付款多、或超付）；正常是 0 */
  overpaid: number;
}

export function moneyOf(itemAmount: number, shipping: number, paidGross: number, refunded: number): PreorderMoney {
  const total = itemAmount + shipping;
  const paid = paidGross - refunded;
  const diff = total - paid;
  return { total, paid, remaining: Math.max(0, diff), overpaid: Math.max(0, -diff) };
}

export function stateOf(cancelledAt: Date | null, money: PreorderMoney): PreorderState {
  if (cancelledAt) return "CANCELLED";
  return money.remaining === 0 ? "SETTLED" : "ACTIVE";
}

/**
 * 列表排序：快到貨又還沒付完的排最前面，取消的沉到最後。
 * 同一組裡面照預計到貨日，沒填日期的排在有日期的後面。
 */
export function sortKey(state: PreorderState, expectedOn: string | null, daysLeft: number | null): [number, number, string] {
  const group =
    state === "CANCELLED" ? 3
    : state === "SETTLED" ? 2
    : daysLeft !== null && daysLeft <= 7 ? 0 // 進行中且 7 天內到貨
    : 1;
  return [group, expectedOn ? 0 : 1, expectedOn ?? "9999-12-31"];
}

/** 距離到貨還有幾天（過期是負數）。沒有預計到貨日就是 null。 */
export function daysUntil(expectedOn: string | null, today: string): number | null {
  if (!expectedOn) return null;
  const ms = Date.parse(`${expectedOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86400_000);
}

/** 到貨提示的白話文案。 */
export function etaText(expectedOn: string | null, today: string): string {
  const d = daysUntil(expectedOn, today);
  if (d === null) return "沒有預計到貨日";
  if (d < 0) return `預計到貨日已過 ${-d} 天`;
  if (d === 0) return "今天到貨";
  if (d === 1) return "明天到貨";
  if (d <= 7) return `${d} 天後到貨`;
  return `預計 ${(expectedOn ?? "").replaceAll("-", "/")} 到貨`;
}
