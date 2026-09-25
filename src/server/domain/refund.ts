/**
 * 退款的純規則（無資料庫相依）。
 *
 * 退款是一筆「獨立」的紀錄，關聯到原始消費（relatedId），不會去修改原始消費：
 *   原始消費 $1,000 + 退款 $300 → 實際淨支出 $700
 * 退款的分帳依「原始消費各自負擔的比例」回沖，所以兩人的實際負擔與欠款都會自動重算，
 * 也不需要（也不可以）動到原始消費的 TransactionSplit。
 */
import { allocate, formatMoney, MAX_AMOUNT } from "../../lib/money";
import { assert, DomainError } from "./errors";
import type { SplitLine, SplitRule } from "./split";

export interface RefundSource {
  /** 原始消費金額 */
  amount: number;
  /** 已經退款的金額（不含作廢的退款） */
  refunded: number;
}

/** 這筆消費還可以退多少。 */
export function refundableAmount(s: RefundSource): number {
  return Math.max(0, s.amount - s.refunded);
}

/** 退款金額檢查。 */
export function assertRefundAmount(s: RefundSource, amount: number): void {
  assert(Number.isSafeInteger(amount) && amount > 0, "REFUND_AMOUNT", "請輸入大於 0 的退款金額");
  assert(amount <= MAX_AMOUNT, "REFUND_AMOUNT", "金額太大");
  const max = refundableAmount(s);
  if (max === 0) {
    throw new DomainError("REFUND_FULLY_REFUNDED", `這筆消費 ${formatMoney(s.amount)} 已經全部退款完畢，不能再退。`);
  }
  if (amount > max) {
    throw new DomainError(
      "REFUND_OVER_LIMIT",
      `這筆消費 ${formatMoney(s.amount)} 已退款 ${formatMoney(s.refunded)}，最多只能再退 ${formatMoney(max)}。`,
    );
  }
}

/**
 * 退款的分帳規則：依原始消費「各自負擔的金額」等比例回沖（最大餘數法，總和一定等於退款金額）。
 * 例：消費 $1,000（我 $400、另一半 $600），退款 $300 → 我 −$120、另一半 −$180。
 */
export function refundSplitRule(originalSplits: SplitLine[], amount: number): SplitRule {
  const lines = originalSplits.filter((s) => Math.abs(s.amount) > 0);
  assert(lines.length > 0, "REFUND_NO_SPLIT", "原始消費沒有分帳資料，無法退款");
  const shares = allocate(amount, lines.map((s) => Math.abs(s.amount)));
  return {
    method: "AMOUNT",
    participants: lines.map((s, i) => ({ userId: s.userId, value: shares[i] })),
  };
}
