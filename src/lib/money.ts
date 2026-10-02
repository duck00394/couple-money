/**
 * 金額工具。
 * 所有金額在程式與資料庫中一律使用「整數最小單位」（TWD 的 1 元 = 100）。
 * 不使用浮點數做任何加總，避免 0.1 + 0.2 問題。
 */
import { currencyOf } from "./currency";

export const MINOR_PER_UNIT = 100;
export const MAX_AMOUNT = 2_000_000_000; // 2 千萬元（Postgres INT 安全範圍內）

/** 使用者輸入字串 → 最小單位整數。接受 "1,234"、"1234.5"、"$1,234.56"。無效回傳 null。 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[,\s$＄]/g, "").replace(/^NT/i, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const minor = Number(whole) * MINOR_PER_UNIT + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT) return null;
  return minor;
}

/**
 * 同 parseAmount，但接受負號（餘額調整用：銀行餘額、信用卡溢繳都可能是負的）。
 * 其他地方仍然用 parseAmount（金額必須為正），行為不變。
 */
export function parseSignedAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/[\s$＄]/g, "").replace(/^NT/i, "");
  const negative = s.startsWith("-");
  const parsed = parseAmount(negative ? s.slice(1) : s);
  if (parsed === null) return null;
  return negative ? -parsed : parsed;
}

/**
 * 最小單位整數 → 顯示字串。$1,234 或 $1,234.50（有小數才顯示）。
 *
 * **所有帳務金額一律是「帳本本位幣的 1/100」**，不管那個幣別自己有幾位小數。
 * 這是整個系統從第一天就有的約定（TWD 的 1 元 = 100），V15 讓帳本可以有自己的
 * 本位幣之後也沒有改 —— 改儲存單位會動到既有的每一筆資料。
 * 變的只有「怎麼畫出來」：
 *   * 符號跟著帳本的本位幣（JPY → ¥、KRW → ₩）
 *   * 本來就沒有小數的幣別（日圓、韓元）不顯示小數位
 *
 * 注意 `Transaction.foreignAmount` 不走這裡 —— 那個欄位存的是「該外幣真正的
 * 最小單位」（¥2,500 就是 2500），用 lib/currency.ts 的 formatCurrency 顯示。
 */
export function formatMoney(
  minor: number,
  opts: { sign?: boolean; symbol?: string; currency?: string } = {},
): string {
  const cur = opts.currency ? currencyOf(opts.currency) : null;
  // 台幣維持裸的「$」—— 這個 App 從第一天就是這樣顯示的，沒必要因為支援多幣別
  // 就把每一個台幣金額都改成 NT$。「NT$」留給 homeApprox 那一行，
  // 在外幣帳本裡才需要特別點出「這個數字是台幣」。
  const symbol = opts.symbol ?? (cur && cur.code !== "TWD" ? cur.symbol : "$");
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MINOR_PER_UNIT);
  const frac = abs % MINOR_PER_UNIT;
  const wholeStr = whole.toLocaleString("en-US");
  // 日圓／韓元沒有小數：四捨五入到整數，不要畫出 ¥2,000.50 這種不存在的金額
  const noMinor = cur ? cur.decimals === 0 : false;
  const body = noMinor
    ? Math.round(abs / MINOR_PER_UNIT).toLocaleString("en-US")
    : frac === 0
      ? wholeStr
      : `${wholeStr}.${String(frac).padStart(2, "0")}`;
  const prefix = neg ? "-" : opts.sign && minor > 0 ? "+" : "";
  return `${prefix}${symbol}${body}`;
}

/**
 * 綁定帳本本位幣的格式化函式。
 *
 * 每個會顯示金額的畫面在最上面做一次
 *   `const m = moneyFmt(ctx.book.baseCurrency);`（Client Component 用 useCurrency()）
 * 之後 `m(1234)` 就會自動用對的符號與小數位。
 * 這樣不需要在 200 多個呼叫點各寫一次幣別，也不會有「漏掉一處就顯示成台幣」的風險。
 */
export const moneyFmt =
  (currency: string) =>
  (minor: number, opts: { sign?: boolean; symbol?: string } = {}) =>
    formatMoney(minor, { ...opts, currency });

