/**
 * 總帳分錄產生器（純函式）。
 *
 * 符號慣例（整個系統唯一的定義）：
 *   Payment.amount > 0：錢從該帳戶／該人「流出」
 *   Payment.amount < 0：錢「流入」該帳戶／該人
 *   Split.amount   > 0：該人「負擔」這筆花費
 *   Split.amount   < 0：該人「受益」（收入、退款）
 *
 * 不變式：
 *   EXPENSE / INCOME / REFUND：Σpayment === Σsplit === ±amount
 *   TRANSFER / SETTLEMENT：Σpayment === 0，沒有 split
 *   OPENING_BALANCE / ADJUSTMENT：只有 payment，沒有 split，不影響欠款
 *   帳戶餘額 = −Σ(該帳戶 payment)
 */
import { sum } from "../../lib/money";
import { assert } from "./errors";
import { computeSplit, type SplitLine, type SplitRule } from "./split";

export const TX_TYPES = [
  "EXPENSE",
  "INCOME",
  "REFUND",
  "TRANSFER",
  "SETTLEMENT",
  "OPENING_BALANCE",
  "ADJUSTMENT",
] as const;
export type TxType = (typeof TX_TYPES)[number];

export const TX_TYPE_LABEL: Record<TxType, string> = {
  EXPENSE: "支出",
  INCOME: "收入",
  REFUND: "退款",
  TRANSFER: "轉帳",
  SETTLEMENT: "結算",
  OPENING_BALANCE: "期初餘額",
  ADJUSTMENT: "餘額調整",
};

/** 會計入收支統計的型別（轉帳、結算、期初、調整都不算收支）。 */
export const INCOME_EXPENSE_TYPES: readonly TxType[] = ["EXPENSE", "INCOME", "REFUND"];
/** 會影響「誰欠誰」的型別。 */
export const DEBT_TYPES: readonly TxType[] = ["EXPENSE", "INCOME", "REFUND", "SETTLEMENT"];

export interface AccountRef {
  id: string;
  /** null = 共同帳戶 */
  ownerId: string | null;
}

export interface PaymentLine {
  accountId: string;
  userId: string | null;
  amount: number;
}

export interface LedgerLines {
  payments: PaymentLine[];
  splits: SplitLine[];
}

export interface PayerInput {
  account: AccountRef;
  amount: number; // > 0
}

/** 支出、收入、退款：付款（或收款）帳戶 + 分帳規則。 */
export function buildFlowLines(
  type: "EXPENSE" | "INCOME" | "REFUND",
  amount: number,
  payers: PayerInput[],
  rule: SplitRule,
): LedgerLines {
  assert(Number.isSafeInteger(amount) && amount > 0, "TX_AMOUNT", "金額必須大於 0");
  assert(payers.length > 0, "TX_PAYER", type === "EXPENSE" ? "請選擇付款帳戶" : "請選擇收款帳戶");
  assert(
    payers.every((p) => Number.isSafeInteger(p.amount) && p.amount > 0),
    "TX_PAYER_AMOUNT",
    "付款金額必須大於 0",
  );
  assert(sum(payers.map((p) => p.amount)) === amount, "TX_PAYER_SUM", "付款金額加總必須等於總金額");
  const accountIds = new Set(payers.map((p) => p.account.id));
  assert(accountIds.size === payers.length, "TX_PAYER_DUP", "付款帳戶不可重複");
  const hasShared = payers.some((p) => p.account.ownerId === null);
  assert(
    !hasShared || payers.length === 1,
    "TX_MIXED_SHARED",
    "共同帳戶付款不能與個人帳戶混合，請拆成兩筆",
  );

  const dir = type === "EXPENSE" ? 1 : -1;
  const splits = computeSplit(amount, rule).map((s) => ({ userId: s.userId, amount: s.amount * dir }));
  const payments = payers.map((p) => ({
    accountId: p.account.id,
    userId: p.account.ownerId,
    amount: p.amount * dir,
  }));
  return checkInvariants(type, { payments, splits }, amount);
}

/** 帳戶間轉帳：Transfer Out（from）＋ Transfer In（to），不計收支。 */
export function buildTransferLines(amount: number, from: AccountRef, to: AccountRef): LedgerLines {
  assert(Number.isSafeInteger(amount) && amount > 0, "TX_AMOUNT", "金額必須大於 0");
  assert(from.id !== to.id, "TRANSFER_SAME", "轉出與轉入帳戶不能相同");
  return checkInvariants(
    "TRANSFER",
    {
      payments: [
        { accountId: from.id, userId: from.ownerId, amount },
        { accountId: to.id, userId: to.ownerId, amount: -amount },
      ],
      splits: [],
    },
    amount,
  );
}

/** 結算：fromUser 付錢給 toUser。 */
export function buildSettlementLines(
  amount: number,
  from: AccountRef & { ownerId: string },
  to: AccountRef & { ownerId: string },
): LedgerLines {
  assert(Number.isSafeInteger(amount) && amount > 0, "TX_AMOUNT", "金額必須大於 0");
  assert(from.ownerId && to.ownerId, "SETTLE_PERSONAL", "結算必須使用個人帳戶");
  assert(from.ownerId !== to.ownerId, "SETTLE_SAME", "付款人與收款人不能是同一人");
  return checkInvariants(
    "SETTLEMENT",
    {
      payments: [
        { accountId: from.id, userId: from.ownerId, amount },
        { accountId: to.id, userId: to.ownerId, amount: -amount },
      ],
      splits: [],
    },
    amount,
  );
}

/** 期初餘額／餘額調整：delta > 0 代表帳戶增加。 */
export function buildBalanceLines(type: "OPENING_BALANCE" | "ADJUSTMENT", delta: number, account: AccountRef): LedgerLines {
  assert(Number.isSafeInteger(delta) && delta !== 0, "TX_AMOUNT", "調整金額不可為 0");
  return checkInvariants(
    type,
    { payments: [{ accountId: account.id, userId: account.ownerId, amount: -delta }], splits: [] },
    Math.abs(delta),
  );
}

export function checkInvariants(type: TxType, lines: LedgerLines, amount: number): LedgerLines {
  const ps = sum(lines.payments.map((p) => p.amount));
  const ss = sum(lines.splits.map((s) => s.amount));
  switch (type) {
    case "EXPENSE":
      assert(ps === amount && ss === amount, "INVARIANT", "分錄不平衡（支出）");
      break;
    case "INCOME":
    case "REFUND":
      assert(ps === -amount && ss === -amount, "INVARIANT", "分錄不平衡（收入／退款）");
      break;
    case "TRANSFER":
    case "SETTLEMENT":
      assert(ps === 0 && lines.splits.length === 0, "INVARIANT", "分錄不平衡（轉帳／結算）");
      break;
    case "OPENING_BALANCE":
    case "ADJUSTMENT":
      assert(lines.splits.length === 0 && Math.abs(ps) === amount, "INVARIANT", "分錄不平衡（餘額調整）");
      break;
  }
  return lines;
}
