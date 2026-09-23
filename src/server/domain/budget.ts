/**
 * 每月分類預算的純邏輯（Phase 3-4 B）。
 *
 * 預算只是「花到哪了、還剩多少」的提醒，**不是資金帳本**：
 * 這裡不定義「什麼算支出」——那一律由 /stats 既有的統計口徑決定（見 services/budgets.ts）。
 */
import { assert } from "./errors";
import { MAX_AMOUNT } from "@/lib/money";

/** 用掉幾成算「快超過」 */
export const NEAR_RATIO = 0.8;

export type BudgetState = "OK" | "NEAR" | "OVER";
export const BUDGET_STATE_LABEL: Record<BudgetState, string> = {
  OK: "還好",
  NEAR: "快超過",
  OVER: "已超支",
};

export interface BudgetProgress {
  /** 預算金額 */
  amount: number;
  /** 已支出（支出 − 退款，可能是負的：退款比支出多） */
  spent: number;
  /** 還可以花多少；超支時是負數 */
  remaining: number;
  /** 用掉的比例（0～，超支會大於 1）。預算 ≤ 0 時一律 0 */
  ratio: number;
  state: BudgetState;
  /** 超支金額（沒超支就是 0） */
  over: number;
}

/** 由「預算金額」與「已支出」算出進度。金額一律是最小單位整數，不碰浮點數。 */
export function budgetProgress(amount: number, spent: number): BudgetProgress {
  const remaining = amount - spent;
  const ratio = amount > 0 ? spent / amount : 0;
  const over = remaining < 0 ? -remaining : 0;
  const state: BudgetState = over > 0 ? "OVER" : amount > 0 && spent >= Math.ceil(amount * NEAR_RATIO) ? "NEAR" : "OK";
  return { amount, spent, remaining, ratio, state, over };
}

export function assertBudgetAmount(amount: number): number {
  assert(Number.isSafeInteger(amount) && amount > 0, "BUDGET_AMOUNT", "預算金額必須大於 0");
  assert(amount <= MAX_AMOUNT, "BUDGET_AMOUNT", "預算金額太大了");
  return amount;
}

export interface BudgetSummary {
  count: number;
  ok: number;
  near: number;
  over: number;
  totalAmount: number;
  totalSpent: number;
}

/** 首頁用的一行摘要。只算啟用中的預算。 */
export function summarizeBudgets(list: Array<{ isActive: boolean; progress: BudgetProgress }>): BudgetSummary {
  const active = list.filter((b) => b.isActive);
  return {
    count: active.length,
    ok: active.filter((b) => b.progress.state === "OK").length,
    near: active.filter((b) => b.progress.state === "NEAR").length,
    over: active.filter((b) => b.progress.state === "OVER").length,
    totalAmount: active.reduce((a, b) => a + b.progress.amount, 0),
    totalSpent: active.reduce((a, b) => a + b.progress.spent, 0),
  };
}
