/**
 * 幣別清單與格式化（純資料，沒有任何相依）。
 *
 * 一個幣別只需要三件事：小數位數、符號、名稱。所有邏輯都從這張表讀，
 * **不為任何一種幣別寫特例** —— 要加 ISO 4217 的新幣別只要在 CURRENCIES 多一列。
 *
 * 小數位數不是裝飾：日圓與韓元沒有小數（¥2,500 就是 2500），
 * 台幣與美金有兩位（NT$537.50 存成 53750）。整個系統的金額一律是
 * 「該幣別的最小單位整數」，所以換算時必須知道每個幣別的 exponent。
 */

export interface Currency {
  /** ISO 4217 代碼 */
  code: string;
  name: string;
  symbol: string;
  /** 小數位數（ISO 4217 的 minor unit exponent）。JPY / KRW 是 0。 */
  decimals: number;
}

export const CURRENCIES: readonly Currency[] = [
  { code: "TWD", name: "新台幣", symbol: "NT$", decimals: 2 },
  { code: "JPY", name: "日圓", symbol: "¥", decimals: 0 },
  { code: "USD", name: "美金", symbol: "US$", decimals: 2 },
  { code: "KRW", name: "韓元", symbol: "₩", decimals: 0 },
  { code: "CNY", name: "人民幣", symbol: "CN¥", decimals: 2 },
  { code: "HKD", name: "港幣", symbol: "HK$", decimals: 2 },
  { code: "EUR", name: "歐元", symbol: "€", decimals: 2 },
  { code: "GBP", name: "英鎊", symbol: "£", decimals: 2 },
  { code: "THB", name: "泰銖", symbol: "฿", decimals: 2 },
  { code: "SGD", name: "新加坡幣", symbol: "S$", decimals: 2 },
] as const;

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export const isCurrencyCode = (code: string): boolean => BY_CODE.has(code);

/**
 * 查一個幣別。查不到時回傳一個「兩位小數、符號就是代碼」的預設值，
 * 而不是丟例外 —— 萬一資料庫裡有一筆舊的／未知的代碼，畫面該照常顯示，
 * 不能整頁壞掉。
 */
export function currencyOf(code: string): Currency {
  return BY_CODE.get(code) ?? { code, name: code, symbol: code, decimals: 2 };
}

/** 這個幣別的 1 單位等於多少最小單位（TWD → 100、JPY → 1）。 */
export const minorPerUnit = (code: string) => 10 ** currencyOf(code).decimals;

/**
 * 把最小單位整數格式化成人看的字串。
 *
 * formatMoney（lib/money.ts）寫死台幣的兩位小數與 $ 符號，那是本位幣專用的；
 * 這個函式處理任意幣別，所以外幣顯示一律走這裡。
 */
export function formatCurrency(minor: number, code: string, opts: { symbol?: boolean } = {}): string {
  const c = currencyOf(code);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 10 ** c.decimals);
  const frac = abs % 10 ** c.decimals;
  const body =
    c.decimals === 0
      ? whole.toLocaleString("en-US")
      : `${whole.toLocaleString("en-US")}.${String(frac).padStart(c.decimals, "0")}`;
  return `${sign}${opts.symbol === false ? "" : c.symbol}${body}`;
}

/**
 * 解析使用者輸入的金額字串 → 該幣別的最小單位整數。
 * 非法輸入回 null（呼叫端自己決定要不要擋）。
 */
export function parseCurrencyAmount(input: string | number | null | undefined, code: string): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().replace(/[,\s]/g, "");
  if (!raw || !/^-?\d*\.?\d*$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const minor = Math.round(n * minorPerUnit(code));
  return Number.isSafeInteger(minor) ? minor : null;
}