/** 最小單位 → 表單輸入用字串（不含符號與千分位）。 */
export function toInputString(minor: number): string {
  const whole = Math.trunc(minor / MINOR_PER_UNIT);
  const frac = Math.abs(minor % MINOR_PER_UNIT);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/**
 * 依權重分配整數金額（最大餘數法）。
 * 保證：回傳值加總 === total，且每個值 >= 0（total >= 0 時）。
 * 尾差依「餘數大 → 權重大 → 原始順序」分配，結果可重現。
 */
export function allocate(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total)) throw new Error("total must be an integer");
  if (weights.length === 0) throw new Error("weights must not be empty");
  if (weights.some((w) => !(w >= 0) || !Number.isFinite(w))) throw new Error("weights must be >= 0");
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) throw new Error("sum of weights must be > 0");

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / sumW);
  const base = raw.map((r) => Math.floor(r));
  let remaining = abs - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r), w: weights[i] }))
    .sort((a, b) => b.rem - a.rem || b.w - a.w || a.i - b.i);
  for (let k = 0; remaining > 0; k = (k + 1) % order.length) {
    if (order[k].w > 0) {
      base[order[k].i] += 1;
      remaining -= 1;
    }
  }
  return base.map((v) => (sign < 0 && v !== 0 ? -v : v));
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * 「換回台幣大概多少」。
 *
 * 帳本本位幣不是台幣時，在金額旁邊附一行參考值（例如 ¥85,400 → 約 NT$18,361）。
 * **只用在顯示** —— 帳務計算完全不碰它，所以改這個匯率不會動到任何一筆交易。
 * 本位幣就是台幣（homeRate 為 null）時回傳 null，呼叫端就不要畫那一行。
 *
 * minor 是「帳本本位幣的 1/100」；homeRate 是「units 個本位幣 = minor 個台幣最小單位」。
 */
export function homeApprox(
  minor: number,
  homeRate: HomeRate | null,
): string | null {
  const twd = toHomeMinor(minor, homeRate);
  if (twd === null) return null;
  // 這一行刻意用 NT$：主角是外幣金額，旁邊這個要一眼看出是台幣
  return formatMoney(twd, { symbol: "NT$" });
}

/** 「units 個本位幣 = minor 個台幣最小單位」。交易上鎖住的那一份與帳本目前那一份同形。 */
export interface HomeRate {
  units: number;
  minor: number;
}

/** homeApprox 的數字版：本位幣最小單位 → 台幣最小單位。要加總的時候用這個。 */
export function toHomeMinor(minor: number, homeRate: HomeRate | null): number | null {
  if (!homeRate || !homeRate.units || !homeRate.minor) return null;
  // minor / 100 = 本位幣單位數；再乘 homeRate.minor / homeRate.units
  return Math.round((minor / MINOR_PER_UNIT) * (homeRate.minor / homeRate.units));
}

/**
 * 一段期間的「台幣參考總額」。
 *
 * 關鍵在於**每一筆用它自己鎖住的匯率**換算，再加總 —— 不是把總額拿現在的匯率換一次。
 * 旅途中改過匯率的話，兩者會差很多：
 *
 *   交易 A ¥5,000 ＠ 0.21 → NT$1,050
 *   交易 B ¥5,000 ＠ 0.22 → NT$1,100
 *   總額 NT$2,150（就算現在的匯率已經變成 0.23 也一樣）
 *
 * rows 的 amount 請先帶好正負號（退款是負的）。
 * 沒有鎖住匯率的舊資料退回 fallback（帳本目前的匯率）—— 那是唯一還原得了的近似值，
 * 但不會寫回資料庫，所以不算偽造歷史。全部都換不出來時回傳 null（那一行就不顯示）。
 */
export function sumHomeMinor(
  rows: Array<{ amount: number; homeRate: HomeRate | null }>,
  fallback: HomeRate | null,
): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const twd = toHomeMinor(r.amount, r.homeRate ?? fallback);
    if (twd === null) continue;
    total += twd;
    any = true;
  }
  return any ? total : null;
}
