/**
 * 記帳鍵盤用的小計算機（純函式，沒有任何 UI 相依）。
 *
 * 行為刻意跟一般手機計算機一樣，不自己發明規則：
 *   - 連續運算：`1 + 2 + 3` 按到第二個 `+` 就先算出 3，繼續加 3 得 6
 *   - 連按運算子：只換掉運算子，不會多算一次
 *   - `%`：把目前輸入的數字當成「前一個數的百分比」
 *     `1000 × 15%` → 150；`1200 × 80%` → 960；`200 + 10%` → 220（加上 200 的 10%）
 *   - 除以 0：不會壞掉，顯示提示並保留原本的數字
 *   - 算完再按數字：從新的數字重新開始，不會接在結果後面
 *
 * 金額一律用「最小單位的整數」在外面處理（$1 = 100）。這裡為了讓使用者
 * 可以打小數，內部用 number 運算，但每一步都用 round2() 收斂，
 * 避免 0.1 + 0.2 = 0.30000000000000004 這種浮點誤差跑到畫面上。
 */

export type Op = "+" | "-" | "×" | "÷";

export interface CalcState {
  /** 目前正在輸入的數字（字串，才能表達 "1."、"0."、"-0" 這些中間狀態） */
  input: string;
  /** 已經按下、還沒結算的左運算元 */
  acc: number | null;
  /** 待執行的運算子 */
  op: Op | null;
  /** 下一次按數字要不要蓋掉 input（剛算完、或剛按完運算子） */
  replace: boolean;
  /** 畫面上方顯示的算式，例如 "299 + 129 +" */
  expr: string;
  /** 一次性的提示（例如不能除以 0） */
  error: string | null;
}

export const initialCalc: CalcState = { input: "0", acc: null, op: null, replace: true, expr: "", error: null };

/** 兩位小數收斂：金額最多到分，順便把浮點誤差吃掉。 */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const num = (s: string) => {
  const n = Number(s === "" || s === "-" || s === "." || s === "-." ? "0" : s);
  return Number.isFinite(n) ? n : 0;
};

/** 顯示用：去掉多餘的 0，但保留使用者正在打的 "1." */
const show = (n: number) => {
  const r = round2(n);
  return Object.is(r, -0) ? "0" : String(r);
};

function apply(a: number, op: Op, b: number): { value: number } | { error: string } {
  switch (op) {
    case "+": return { value: round2(a + b) };
    case "-": return { value: round2(a - b) };
    case "×": return { value: round2(a * b) };
    case "÷":
      if (b === 0) return { error: "不能除以 0" };
      return { value: round2(a / b) };
  }
}

/** 目前畫面上該顯示的數字。 */
export const currentValue = (s: CalcState) => num(s.input);

/** 有沒有還沒算完的運算（決定要不要顯示「＝」而不是直接送出）。 */
export const isPending = (s: CalcState) => s.op !== null;

export function press(state: CalcState, key: string): CalcState {
  const s = { ...state, error: null };

  // ── 數字 ──
  if (/^[0-9]$/.test(key)) {
    const base = s.replace ? "" : s.input === "0" ? "" : s.input;
    const next = (base + key).slice(0, 12);
    return { ...s, input: next === "" ? "0" : next, replace: false };
  }

  // ── 小數點 ──
  if (key === ".") {
    if (s.replace) return { ...s, input: "0.", replace: false };
    return s.input.includes(".") ? s : { ...s, input: s.input + ".", replace: false };
  }

  // ── 清除 ──
  if (key === "AC") return { ...initialCalc };

  // ── 退格 ──
  if (key === "del") {
    if (s.replace) return { ...s, input: "0", replace: true };
    const next = s.input.slice(0, -1);
    return { ...s, input: next === "" || next === "-" ? "0" : next, replace: next === "" };
  }

  // ── 正負號 ──
  if (key === "±") {
    const v = round2(-num(s.input));
    return { ...s, input: show(v), replace: false };
  }

  // ── 百分比 ──
  if (key === "%") {
    const v = num(s.input);
    // 有左運算元時：加減是「左邊的百分比」，乘除是單純的 /100
    const pct =
      s.acc !== null && (s.op === "+" || s.op === "-") ? round2((s.acc * v) / 100) : round2(v / 100);
    return { ...s, input: show(pct), replace: false };
  }

  // ── 運算子 ──
  if (key === "+" || key === "-" || key === "×" || key === "÷") {
    const op = key as Op;
    // 連按運算子：只換掉運算子，不重算
    if (s.replace && s.op !== null && s.acc !== null) {
      return { ...s, op, expr: `${show(s.acc)} ${op}` };
    }
    const v = num(s.input);
    if (s.acc === null || s.op === null) {
      return { ...s, acc: v, op, replace: true, expr: `${show(v)} ${op}` };
    }
    const r = apply(s.acc, s.op, v);
    if ("error" in r) return { ...s, error: r.error, op: null, acc: null, replace: true, expr: "" };
    return { ...s, acc: r.value, op, input: show(r.value), replace: true, expr: `${show(r.value)} ${op}` };
  }

  // ── 等於 ──
  if (key === "=") {
    if (s.acc === null || s.op === null) return { ...s, expr: "", replace: true };
    const v = num(s.input);
    const r = apply(s.acc, s.op, v);
    if ("error" in r) return { ...s, error: r.error, acc: null, op: null, replace: true, expr: "" };
    return {
      ...s,
      input: show(r.value),
      acc: null,
      op: null,
      replace: true,
      expr: `${show(s.acc)} ${s.op} ${show(v)} =`,
    };
  }

  return s;
}

/**
 * 送出前先把還沒算完的算式結算掉。
 * 例如使用者打了 `299 + 129` 就直接按「記下來」，這裡會先算成 428。
 */
export function settle(state: CalcState): CalcState {
  return isPending(state) ? press(state, "=") : state;
}
