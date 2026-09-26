import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupByDateKey, HOME_TODAY_CAP, sortTodayByEntry, splitToday } from "../../src/server/domain/feed";
import { rankTags } from "../../src/server/domain/tags";
import { dayRange, toDateKey } from "../../src/lib/dates";

/** 產生 n 筆假紀錄（由新到舊）。 */
const rows = (n: number, dateKey = "2026-09-26") =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, dateKey }));

describe("V6：首頁最近紀錄", () => {
  it("1. 今日 0 筆：兩邊都是空的", () => {
    const { shown, hidden } = splitToday(rows(0));
    assert.equal(shown.length, 0);
    assert.equal(hidden.length, 0);
  });

  it("2. 今日 1 筆 / 7 筆：全部顯示，不會被截斷", () => {
    assert.equal(splitToday(rows(1)).shown.length, 1);
    assert.equal(splitToday(rows(1)).hidden.length, 0);
    assert.equal(splitToday(rows(7)).shown.length, 7);
    assert.equal(splitToday(rows(7)).hidden.length, 0, "7 筆不會被 5 筆的限制砍掉");
  });

  it("3. 剛好 15 筆：不出現「查看今天全部」", () => {
    const { shown, hidden } = splitToday(rows(HOME_TODAY_CAP));
    assert.equal(shown.length, 15);
    assert.equal(hidden.length, 0);
  });

  it("4. 今日超過 15 筆：先顯示 15 筆，其餘收起來，一筆都沒有掉", () => {
    const all = rows(23);
    const { shown, hidden } = splitToday(all);
    assert.equal(shown.length, 15);
    assert.equal(hidden.length, 8);
    assert.deepEqual([...shown, ...hidden].map((r) => r.id), all.map((r) => r.id), "順序與內容完全保留");
  });

  it("5. 依日期分組：今天＋昨天＋更早，順序不被打亂", () => {
    const list = [
      { id: "a", dateKey: "2026-09-26" },
      { id: "b", dateKey: "2026-09-26" },
      { id: "c", dateKey: "2026-09-25" },
      { id: "d", dateKey: "2026-09-20" },
    ];
    const g = groupByDateKey(list, (r) => r.dateKey);
    assert.deepEqual(g.map((x) => x.key), ["2026-09-26", "2026-09-25", "2026-09-20"]);
    assert.deepEqual(g[0].items.map((x) => x.id), ["a", "b"], "最新記的排最上面（由查詢順序決定，這裡不重排）");
    assert.equal(g.map((x) => x.items.length).reduce((a, b) => a + b, 0), 4);
  });

  it("6. 同一天被拆開出現時不會合併成一組（保留傳入順序）", () => {
    const g = groupByDateKey(
      [{ k: "A" }, { k: "B" }, { k: "A" }],
      (r) => r.k,
    );
    assert.deepEqual(g.map((x) => x.key), ["A", "B", "A"]);
  });

  it("7. 今天這一組依「記錄的先後」排序，最新記的在最上面", () => {
    const at = (s: string) => new Date(`2026-09-26T${s}:00+08:00`);
    const list = [
      { id: "退款", createdAt: at("09:00") },
      { id: "剛記的", createdAt: at("21:30") },
      { id: "中午記的", createdAt: at("12:10") },
    ];
    assert.deepEqual(sortTodayByEntry(list).map((r) => r.id), ["剛記的", "中午記的", "退款"]);
    assert.deepEqual(list.map((r) => r.id), ["退款", "剛記的", "中午記的"], "不改動傳入的陣列");
  });

  it("8. 今天的範圍是台灣時間的整天，23:59 不會被算成明天", () => {
    const key = "2026-09-26";
    const { start, end } = dayRange(key);
    assert.equal(toDateKey(start), key);
    assert.equal(toDateKey(new Date(end.getTime() - 1)), key, "23:59:59.999 還是今天");
    assert.equal(toDateKey(end), "2026-09-27", "剛好到隔天 00:00 就是明天");
    assert.equal(end.getTime() - start.getTime(), 86400_000);
  });
});

describe("V6：標籤快選排序", () => {
  it("1. 最近用過的排前面", () => {
    // 由新到舊
    const out = rankTags([{ tags: ["工作"] }, { tags: ["約會"] }, { tags: ["生活"] }]);
    assert.deepEqual(out, ["工作", "約會", "生活"]);
  });

  it("2. 同樣新的時候比使用次數", () => {
    const out = rankTags([
      { tags: ["甲", "乙"] }, // 兩個都在最新這筆出現
      { tags: ["乙"] },
      { tags: ["乙"] },
    ]);
    assert.deepEqual(out, ["乙", "甲"], "乙用了 3 次排前面");
  });

  it("3. 一筆多標籤都會被算到，且不會重複出現", () => {
    const out = rankTags([{ tags: ["約會", "約會", "旅行"] }]);
    assert.deepEqual(out, ["約會", "旅行"]);
  });

  it("4. 最多只給指定數量", () => {
    const out = rankTags(Array.from({ length: 30 }, (_, i) => ({ tags: [`t${i}`] })), 12);
    assert.equal(out.length, 12);
    assert.equal(out[0], "t0", "最新的排第一");
  });

  it("5. 空白標籤直接忽略，不會產生空 chip", () => {
    assert.deepEqual(rankTags([{ tags: ["  ", "", "旅行"] }]), ["旅行"]);
  });

  it("6. 沒有任何紀錄時就是空陣列", () => {
    assert.deepEqual(rankTags([]), []);
  });
});
