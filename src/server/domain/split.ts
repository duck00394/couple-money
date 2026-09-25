/**
 * 分帳規則引擎（純函式，無資料庫相依）。
 * Split = 每個人「應該負擔」多少；與 Payment（誰實際付錢）完全分開。
 */
import { allocate, formatMoney, sum } from "../../lib/money";
import { DomainError, assert } from "./errors";

export const SPLIT_METHODS = ["EQUAL", "RATIO", "AMOUNT", "FULL", "SHARES"] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export const SPLIT_METHOD_LABEL: Record<SplitMethod, string> = {
  EQUAL: "平均分攤",
  RATIO: "自訂比例",
  AMOUNT: "自訂金額",
  FULL: "一方全付",
  SHARES: "依份數",
};

export interface SplitParticipant {
  userId: string;
  /**
   * RATIO：百分比（可到小數兩位，總和須為 100）
   * SHARES：份數（正整數）
   * AMOUNT：最小單位金額（總和須等於 total）
   * EQUAL / FULL：忽略
   */
  value?: number;
}

export interface SplitRule {
  method: SplitMethod;
  participants: SplitParticipant[];
}

export interface SplitLine {
  userId: string;
  amount: number;
}

/** 依規則把 total（最小單位，> 0）分配給參與者。 */
export function computeSplit(total: number, rule: SplitRule): SplitLine[] {
  assert(Number.isSafeInteger(total) && total > 0, "SPLIT_TOTAL", "金額必須大於 0");
  const ps = rule.participants;
  assert(ps.length > 0, "SPLIT_EMPTY", "至少要有一位分攤者");
  const ids = new Set(ps.map((p) => p.userId));
  assert(ids.size === ps.length, "SPLIT_DUPLICATE", "分攤者不可重複");

  let amounts: number[];
  switch (rule.method) {
    case "EQUAL":
      amounts = allocate(total, ps.map(() => 1));
      break;
    case "FULL":
      assert(ps.length === 1, "SPLIT_FULL_ONE", "「一方全付」只能選一位負擔者");
      amounts = [total];
      break;
    case "RATIO": {
      const vals = ps.map((p) => Number(p.value ?? NaN));
      assert(vals.every((v) => Number.isFinite(v) && v >= 0), "SPLIT_RATIO_INVALID", "比例必須是 0 以上的數字");
      // 以萬分比整數比較，避免 33.33 + 66.67 的浮點誤差
      const bp = vals.map((v) => Math.round(v * 100));
      assert(sum(bp) === 10000, "SPLIT_RATIO_SUM", `比例總和必須是 100%（目前 ${sum(bp) / 100}%）`);
      amounts = allocate(total, bp);
      break;
    }
    case "SHARES": {
      const vals = ps.map((p) => Number(p.value ?? NaN));
      assert(vals.every((v) => Number.isInteger(v) && v >= 0), "SPLIT_SHARES_INVALID", "份數必須是 0 以上的整數");
      assert(sum(vals) > 0, "SPLIT_SHARES_SUM", "份數總和必須大於 0");
      amounts = allocate(total, vals);
      break;
    }
    case "AMOUNT": {
      const vals = ps.map((p) => Number(p.value ?? NaN));
      assert(vals.every((v) => Number.isSafeInteger(v) && v >= 0), "SPLIT_AMOUNT_INVALID", "分攤金額必須是 0 以上");
      assert(
        sum(vals) === total,
        "SPLIT_AMOUNT_SUM",
        `各自金額加總（${formatMoney(sum(vals))}）必須等於總金額（${formatMoney(total)}）`,
      );
      amounts = vals;
      break;
    }
    default:
      throw new DomainError("SPLIT_METHOD", "不支援的分帳方式");
  }
  return ps.map((p, i) => ({ userId: p.userId, amount: amounts[i] })).filter((l) => l.amount !== 0);
}

/** 預設分帳規則解析順序：交易指定 > 分類規則 > 父分類規則 > 帳本預設 > 全員平均。 */
export function resolveDefaultRule(
  candidates: Array<SplitRule | null | undefined>,
  memberIds: string[],
): SplitRule {
  for (const c of candidates) {
    if (c && c.participants.length > 0 && c.participants.every((p) => memberIds.includes(p.userId))) return c;
  }
  return { method: "EQUAL", participants: memberIds.map((userId) => ({ userId })) };
}
