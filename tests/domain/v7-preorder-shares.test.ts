import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sharesOf } from "../../src/server/domain/preorder";

const A = "amy";
const B = "ben";
const $ = (n: number) => n * 100;
const borne = (m: Record<string, number>) => new Map(Object.entries(m));

describe("V7：預購每個人還需付多少", () => {
  it("1. 共同預購：應負擔平分", () => {
    const s = sharesOf($(13150), null, null, [A, B], borne({}));
    assert.deepEqual(s.map((x) => x.due), [$(6575), $(6575)]);
    assert.deepEqual(s.map((x) => x.remaining), [$(6575), $(6575)]);
  });

  it("2. 我的預購：全部算我的，對方 0", () => {
    const s = sharesOf($(2000), null, A, [A, B], borne({}));
    assert.deepEqual(s.map((x) => [x.userId, x.due, x.remaining]), [
      [A, $(2000), $(2000)],
      [B, 0, 0],
    ]);
  });

  it("3. 已負擔用的是既有分帳結果：我先付全額，對方還需付自己那半", () => {
    // 共同單 $10,000，我先付了 $4,000 且是「我自己付」→ 我已負擔 4,000
    const s = sharesOf($(10000), null, null, [A, B], borne({ [A]: $(4000) }));
    assert.deepEqual(s.map((x) => x.due), [$(5000), $(5000)]);
    assert.deepEqual(s.map((x) => x.borne), [$(4000), 0]);
    assert.deepEqual(s.map((x) => x.remaining), [$(1000), $(5000)]);
  });

  it("4. 兩人平分付款時，兩個人一起往下降", () => {
    const s = sharesOf($(10000), null, null, [A, B], borne({ [A]: $(1500), [B]: $(1500) }));
    assert.deepEqual(s.map((x) => x.remaining), [$(3500), $(3500)]);
  });

  it("5. 負擔超過應負擔：還需付是 0，多的部分記在 over", () => {
    const s = sharesOf($(10000), null, null, [A, B], borne({ [A]: $(8000) }));
    assert.equal(s[0].remaining, 0);
    assert.equal(s[0].over, $(3000));
    assert.equal(s[1].remaining, $(5000));
  });

  it("6. 每個人的應負擔加起來正好是應付總額（奇數也不會少一塊）", () => {
    for (const total of [$(1), 1, 3, 101, $(9999.99)]) {
      const s = sharesOf(total, null, null, [A, B], borne({}));
      assert.equal(s.reduce((a, x) => a + x.due, 0), total, `total=${total}`);
    }
  });

  it("7. 只有一個人的帳本也算得出來", () => {
    const s = sharesOf($(500), null, null, [A], borne({}));
    assert.deepEqual(s.map((x) => [x.userId, x.due]), [[A, $(500)]]);
  });

  it("8. 「誰的」指到已經不在帳本的人：退回平分，金額不會憑空消失", () => {
    const s = sharesOf($(1000), null, "someone-gone", [A, B], borne({}));
    assert.equal(s.reduce((a, x) => a + x.due, 0), $(1000));
    assert.deepEqual(s.map((x) => x.due), [$(500), $(500)]);
  });

  it("9. 應付總額 0（例如已取消）：每個人都不用再付", () => {
    const s = sharesOf(0, null, null, [A, B], borne({ [A]: $(3000) }));
    assert.deepEqual(s.map((x) => x.remaining), [0, 0]);
    assert.equal(s[0].over, $(3000), "已經付掉的錢仍然看得到");
  });
});
