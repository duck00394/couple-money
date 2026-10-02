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
 * 匯率一律用「1 外幣 = ? 本位幣」這個方向，因為那就是出國時腦子裡的算法：
 * 看到 ¥2,500，想的是「乘 0.22 大概多少台幣」。所以輸入框也只有一個數字：
 *
 *   1 JPY = [0.22] TWD
 *
 * 但存起來**不是小數**，而是一對整數（避免浮點誤差，換算全程整數運算）：
 *
 *   rateForeignUnits  ┐
 *   rateBaseMinor     ┘  baseMinor ÷ (foreignUnits × 本位幣最小單位) 就是那個 0.22
 *
 * 小數位數比本位幣能表示的還多時（例如 1 JPY = 0.2185 TWD，台幣只到分），
 * 就把左右兩邊同時放大 10 的次方 —— 比值一樣，而且兩邊都還是整數：
 *
 *   1 JPY = 0.2185 TWD  →  foreignUnits = 100、baseMinor = 2185
 *
 * 顯示一律由 basePerUnit() 還原回「1 JPY = 0.2185 TWD」，所以使用者看到的
 * 永遠就是他當初輸入的那個數字，放大只是存法的細節。
 */
import { minorPerUnit } from "@/lib/currency";
import { assert } from "./errors";

/** 一筆鎖定在交易上的匯率。null 代表這筆就是本位幣，沒有換算。 */
export interface LockedRate {
  /** 原始幣別代碼，例如 "JPY" */
  currency: string;
  /**
   * 分母：幾「單位」外幣（不是最小單位）。
   * 使用者輸入的方向永遠是「1 外幣」，這裡會是 1；只有小數位數超過本位幣能表示的
   * 範圍時才會是 10 / 100 / … （見檔頭說明）。
   */
  foreignUnits: number;
  /** 分子：等於多少本位幣的**最小單位**。1 JPY = 0.22 TWD → foreignUnits 1、baseMinor 22 */
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

/** 畫面上的匯率說明：「1 JPY = 0.22 TWD」。方向永遠是「1 外幣 = ? 本位幣」。 */
export function rateLabel(rate: LockedRate, baseCurrency: string): string {
  return `1 ${rate.currency} = ${basePerUnit(rate, baseCurrency)} ${baseCurrency}`;
}

/** 匯率輸入框允許的小數位數。日圓 0.2185 這種要四位，留到六位還有餘裕。 */
export const MAX_RATE_DECIMALS = 6;

/**
 * 存起來的整數對 → 畫面上那個數字（「1 外幣 = ? 本位幣」的 ?）。
 *
 * 回傳字串而不是數字，因為這個值只拿去顯示或回填輸入框 ——
 * 任何真正的換算都走 toBaseAmount()，用的是整數對本身。
 */
export function basePerUnit(rate: { foreignUnits: number; baseMinor: number }, baseCurrency: string): string {
  const per = minorPerUnit(baseCurrency);
  const v = rate.baseMinor / (rate.foreignUnits * per);
  if (!Number.isFinite(v)) return "0";
  // 去掉沒有意義的結尾 0：0.220000 → 0.22，30.000000 → 30
  return v.toFixed(MAX_RATE_DECIMALS).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * 使用者輸入的「1 外幣 = ? 本位幣」→ 存起來的整數對。
 *
 * 不合法（空白、非數字、小數位數太多、0）時回傳 null，由呼叫端給錯誤訊息。
 * 全程整數運算：digits 是把小數點拿掉之後的整數，pad / scale 都是 10 的次方。
 */
export function parseRatePair(
  text: string,
  baseCurrency: string,
): { foreignUnits: number; baseMinor: number } | null {
  const cleaned = String(text ?? "").replace(/[,\s]/g, "");
  if (!/^\d*\.?\d+$|^\d+\.?\d*$/.test(cleaned)) return null;
  const [intPart = "", fracRaw = ""] = cleaned.split(".");
  const frac = fracRaw.replace(/0+$/, "");
  if (frac.length > MAX_RATE_DECIMALS) return null;
  const digits = Number(`${intPart || "0"}${frac}`);
  if (!Number.isSafeInteger(digits) || digits <= 0) return null;
  const baseDecimals = String(minorPerUnit(baseCurrency)).length - 1;
  // 本位幣表示得下 → 把數字補成最小單位；表示不下 → 分母跟著放大（比值不變）
  const baseMinor = digits * 10 ** Math.max(0, baseDecimals - frac.length);
  const foreignUnits = 10 ** Math.max(0, frac.length - baseDecimals);
  if (!Number.isSafeInteger(baseMinor) || foreignUnits > MAX_RATE_UNITS) return null;
  return { foreignUnits, baseMinor };
}
