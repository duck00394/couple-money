import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertBudgetAmount, budgetProgress, BUDGET_STATE_LABEL, NEAR_RATIO, summarizeBudgets } from "../../src/server/domain/budget";
import { DomainError } from "../../src/server/domain/errors";
import { MAX_AMOUNT } from "../../src/lib/money";

const $ = (n: number) => n * 100;
const fails = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof DomainError && e.code === code);

describe("Phase 3-4 B：預算（純邏輯）", () => {
  it("還沒花：剩餘 = 預算、比例 0、狀態還好", () => {
    const p = budgetProgress($(8000), 0);
    assert.equal(p.remaining, $(8000));
    assert.equal(p.ratio, 0);
    assert.equal(p.state, "OK");
    assert.equal(p.over, 0);
  });

  it("花了一半：剩餘與使用率正確", () => {
    const p = budgetProgress($(8000), $(4000));
    assert.equal(p.remaining, $(4000));
    assert.equal(p.ratio, 0.5);
    assert.equal(p.state, "OK");
  });

  it("到 80% 就算「快超過」，79% 還好", () => {
    assert.equal(NEAR_RATIO, 0.8);
    assert.equal(budgetProgress($(1000), $(799)).state, "OK");
    assert.equal(budgetProgress($(1000), $(800)).state, "NEAR");
    assert.equal(budgetProgress($(1000), $(999)).state, "NEAR");
    assert.equal(budgetProgress($(1000), $(1000)).state, "NEAR", "剛好用完還不算超支");
    // 不整除的門檻用無條件進位，避免浮點數誤差
    assert.equal(budgetProgress(333, 266).state, "OK");
    assert.equal(budgetProgress(333, 267).state, "NEAR");
  });

  it("超支：剩餘為負，另外給超支金額", () => {
    const p = budgetProgress($(5000), $(6200));
    assert.equal(p.remaining, -$(1200));
    assert.equal(p.over, $(1200));
    assert.equal(p.state, "OVER");
    assert.ok(p.ratio > 1);
  });

  it("退款抵減之後可能變成負支出，不會壞掉", () => {
    const p = budgetProgress($(1000), -$(200));
    assert.equal(p.spent, -$(200));
    assert.equal(p.remaining, $(1200));
    assert.equal(p.state, "OK");
    assert.equal(p.over, 0);
    assert.ok(p.ratio < 0);
  });

  it("金額計算全部走整數，不會出現浮點數誤差", () => {
    const p = budgetProgress(10, 3); // 0.10 元 vs 0.03 元
    assert.equal(p.remaining, 7);
    assert.ok(Number.isInteger(p.remaining) && Number.isInteger(p.over) && Number.isInteger(p.spent));
    // 0.1 + 0.2 的經典誤差不會出現在金額上
    assert.equal(budgetProgress(30, 10).remaining + budgetProgress(30, 20).remaining, 30);
  });

  it("預算金額必須大於 0，且不能超過上限", () => {
    assert.equal(assertBudgetAmount($(8000)), $(8000));
    assert.equal(assertBudgetAmount(1), 1);
    fails(() => assertBudgetAmount(0), "BUDGET_AMOUNT");
    fails(() => assertBudgetAmount(-100), "BUDGET_AMOUNT");
    fails(() => assertBudgetAmount(1.5), "BUDGET_AMOUNT");
    fails(() => assertBudgetAmount(NaN), "BUDGET_AMOUNT");
    fails(() => assertBudgetAmount(MAX_AMOUNT + 1), "BUDGET_AMOUNT");
    assert.equal(assertBudgetAmount(MAX_AMOUNT), MAX_AMOUNT);
  });

  it("摘要只算啟用中的預算", () => {
    const list = [
      { isActive: true, progress: budgetProgress($(1000), $(100)) }, // OK
      { isActive: true, progress: budgetProgress($(1000), $(900)) }, // NEAR
      { isActive: true, progress: budgetProgress($(1000), $(1500)) }, // OVER
      { isActive: false, progress: budgetProgress($(9999), $(9999)) }, // 停用的不算
    ];
    const s = summarizeBudgets(list);
    assert.equal(s.count, 3);
    assert.equal(s.ok, 1);
    assert.equal(s.near, 1);
    assert.equal(s.over, 1);
    assert.equal(s.totalAmount, $(3000));
    assert.equal(s.totalSpent, $(2500));
    assert.deepEqual(summarizeBudgets([]), { count: 0, ok: 0, near: 0, over: 0, totalAmount: 0, totalSpent: 0 });
  });

  it("狀態都有中文說法", () => {
    assert.deepEqual(Object.keys(BUDGET_STATE_LABEL).sort(), ["NEAR", "OK", "OVER"]);
    for (const v of Object.values(BUDGET_STATE_LABEL)) assert.ok(v.length > 0);
  });
});
