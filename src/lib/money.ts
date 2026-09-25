/**
 * 金額工具。
 * 所有金額在程式與資料庫中一律使用「整數最小單位」（TWD 的 1 元 = 100）。
 * 不使用浮點數做任何加總，避免 0.1 + 0.2 問題。
 */
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

/** 最小單位整數 → 顯示字串。$1,234 或 $1,234.50（有小數才顯示）。 */
export function formatMoney(minor: number, opts: { sign?: boolean; symbol?: string } = {}): string {
  const symbol = opts.symbol ?? "$";
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MINOR_PER_UNIT);
  const frac = abs % MINOR_PER_UNIT;
  const wholeStr = whole.toLocaleString("en-US");
  const body = frac === 0 ? wholeStr : `${wholeStr}.${String(frac).padStart(2, "0")}`;
  const prefix = neg ? "-" : opts.sign && minor > 0 ? "+" : "";
  return `${prefix}${symbol}${body}`;
}

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
