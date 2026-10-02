/**
 * 匯率換算（純函式，無資料庫相依）。
 *
 * 最重要的財務原則，整個功能都圍著它轉：
 *
 *   **匯率是交易發生時的資料，不是永遠動態查詢的資料。**
 *
 * 所以換算只在「建立／編輯交易」那一刻發生一次，算出來的本位幣金額寫進
 * Transaction.amount，連同當時用的匯率一起存起來。之後使用者改匯率設定，
 * 舊交易的 amount 早就是固定的數字了 —— 不是「我們記得不要重算」，
 * 而是**根本沒有任何程式會拿現在的匯率去碰歷史交易**。
 *
 * 匯率的存法刻意不是小數，而是一對整數：
 *
 *   rateForeignUnits = 100     ┐
 *   rateBaseMinor    = 2150    ┘  就是畫面上那句「100 JPY = 21.5 TWD」
 *
 * 好處有三個：
 *   1. 跟使用者輸入的東西一模一樣，不會有「存 0.215 顯示 21.5」的來回轉換誤差
 *   2. 換算全程整數運算，沒有浮點誤差
 *   3. 畫面可以直接顯示「100 JPY = 21.5 TWD」，而不是容易看錯的「JPY 0.215」
 */
import { minorPerUnit } from "@/lib/currency";
import { assert } from "./errors";

/** 一筆鎖定在交易上的匯率。null 代表這筆就是本位幣，沒有換算。 */
export interface LockedRate {
  /** 原始幣別代碼，例如 "JPY" */
  currency: string;
  /** 匯率左邊的數字：幾「單位」外幣（不是最小單位），例如 100 */
  foreignUnits: number;
  /** 匯率右邊的數字：等於多少本位幣的**最小單位**，例如 2150（= 21.5 TWD） */
  baseMinor: number;
}

export const MAX_RATE_UNITS = 1_000_000;

/** 匯率本身合不合法。設定頁與建立交易都走這一份檢查。 */
export function assertRate(rate: { foreignUnits: number; baseMinor: number }) {
  assert(
    Number.isSafeInteger(rate.foreignUnits) && rate.foreignUnits > 0 && rate.foreignUnits <= MAX_RATE_UNITS,
    "RATE_UNITS",
    "匯率左邊的數量必須是大於 0 的整數",
  );
  assert(
    Number.isSafeInteger(rate.baseMinor) && rate.baseMinor > 0,
    "RATE_VALUE",
    "請輸入匯率",
  );
}

/**
 * 外幣最小單位 → 本位幣最小單位。
 *
 *   baseMinor = foreignMinor ÷ 10^foreignDecimals × baseMinorPerUnit ÷ foreignUnits
 *
 * 例：¥2,500，100 JPY = 21.5 TWD
 *   JPY 沒有小數 → 2500 最小單位 = 2500 單位
 *   2500 × 2150 ÷ 100 = 53,750 最小單位 = NT$537.50
 *
 * 先乘後除，而且用 Math.round 收尾：除不盡時只在最後一步進位，
 * 不會每一步都損失精度。
 */
export function toBaseAmount(foreignMinor: number, rate: LockedRate): number {
  assertRate(rate);
  assert(Number.isSafeInteger(foreignMinor), "RATE_AMOUNT", "金額不正確");
  const per = minorPerUnit(rate.currency);
  // foreignMinor / per = 外幣單位數；再乘 baseMinor / foreignUnits
  const numerator = foreignMinor * rate.baseMinor;
  const denominator = per * rate.foreignUnits;
  assert(Number.isSafeInteger(numerator), "RATE_OVERFLOW", "金額太大，請分成多筆記錄");
  const sign = numerator < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(numerator) / denominator);
}

/**
 * 本位幣最小單位 → 外幣最小單位（反向，只用在顯示）。
 *
 * 用在「這筆分帳換算回日圓大概是多少」。因為是反推，**不保證加總等於原始外幣金額**，
 * 所以要讓各人的外幣份額剛好加回總額時，請用 allocateForeign()。
 */
export function toForeignAmount(baseMinor: number, rate: LockedRate): number {
  assertRate(rate);
  const per = minorPerUnit(rate.currency);
  const sign = baseMinor < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(baseMinor) * rate.foreignUnits * per) / rate.baseMinor);
}

/**
 * 把外幣總額依「本位幣的分帳比例」拆開，且**保證加總剛好等於外幣總額**。
 *
 * 分帳是在本位幣上算的（既有 domain 不動），但畫面要能顯示
 * 「¥10,000 → A ¥5,000 / B ¥5,000」。一個一個反推會因為四捨五入而湊不回 ¥10,000，
 * 所以這裡用最大餘數法分配，最後一塊錢給餘數最大的人。
 */
export function allocateForeign(foreignTotal: number, baseShares: number[]): number[] {
  const total = baseShares.reduce((a, b) => a + b, 0);
  if (total === 0 || baseShares.length === 0) return baseShares.map(() => 0);
  const exact = baseShares.map((s) => (s * foreignTotal) / total);
  const floored = exact.map((x) => Math.floor(x));
  let rest = foreignTotal - floored.reduce((a, b) => a + b, 0);
  // 餘數大的先拿；同餘數時依索引，結果可重現
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floored];
  for (const { i } of order) {
    if (rest <= 0) break;
    out[i] += 1;
    rest -= 1;
  }
  return out;
}

/** 畫面上的匯率說明：「100 JPY = 21.5 TWD」。刻意不顯示 0.215 那種容易看錯的寫法。 */
export function rateLabel(rate: LockedRate, baseCurrency: string): string {
  const base = formatPlain(rate.baseMinor, baseCurrency);
  return `${rate.foreignUnits.toLocaleString("en-US")} ${rate.currency} = ${base} ${baseCurrency}`;
}

/** 不帶符號的數字字串（給 rateLabel 用，避免出現「= NT$21.5 TWD」這種重複）。 */
function formatPlain(minor: number, code: string): string {
  const per = minorPerUnit(code);
  if (per === 1) return minor.toLocaleString("en-US");
  const s = (minor / per).toFixed(String(per).length - 1);
  // 去掉沒有意義的結尾 0：21.50 → 21.5，但 21.00 → 21
  return s.replace(/\.?0+$/, "");
}

/**
 * 一個「合理的預設匯率左邊單位」。
 *
 * 日圓與韓元的數字很大，寫「1 JPY = 0.215 TWD」很難讀，所以預設用 100 / 1000。
 * 這只是建立設定時的起始值，使用者可以自己改。
 */
export function suggestedUnits(code: string): number {
  return { JPY: 100, KRW: 1000 }[code] ?? 1;
}
