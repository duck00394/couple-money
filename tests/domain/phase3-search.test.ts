import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FILTER, activeFilterKeys, filterToQuery, normalizeTags, parseFilter, totalsFromGroups } from "../../src/server/domain/search";

describe("Phase 3-1 搜尋條件", () => {
  it("解析網址參數：金額轉最小單位、不合法的忽略、區間顛倒自動對調", () => {
    const f = parseFilter({ q: " 火鍋 ", from: "2026-09-30", to: "2026-09-01", kind: "REFUND", min: "1,000", max: "200", category: "abc", person: "JOINT", tag: "#約會", account: "bad id!" });
    assert.equal(f.q, "火鍋");
    assert.equal(f.from, "2026-09-01");
    assert.equal(f.to, "2026-09-30");
    assert.equal(f.kind, "REFUND");
    assert.equal(f.min, 20000);
    assert.equal(f.max, 100000);
    assert.equal(f.tag, "約會");
    assert.equal(f.person, "JOINT");
    assert.equal(f.accountId, null);
    assert.deepEqual(parseFilter({ kind: "HACK", from: "9/1", min: "abc" }), EMPTY_FILTER);
  });
  it("組回網址與移除單一條件、計算啟用中的條件", () => {
    const f = parseFilter({ q: "晚餐", min: "100.5", kind: "EXPENSE" });
    assert.equal(filterToQuery(f), "q=%E6%99%9A%E9%A4%90&kind=EXPENSE&min=100.5");
    assert.equal(filterToQuery(f, ["q"]), "kind=EXPENSE&min=100.5");
    assert.deepEqual(activeFilterKeys(f).sort(), ["kind", "min", "q"]);
    assert.deepEqual(parseFilter(Object.fromEntries(new URLSearchParams(filterToQuery(f)))), f, "來回轉換不會變");
  });
  it("標籤整理", () => {
    assert.deepEqual(normalizeTags("#約會, 旅行 旅行、  #日本"), ["約會", "旅行", "日本"]);
    assert.equal(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`)).length, 10);
  });
  it("結果統計：轉帳不算支出、退款降低實際支出、結算與期初不算收支", () => {
    const t = totalsFromGroups([
      { type: "EXPENSE", count: 3, amount: 100000 },
      { type: "REFUND", count: 1, amount: 30000 },
      { type: "INCOME", count: 1, amount: 500000 },
      { type: "TRANSFER", count: 2, amount: 500000 },
      { type: "SETTLEMENT", count: 1, amount: 25000 },
      { type: "OPENING_BALANCE", count: 1, amount: 900000 },
    ]);
    assert.equal(t.count, 9);
    assert.equal(t.expense, 100000);
    assert.equal(t.netExpense, 70000);
    assert.equal(t.income, 500000);
    assert.equal(t.transferCount, 2);
  });
});
