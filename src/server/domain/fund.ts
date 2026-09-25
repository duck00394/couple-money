/**
 * 基金與目標的計算（純函式）。
 *
 * 三種數字分開：
 *   實際基金金額   = Σ FundTransaction（投入、取回、支出、獎金入金），一定對應到某個帳戶的「指定額度」
 *   尚未入金獎金   = Σ 未結算 TaskReward − Σ 未結算、未免除 TaskPenalty（只是承諾，不是現金）
 *   帳戶可自由使用 = 帳戶餘額 − 帳戶已指定給基金的金額
 */
import { assert } from "./errors";

export const REAL_FUND_TX_TYPES = ["DEPOSIT", "WITHDRAW", "EXPENSE", "REWARD_DEPOSIT"] as const;
export type RealFundTxType = (typeof REAL_FUND_TX_TYPES)[number];
export type FundTxType = RealFundTxType | "TASK_REWARD" | "MILESTONE_BONUS" | "TASK_PENALTY";

export const FUND_TX_LABEL: Record<FundTxType, string> = {
  DEPOSIT: "投入",
  WITHDRAW: "取回",
  EXPENSE: "基金支出",
  REWARD_DEPOSIT: "獎金入金",
  TASK_REWARD: "任務獎金（舊）",
  MILESTONE_BONUS: "里程碑獎金（舊）",
  TASK_PENALTY: "任務懲罰（舊）",
};

const SIGN: Record<RealFundTxType, 1 | -1> = { DEPOSIT: 1, WITHDRAW: -1, EXPENSE: -1, REWARD_DEPOSIT: 1 };

export const isRealFundTx = (t: string): t is RealFundTxType => (REAL_FUND_TX_TYPES as readonly string[]).includes(t);

/** 依類型把正數金額轉成帶正負的分錄金額，並檢查。 */
export function signedFundAmount(type: RealFundTxType, amount: number): number {
  assert(Number.isSafeInteger(amount) && amount > 0, "FUND_AMOUNT", "金額必須大於 0");
  return amount * SIGN[type];
}

export interface FundEntry {
  type: string;
  amount: number; // 帶正負
  userId: string | null;
  accountId: string | null;
}

export interface FundSummary {
  /** 實際基金金額 */
  balance: number;
  /** 每個人（userId 或 "JOINT"）的淨投入：投入 − 取回 */
  contributions: Map<string, number>;
  /** 每個帳戶裡指定給這個基金的金額 */
  byAccount: Map<string, number>;
  deposited: number;
  withdrawn: number;
  spent: number;
  rewardDeposited: number;
}

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

export function summarizeFund(entries: FundEntry[]): FundSummary {
  const s: FundSummary = { balance: 0, contributions: new Map(), byAccount: new Map(), deposited: 0, withdrawn: 0, spent: 0, rewardDeposited: 0 };
  for (const e of entries) {
    if (!isRealFundTx(e.type)) continue; // 舊版直接加基金的獎金紀錄不算實際金額
    s.balance += e.amount;
    if (e.accountId) add(s.byAccount, e.accountId, e.amount);
    const who = e.userId ?? "JOINT";
    switch (e.type) {
      case "DEPOSIT":
        s.deposited += e.amount;
        add(s.contributions, who, e.amount);
        break;
      case "WITHDRAW":
        s.withdrawn += -e.amount;
        add(s.contributions, who, e.amount);
        break;
      case "EXPENSE":
        s.spent += -e.amount;
        break;
      case "REWARD_DEPOSIT":
        s.rewardDeposited += e.amount;
        break;
    }
  }
  return s;
}

export interface PendingItem {
  userId: string | null;
  amount: number; // 正數
}

export interface PendingSummary {
  rewards: number;
  penalties: number;
  /** 尚未入金淨額 = 獎金 − 懲罰（可能為負：懲罰比獎金多） */
  net: number;
  rewardsByUser: Map<string, number>;
  penaltiesByUser: Map<string, number>;
}

export function summarizePending(rewards: PendingItem[], penalties: PendingItem[]): PendingSummary {
  const s: PendingSummary = { rewards: 0, penalties: 0, net: 0, rewardsByUser: new Map(), penaltiesByUser: new Map() };
  for (const r of rewards) {
    s.rewards += r.amount;
    add(s.rewardsByUser, r.userId ?? "COUPLE", r.amount);
  }
  for (const p of penalties) {
    s.penalties += p.amount;
    add(s.penaltiesByUser, p.userId ?? "COUPLE", p.amount);
  }
  s.net = s.rewards - s.penalties;
  return s;
}

/** 帳戶可自由使用金額 = 帳戶餘額 − 已指定給基金。 */
export const freeAmount = (accountBalance: number, earmarked: number) => accountBalance - earmarked;


/** 進度（0～1，超過截斷在 1）；目標金額未設定回傳 null。 */
export function progressOf(current: number, target: number | null | undefined): number | null {
  if (!target || target <= 0) return null;
  return Math.max(0, Math.min(1, current / target));
}

/** 顯示用百分比（無條件捨去到小數一位，例：61.7%）。 */
export function percentText(current: number, target: number): string {
  if (target <= 0) return "0%";
  const pct = Math.floor((Math.max(0, current) * 1000) / target) / 10;
  return `${Math.min(pct, 999.9)}%`;
}
