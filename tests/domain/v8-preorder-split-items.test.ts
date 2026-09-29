import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { duesFromItems, duesOf, itemsTotal, lineTotal, sharesOf } from "../../src/server/domain/preorder";
import type { SplitRule } from "../../src/server/domain/split";

const A = "amy";
const B = "ben";
const $ = (n: number) => n * 100;
const borne = (m: Record<string, number> = {}) => new Map(Object.entries(m));
const item = (name: string, unit: number, qty = 1, ownerId: string | null = null) => ({ name, unitAmount: unit, qty, ownerId });

describe("V8：預購明細品項", () => {
  it("1. 小計 = 單價 × 數量，合計是所有品項加總", () => {
    const items = [item("主機", $(12000)), item("保護貼", $(150), 2), item("遊戲片", $(1790))];
    assert.equal(lineTotal(items[1]), $(300));
    assert.equal(itemsTotal(items), $(12000) + $(300) + $(1790));
  });

  it("2. 沒有品項時合計是 0（商品金額就自己填）", () => {
    assert.equal(itemsTotal([]), 0);
  });

  it("3. 依品項的「誰的」帶出金額：標名字的算那個人的，共同的平分", () => {
    const dues = duesFromItems(
      [item("我的遊戲", $(1800), 1, A), item("他的手把", $(2000), 1, B), item("一起用的底座", $(1000))],
      [A, B],
    );
    assert.equal(dues.get(A), $(1800) + $(500));
    assert.equal(dues.get(B), $(2000) + $(500));
  });

  it("4. 全部共同時就是平分，加總不會少一塊", () => {
    const dues = duesFromItems([item("東西", 101)], [A, B]);
    assert.equal((dues.get(A) ?? 0) + (dues.get(B) ?? 0), 101);
  });

  it("5. 「誰的」指到不存在的人時算共同，金額不會憑空消失", () => {
    const dues = duesFromItems([item("東西", $(1000), 1, "ghost")], [A, B]);
    assert.equal((dues.get(A) ?? 0) + (dues.get(B) ?? 0), $(1000));
  });
});

describe("V8：預購誰付多少", () => {
  const equal: SplitRule = { method: "EQUAL", participants: [{ userId: A }, { userId: B }] };
  const ratio7030: SplitRule = { method: "RATIO", participants: [{ userId: A, value: 70 }, { userId: B, value: 30 }] };
  const amount: SplitRule = { method: "AMOUNT", participants: [{ userId: A, value: $(8000) }, { userId: B, value: $(2000) }] };
  const full: SplitRule = { method: "FULL", participants: [{ userId: B }] };

  it("1. 沒設規則 → 舊行為（共同平分、我的就全算我的）", () => {
    assert.deepEqual([...duesOf($(10000), null, null, [A, B]).values()], [$(5000), $(5000)]);
    assert.deepEqual([...duesOf($(10000), null, A, [A, B]).values()], [$(10000), 0]);
  });

  it("2. 比例：7:3 不再是一人一半", () => {
    const d = duesOf($(10000), ratio7030, null, [A, B]);
    assert.equal(d.get(A), $(7000));
    assert.equal(d.get(B), $(3000));
  });

  it("3. 金額：直接指定誰付多少", () => {
    const d = duesOf($(10000), amount, null, [A, B]);
    assert.equal(d.get(A), $(8000));
    assert.equal(d.get(B), $(2000));
  });

  it("4. 一方全付", () => {
    const d = duesOf($(10000), full, null, [A, B]);
    assert.equal(d.get(A), 0);
    assert.equal(d.get(B), $(10000));
  });

  it("5. 平分規則跟舊行為一樣", () => {
    assert.deepEqual([...duesOf($(999), equal, null, [A, B]).values()], [...duesOf($(999), null, null, [A, B]).values()]);
  });

  it("6. 不管哪一種規則，應負擔加總永遠等於應付總額", () => {
    for (const rule of [null, equal, ratio7030, amount, full]) {
      for (const total of [1, 3, 101, $(13150), $(9999.99)]) {
        // AMOUNT 規則綁死金額，換總額就不適用，只驗它自己的總額
        if (rule === amount && total !== $(10000)) continue;
        const d = duesOf(total, rule, null, [A, B]);
        assert.equal([...d.values()].reduce((a, b) => a + b, 0), total, `rule=${rule?.method ?? "none"} total=${total}`);
      }
    }
  });

  it("7. 規則壞掉（成員換了、金額對不起來）→ 退回舊行為，不會爆掉", () => {
    const stale: SplitRule = { method: "AMOUNT", participants: [{ userId: A, value: $(1) }, { userId: B, value: $(1) }] };
    assert.deepEqual([...duesOf($(10000), stale, null, [A, B]).values()], [$(5000), $(5000)], "金額對不起來 → 平分");
    const gone: SplitRule = { method: "EQUAL", participants: [{ userId: "ghost" }] };
    assert.deepEqual([...duesOf($(10000), gone, null, [A, B]).values()], [$(5000), $(5000)], "成員不在了 → 平分");
  });

  it("8. 應付總額 0（取消了）→ 每個人都是 0，也不會丟例外", () => {
    assert.deepEqual([...duesOf(0, ratio7030, null, [A, B]).values()], [0, 0]);
  });

  it("9. sharesOf 用的是同一套規則：7:3 且我已負擔 $2,000", () => {
    const s = sharesOf($(10000), ratio7030, null, [A, B], borne({ [A]: $(2000) }));
    assert.deepEqual(s.map((x) => [x.userId, x.due, x.borne, x.remaining]), [
      [A, $(7000), $(2000), $(5000)],
      [B, $(3000), 0, $(3000)],
    ]);
  });
});
