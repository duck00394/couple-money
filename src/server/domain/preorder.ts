import { allocate } from "@/lib/money";
import { computeSplit, type SplitRule } from "./split";

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

/* ───────────────────── 明細品項 ───────────────────── */

export interface PreorderItemLine {
  name: string;
  /** 單價（最小單位） */
  unitAmount: number;
  qty: number;
  /** 這件是誰的：null = 共同 */
  ownerId: string | null;
}

/** 明細品項的小計。 */
export const lineTotal = (item: PreorderItemLine) => item.unitAmount * item.qty;

/** 有明細品項時，商品金額就是它們的加總（不再手動填）。 */
export const itemsTotal = (items: PreorderItemLine[]) => items.reduce((a, i) => a + lineTotal(i), 0);

/**
 * 由明細品項推出「誰付多少」的金額分配 —— 這就是「依『誰的』」的定義。
 *
 * 每件東西標了「誰的」就算誰的；標「共同」的那幾件跟運費一起平分。
 * 「共同」永遠是平分，不會因為整張單掛在誰名下就變成誰的 ——
 * 使用者已經在那一列明確選了共同，不該被上面的欄位推翻。
 *
 * 這是全專案唯一一份「依『誰的』怎麼分」的定義：畫面上的即時預覽、
 * 「依明細品項帶入金額」的捷徑、以及 duesOf() 算出來的實際應負擔，全部走這裡，
 * 不然畫面顯示的跟真正生效的會是兩件事。
 */
export function duesFromItems(
  items: PreorderItemLine[],
  memberIds: string[],
  opts: { shipping?: number } = {},
): Map<string, number> {
  const out = new Map<string, number>(memberIds.map((id) => [id, 0]));
  const add = (id: string, n: number) => out.set(id, (out.get(id) ?? 0) + n);
  let joint = opts.shipping ?? 0;
  for (const item of items) {
    const amount = lineTotal(item);
    if (item.ownerId && out.has(item.ownerId)) add(item.ownerId, amount);
    else joint += amount;
  }
  if (joint !== 0 && memberIds.length > 0) {
    const parts = allocate(joint, memberIds.map(() => 1));
    memberIds.forEach((id, i) => add(id, parts[i]));
  }
  return out;
}

/** 這批品項裡有沒有人真的被標到（標給已離開的人不算）。 */
export const hasOwnedItem = (items: PreorderItemLine[], memberIds: string[]) =>
  items.some((it) => it.ownerId !== null && memberIds.includes(it.ownerId));

/* ───────────────────── 每個人還需付多少 ───────────────────── */

export interface PreorderShare {
  userId: string;
  /** 這張單這個人應該負擔多少 */
  due: number;
  /** 已經負擔掉多少（已付款那幾筆的分帳結果，扣掉退款） */
  borne: number;
  /** 還需要付多少：due − borne，不會是負數 */
  remaining: number;
  /** 負擔超過應負擔的部分（多付了）；正常是 0 */
  over: number;
}

/**
 * 「誰付多少」：每個人應負擔的金額。
 *
 * 三段式，由明確到模糊：
 *   1. 有存分帳規則（平分／比例／金額／一人全付）→ 用**既有的** `computeSplit()`，
 *      跟記帳的分帳走同一套引擎，這裡不自己算。
 *   2. 沒存規則、但品項裡有人被標到 → 這就是「依『誰的』」：每件東西算它標的那個人的，
 *      標共同的品項與運費平分。**不是一律平分**。
 *   3. 沒有品項、或品項全部都是「共同」→ 只能看整張單的「誰的」：
 *      指定了就算他的、共同就平分。
 *
 * 規則壞掉（例如成員換了、金額對不起來）時退回下一段，寧可保守，也不要讓畫面爆掉。
 */
export function duesOf(
  total: number,
  splitRule: SplitRule | null,
  ownerId: string | null,
  memberIds: string[],
  items: PreorderItemLine[] = [],
): Map<string, number> {
  const ids = memberIds.length > 0 ? memberIds : ownerId ? [ownerId] : [];
  if (ids.length === 0) return new Map();
  if (total <= 0) return new Map(ids.map((id) => [id, 0]));

  if (splitRule) {
    const known = splitRule.participants.filter((p) => ids.includes(p.userId));
    if (known.length === splitRule.participants.length && known.length > 0) {
      try {
        const lines = computeSplit(total, splitRule);
        const m = new Map<string, number>(ids.map((id) => [id, 0]));
        for (const l of lines) m.set(l.userId, l.amount);
        return m;
      } catch {
        // 規則算不出來就往下走，用舊行為
      }
    }
  }

  // 有人被標到的品項 → 依品項的「誰的」分，運費與共同品項平分。
  // 全部都是「共同」時就沒有東西可依，退回下面看整張單的「誰的」，
  // 否則一張標明「這是小艾的」的單會因為品項都沒標而莫名其妙變成平分。
  if (hasOwnedItem(items, ids)) {
    const goods = itemsTotal(items);
    const shipping = Math.max(0, total - goods);
    if (goods + shipping === total) {
      const dues = duesFromItems(items, ids, { shipping });
      return new Map(ids.map((id) => [id, dues.get(id) ?? 0]));
    }
  }

  const weights = ownerId === null ? ids.map(() => 1) : ids.map((id) => (id === ownerId ? 1 : 0));
  // 「誰的」指向已經不在帳本裡的人時，退回平分，免得金額憑空消失
  const parts = weights.some((w) => w > 0) ? allocate(total, weights) : allocate(total, ids.map(() => 1));
  return new Map(ids.map((id, i) => [id, parts[i]]));
}

/**
 * 把「應負擔」與「已負擔」湊成畫面要的樣子。
 *
 * 「已負擔」不是自己算的——是把這張單底下每一筆付款的**既有分帳結果**加總，
 * 所以「這次我先付，下次你付」「這次兩人平分」都能正確反映，
 * 不需要在預購這邊再發明一套分帳規則。
 */
export function sharesOf(
  total: number,
  splitRule: SplitRule | null,
  ownerId: string | null,
  memberIds: string[],
  borneByUser: Map<string, number>,
  items: PreorderItemLine[] = [],
): PreorderShare[] {
  const dues = duesOf(total, splitRule, ownerId, memberIds, items);
  return [...dues.entries()].map(([userId, due]) => {
    const borne = borneByUser.get(userId) ?? 0;
    const diff = due - borne;
    return { userId, due, borne, remaining: Math.max(0, diff), over: Math.max(0, -diff) };
  });
}
