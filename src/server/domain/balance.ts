/**
 * 由總帳「即時計算」餘額與欠款（純函式）。資料庫不儲存任何餘額欄位。
 */
import { DEBT_TYPES, type TxType } from "./ledger";

export interface LedgerTx {
  type: TxType;
  payments: Array<{ accountId: string; userId: string | null; amount: number }>;
  splits: Array<{ userId: string; amount: number }>;
}

/**
 * 帳戶餘額：−Σpayment。
 *
 * 這是全專案唯一一份「帳戶餘額怎麼算」的定義。service 層只負責把 payment 撈出來，
 * 不要自己再寫一次 `-(sum)`，不然哪天兩邊不一致就會出現對不起來的數字。
 */
export function accountBalances(txs: LedgerTx[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const tx of txs) for (const p of tx.payments) m.set(p.accountId, (m.get(p.accountId) ?? 0) - p.amount);
  return m;
}

/** 單一帳戶的餘額：把已經在資料庫聚合好的 Σpayment 換算成餘額。跟 accountBalances 同一個定義。 */
export const balanceFromPayments = (sumOfPayments: number) => -sumOfPayments;

/**
 * 帳戶可自由使用金額 = 帳戶餘額 − 已指定給基金的金額。
 *
 * 這是全專案唯一一份定義：基金投入、轉帳、記帳、結算全部用它。
 * 只要有一個地方自己重寫一次，基金的「帳上有、實際沒有」就會從那裡漏出去。
 */
export const freeAmount = (balance: number, earmarked: number) => balance - earmarked;

/** 這筆交易是否影響個人之間的欠款。 */
export function affectsDebt(tx: LedgerTx): boolean {
  if (!DEBT_TYPES.includes(tx.type)) return false;
  // 決策 C1：共同帳戶付款／收款的交易，不產生個人欠款
  if (tx.payments.some((p) => p.userId === null)) return false;
  return true;
}

/** 個人淨額：正數 = 別人欠我；負數 = 我欠別人。所有人加總恆為 0。 */
export function netPositions(txs: LedgerTx[], memberIds: string[] = []): Map<string, number> {
  const m = new Map<string, number>(memberIds.map((id) => [id, 0]));
  for (const tx of txs) {
    if (!affectsDebt(tx)) continue;
    for (const p of tx.payments) if (p.userId) m.set(p.userId, (m.get(p.userId) ?? 0) + p.amount);
    for (const s of tx.splits) m.set(s.userId, (m.get(s.userId) ?? 0) - s.amount);
  }
  return m;
}

export interface DebtEdge {
  from: string; // 欠錢的人
  to: string; // 收錢的人
  amount: number;
}

/** 由淨額產生最少筆數的建議結算（貪婪法，結果可重現）。 */
export function suggestSettlements(net: Map<string, number>): DebtEdge[] {
  const debtors = [...net].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const creditors = [...net].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const byAmount = (a: { id: string; v: number }, b: { id: string; v: number }) => b.v - a.v || a.id.localeCompare(b.id);
  debtors.sort(byAmount);
  creditors.sort(byAmount);
  const edges: DebtEdge[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const x = Math.min(debtors[i].v, creditors[j].v);
    if (x > 0) edges.push({ from: debtors[i].id, to: creditors[j].id, amount: x });
    debtors[i].v -= x;
    creditors[j].v -= x;
    if (debtors[i].v === 0) i++;
    if (creditors[j].v === 0) j++;
  }
  return edges;
}

/** from 最多可以結算給 to 的金額（避免超額／重複結算）。 */
export function maxSettleAmount(net: Map<string, number>, from: string, to: string): number {
  const f = net.get(from) ?? 0;
  const t = net.get(to) ?? 0;
  if (f >= 0 || t <= 0) return 0;
  return Math.min(-f, t);
}
