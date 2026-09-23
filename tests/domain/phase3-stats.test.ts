import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bucketByMonth,
  categoryShares,
  clampMonth,
  monthKeyRange,
  monthLabel,
  recentMonths,
  shiftMonth,
} from "../../src/server/domain/stats";

const $ = (n: number) => Math.round(n * 100);

describe("Phase 3-4 A：統計純邏輯", () => {
  it("recentMonths 會跨年往回算", () => {
    assert.deepEqual(recentMonths("2026-01-15", 6), ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]);
    assert.deepEqual(recentMonths("2026-09-30", 1), ["2026-09"]);
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(shiftMonth("2025-12", 1), "2026-01");
    assert.equal(shiftMonth("2026-03", -14), "2025-01");
  });

  it("monthKeyRange 處理 31 天、30 天、2 月與閏年 2 月", () => {
    assert.deepEqual(monthKeyRange("2026-01"), { from: "2026-01-01", to: "2026-01-31" });
    assert.deepEqual(monthKeyRange("2026-04"), { from: "2026-04-01", to: "2026-04-30" });
    assert.deepEqual(monthKeyRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(monthKeyRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" }, "閏年是 29 天");
  });

  it("bucketByMonth 用帳本時區（台灣）切月，不是 UTC", () => {
    const rows = [
      // 台灣時間 2026-03-01 00:00（UTC 還是 2 月）→ 必須算 3 月
      { occurredAt: new Date("2026-02-28T16:00:00Z"), type: "EXPENSE", amount: $(100) },
      // 台灣時間 2026-02-28 23:59 → 必須算 2 月
      { occurredAt: new Date("2026-02-28T15:59:00Z"), type: "EXPENSE", amount: $(50) },
    ];
    const out = bucketByMonth(rows, ["2026-02", "2026-03"]);
    assert.equal(out[0].totals.netExpense, $(50));
    assert.equal(out[1].totals.netExpense, $(100));
  });

  it("bucketByMonth 沒有交易的月份補 0，不會缺列", () => {
    const out = bucketByMonth([{ occurredAt: new Date("2026-09-10T04:00:00Z"), type: "EXPENSE", amount: $(300) }], [
      "2026-07", "2026-08", "2026-09",
    ]);
    assert.deepEqual(out.map((p) => p.month), ["2026-07", "2026-08", "2026-09"]);
    assert.equal(out[0].totals.netExpense, 0);
    assert.equal(out[0].totals.count, 0);
    assert.equal(out[2].totals.netExpense, $(300));
  });

  it("bucketByMonth 沿用 totalsFromGroups：轉帳不算收支、退款從支出扣", () => {
    const d = new Date("2026-09-10T04:00:00Z");
    const out = bucketByMonth(
      [
        { occurredAt: d, type: "EXPENSE", amount: $(1000) },
        { occurredAt: d, type: "REFUND", amount: $(300) },
        { occurredAt: d, type: "INCOME", amount: $(500) },
        { occurredAt: d, type: "TRANSFER", amount: $(9999) },
        { occurredAt: d, type: "SETTLEMENT", amount: $(777) },
        { occurredAt: d, type: "OPENING_BALANCE", amount: $(8888) },
      ],
      ["2026-09"],
    );
    const t = out[0].totals;
    assert.equal(t.netExpense, $(700), "1000 − 300");
    assert.equal(t.income, $(500), "結算與期初餘額不是收入");
    assert.equal(t.transferCount, 1);
    assert.equal(t.transferAmount, $(9999));
    assert.equal(t.count, 6, "筆數仍然算全部");
  });

  it("categoryShares：退款從同一個分類扣掉", () => {
    const out = categoryShares([
      { categoryId: "food", type: "EXPENSE", amount: $(1000) },
      { categoryId: "food", type: "REFUND", amount: $(400) },
      { categoryId: "fun", type: "EXPENSE", amount: $(400) },
    ]);
    assert.deepEqual(out.map((c) => [c.categoryId, c.amount]), [["food", $(600)], ["fun", $(400)]]);
    assert.equal(out[0].share, 60);
    assert.equal(out[1].share, 40);
  });

  it("categoryShares：未分類獨立一列、金額為 0 的分類不顯示、只看支出與退款", () => {
    const out = categoryShares([
      { categoryId: null, type: "EXPENSE", amount: $(200) },
      { categoryId: "food", type: "EXPENSE", amount: $(300) },
      { categoryId: "food", type: "REFUND", amount: $(300) },
      { categoryId: "x", type: "TRANSFER", amount: $(5000) },
      { categoryId: "y", type: "INCOME", amount: $(5000) },
    ]);
    assert.deepEqual(out.map((c) => c.categoryId), [null], "全額退掉的分類與轉帳／收入都不出現");
    assert.equal(out[0].amount, $(200));
    assert.equal(out[0].share, 100);
  });

  it("categoryShares：淨支出為 0 或負數時不會出現 NaN／Infinity，百分比加總約等於 100", () => {
    assert.deepEqual(categoryShares([]), []);
    const zero = categoryShares([
      { categoryId: "a", type: "EXPENSE", amount: $(100) },
      { categoryId: "b", type: "REFUND", amount: $(100) },
    ]);
    for (const c of zero) assert.ok(Number.isFinite(c.share) && c.share === 0, "分母 ≤ 0 時一律 0");
    const many = categoryShares(
      ["a", "b", "c"].map((id, i) => ({ categoryId: id, type: "EXPENSE", amount: $(333 + i) })),
    );
    const total = many.reduce((a, c) => a + c.share, 0);
    assert.ok(Math.abs(total - 100) <= 0.3, `百分比加總 ${total} 應該約等於 100`);
  });

  it("clampMonth：格式錯／未來／太舊一律回到本月", () => {
    const today = "2026-09-17";
    assert.equal(clampMonth("2026-08", today), "2026-08");
    assert.equal(clampMonth("2026-09", today), "2026-09");
    assert.equal(clampMonth("2026-10", today), "2026-09", "未來月份");
    assert.equal(clampMonth("2025-09", today), "2026-09", "超過 12 個月");
    assert.equal(clampMonth("2025-10", today), "2025-10", "剛好第 12 個月可以看");
    assert.equal(clampMonth("2026-13", today), "2026-09", "月份不存在");
    assert.equal(clampMonth("abc", today), "2026-09");
    assert.equal(clampMonth(null, today), "2026-09");
    assert.equal(clampMonth(undefined, today), "2026-09");
  });

  it("monthLabel：同一年只寫月份，跨年加上年份", () => {
    assert.equal(monthLabel("2026-09", "2026-09-17"), "9 月");
    assert.equal(monthLabel("2025-12", "2026-09-17"), "2025 年 12 月");
  });
});
