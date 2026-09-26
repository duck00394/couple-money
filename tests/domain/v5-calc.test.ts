import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { currentValue, initialCalc, isPending, press, settle, type CalcState } from "../../src/lib/calc";

/** 連續按一串鍵，回傳最後的狀態。 */
const run = (keys: string) => keys.split(" ").reduce<CalcState>((s, k) => press(s, k), initialCalc);
/** 按完並結算，回傳畫面上的數字。 */
const val = (keys: string) => currentValue(settle(run(keys)));

describe("V5：記帳計算機", () => {
  it("1. 四則運算", () => {
    assert.equal(val("1 0 0 0 + 2 0 0 ="), 1200);
    assert.equal(val("1 5 0 0 - 3 0 0 ="), 1200);
    assert.equal(val("1 0 0 × 3 ="), 300);
    assert.equal(val("1 2 0 0 ÷ 3 ="), 400);
  });

  it("2. 百分比：乘法是取百分比，加減是加減「前一個數的百分比」", () => {
    assert.equal(val("1 0 0 0 × 1 5 % ="), 150);
    assert.equal(val("1 2 0 0 × 8 0 % ="), 960);
    assert.equal(val("2 0 0 + 1 0 % ="), 220, "200 加上 200 的 10%");
    assert.equal(val("2 0 0 - 1 0 % ="), 180);
    assert.equal(val("5 0 %"), 0.5, "單獨按 % 就是除以 100");
  });

  it("3. 連續運算：按到下一個運算子就先算出前面的", () => {
    assert.equal(val("2 9 9 + 1 2 9 + 8 9 ="), 517);
    assert.equal(val("1 + 2 + 3 + 4 ="), 10);
    assert.equal(val("1 0 + 5 × 2 ="), 30, "照按鍵順序算，不做運算子優先權");
    const mid = run("2 9 9 + 1 2 9 +");
    assert.equal(currentValue(mid), 428, "按下第二個 + 的當下就看得到 428");
  });

  it("4. 小數不會有浮點誤差", () => {
    assert.equal(val("0 . 1 + 0 . 2 ="), 0.3);
    assert.equal(val("1 . 1 × 3 ="), 3.3);
    assert.equal(val("0 . 0 7 + 0 . 0 1 ="), 0.08);
    assert.equal(val("9 9 . 9 9 + 0 . 0 1 ="), 100);
  });

  it("5. 小數點：不會出現兩個點，開頭自動補 0", () => {
    assert.equal(run(". 5").input, "0.5");
    assert.equal(run("1 . 2 . 3").input, "1.23", "第二個點被忽略");
    assert.equal(val("1 . 2 . 3"), 1.23);
  });

  it("6. 負數", () => {
    assert.equal(val("5 0 ±"), -50);
    assert.equal(val("1 0 0 - 3 0 0 ="), -200);
    assert.equal(val("5 0 ± + 2 0 ="), -30);
    assert.equal(run("0 ±").input, "0", "負零就是零");
  });

  it("7. 除以 0：給提示，不會壞掉也不會變成 Infinity", () => {
    const s = run("1 0 0 ÷ 0 =");
    assert.equal(s.error, "不能除以 0");
    assert.ok(Number.isFinite(currentValue(s)));
    assert.equal(currentValue(s), 0, "保留使用者剛剛輸入的 0");
    // 還可以繼續用
    assert.equal(val("1 0 0 ÷ 0 = AC 5 + 5 ="), 10);
  });

  it("8. 連按運算子只會換掉運算子，不會多算一次", () => {
    assert.equal(val("1 0 + - × ÷ 2 ="), 5, "最後生效的是 ÷");
    assert.equal(val("1 0 + + 5 ="), 15);
  });

  it("9. 清除與退格", () => {
    assert.equal(val("1 2 3 AC"), 0);
    assert.equal(run("1 2 3 AC").op, null);
    assert.equal(val("1 2 3 del"), 12);
    assert.equal(val("1 2 3 del del del"), 0);
    assert.equal(val("1 del del del del"), 0, "退到空的也不會壞");
    assert.equal(val("1 0 0 + 2 5 del ="), 102, "退格只影響正在輸入的那個數");
  });

  it("10. 算完之後：結果可以繼續算，按數字則重新開始", () => {
    assert.equal(val("1 0 + 5 = + 3 ="), 18, "接著算");
    assert.equal(val("1 0 + 5 = 7"), 7, "直接按數字是重新輸入，不是接在 15 後面");
    assert.equal(val("1 0 + 5 = × 2 ="), 30);
  });

  it("11. 沒算完就送出：settle() 會先把算式結清", () => {
    const pending = run("2 9 9 + 1 2 9");
    assert.equal(isPending(pending), true);
    assert.equal(currentValue(pending), 129, "還沒算完時畫面上是剛輸入的數");
    assert.equal(currentValue(settle(pending)), 428, "送出前先算完");
    assert.equal(isPending(settle(pending)), false);
  });

  it("12. 算式會顯示在上方，方便核對", () => {
    assert.equal(run("2 9 9 + 1 2 9 +").expr, "428 +");
    assert.equal(run("1 0 0 × 3 =").expr, "100 × 3 =");
    assert.equal(run("1 2 3").expr, "", "只輸入數字時不顯示算式");
  });

  it("13. 輸入長度有上限，不會被打爆", () => {
    assert.equal(run("1 2 3 4 5 6 7 8 9 0 1 2 3 4 5").input.length, 12);
  });
});
