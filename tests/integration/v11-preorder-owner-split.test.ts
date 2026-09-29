import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rid, reset, setupCouple, prisma } from "./helpers";
import * as preorders from "../../src/server/services/preorders";

/**
 * V11：預購的「依『誰的』」必須真的依每個品項的「誰的」。
 *
 * 回歸測試。之前的 bug：沒有存分帳規則時，服務層算出來的 shares 完全不看明細品項，
 * 整張單是「共同」就一人一半 —— 使用者在每件東西上標的「誰的」等於沒作用。
 */
describe("V11：預購依「誰的」分擔（service 層）", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  const due = (v: Awaited<ReturnType<typeof preorders.getPreorder>>, userId: string) =>
    v!.shares.find((s) => s.userId === userId)!.due;

  before(async () => {
    await reset();
    c = await setupCouple();
  });
  after(async () => {
    await prisma.$disconnect();
  });

  it("1. 整張單是共同、每件都標了人 → 各自算各自的，不是平分", async () => {
    const p = await preorders.createPreorder(c.ctxA, {
      name: "兩個人各買各的", seller: "", emoji: "🎁", expectedOn: null,
      itemAmount: 0, shipping: 0, ownerId: null, note: "", splitRule: null, categoryId: null,
      items: [
        { name: "小艾的", unitAmount: $(3000), qty: 1, ownerId: c.aId },
        { name: "阿本的", unitAmount: $(1000), qty: 1, ownerId: c.bId },
      ],
    });
    const v = await preorders.getPreorder(c.ctxA, p.id);
    assert.equal(v!.money.total, $(4000));
    assert.equal(due(v, c.aId), $(3000), "小艾應負擔自己那件");
    assert.equal(due(v, c.bId), $(1000), "阿本應負擔自己那件");
  });

  it("2. 運費與沒標「誰的」的品項才進共同池平分", async () => {
    const p = await preorders.createPreorder(c.ctxA, {
      name: "有運費", seller: "", emoji: "🎁", expectedOn: null,
      itemAmount: 0, shipping: $(400), ownerId: null, note: "", splitRule: null, categoryId: null,
      items: [
        { name: "小艾的", unitAmount: $(3000), qty: 1, ownerId: c.aId },
        { name: "阿本的", unitAmount: $(1000), qty: 1, ownerId: c.bId },
        { name: "一起用的", unitAmount: $(600), qty: 1, ownerId: null },
      ],
    });
    const v = await preorders.getPreorder(c.ctxA, p.id);
    assert.equal(v!.money.total, $(5000));
    assert.equal(due(v, c.aId), $(3500), "3000 + 共同池 1000 的一半");
    assert.equal(due(v, c.bId), $(1500));
    assert.equal(due(v, c.aId) + due(v, c.bId), v!.money.total, "加總一定等於總額");
  });

  it("3. 標「共同」的品項永遠平分，不會因為整張單掛在誰名下就變成誰的", async () => {
    const p = await preorders.createPreorder(c.ctxA, {
      name: "小艾的單", seller: "", emoji: "🎁", expectedOn: null,
      itemAmount: 0, shipping: $(400), ownerId: c.aId, note: "", splitRule: null, categoryId: null,
      items: [
        { name: "小艾的", unitAmount: $(3000), qty: 1, ownerId: c.aId },
        { name: "阿本的", unitAmount: $(1000), qty: 1, ownerId: c.bId },
        { name: "共同的", unitAmount: $(600), qty: 1, ownerId: null },
      ],
    });
    const v = await preorders.getPreorder(c.ctxA, p.id);
    assert.equal(due(v, c.aId), $(3500), "3000 + 共同池 1000 的一半");
    assert.equal(due(v, c.bId), $(1500));
  });

  it("3b. 品項全部都是「共同」時才退回看整張單的「誰的」", async () => {
    const p = await preorders.createPreorder(c.ctxA, {
      name: "全部共同", seller: "", emoji: "🎁", expectedOn: null,
      itemAmount: 0, shipping: 0, ownerId: c.aId, note: "", splitRule: null, categoryId: null,
      items: [{ name: "一起用的", unitAmount: $(4000), qty: 1, ownerId: null }],
    });
    const v = await preorders.getPreorder(c.ctxA, p.id);
    assert.equal(due(v, c.aId), $(4000), "沒有任何品項標給特定的人 → 看整張單是誰的");
    assert.equal(due(v, c.bId), 0);
  });

  it("4. 使用者自己選了「平分」時，規則優先於品項的「誰的」", async () => {
    const p = await preorders.createPreorder(c.ctxA, {
      name: "說好平分", seller: "", emoji: "🎁", expectedOn: null,
      itemAmount: 0, shipping: 0, ownerId: null, note: "", categoryId: null,
      splitRule: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
      items: [
        { name: "小艾的", unitAmount: $(3000), qty: 1, ownerId: c.aId },
        { name: "阿本的", unitAmount: $(1000), qty: 1, ownerId: c.bId },
      ],
    });
    const v = await preorders.getPreorder(c.ctxA, p.id);
    assert.equal(due(v, c.aId), $(2000));
    assert.equal(due(v, c.bId), $(2000));
  });

  it("5. 沒有明細品項時維持舊行為（共同就平分）", async () => {
    const p = await preorders.createPreorder(c.ctxA, {
      name: "沒有明細", seller: "", emoji: "🎁", expectedOn: null,
      itemAmount: $(4000), shipping: 0, ownerId: null, note: "", splitRule: null, categoryId: null, items: [],
    });
    const v = await preorders.getPreorder(c.ctxA, p.id);
    assert.equal(due(v, c.aId), $(2000));
    assert.equal(due(v, c.bId), $(2000));
  });

  it("6. 改了品項的「誰的」之後，應負擔跟著變（不是建立時算好就固定）", async () => {
    const p = await preorders.createPreorder(c.ctxA, {
      name: "改誰的", seller: "", emoji: "🎁", expectedOn: null,
      itemAmount: 0, shipping: 0, ownerId: null, note: "", splitRule: null, categoryId: null,
      items: [{ name: "一台", unitAmount: $(2000), qty: 1, ownerId: c.aId }],
    });
    assert.equal(due(await preorders.getPreorder(c.ctxA, p.id), c.aId), $(2000));
    await preorders.updatePreorder(c.ctxA, p.id, {
      name: "改誰的", seller: "", emoji: "🎁", expectedOn: null,
      itemAmount: 0, shipping: 0, ownerId: null, note: "", splitRule: null, categoryId: null,
      items: [{ name: "一台", unitAmount: $(2000), qty: 1, ownerId: c.bId }],
    });
    const v = await preorders.getPreorder(c.ctxA, p.id);
    assert.equal(due(v, c.aId), 0, "改標成阿本的之後小艾就不用負擔");
    assert.equal(due(v, c.bId), $(2000));
  });

  it("7. 付款之後「還需付」用的是依品項算出來的應負擔", async () => {
    const list = await preorders.listPreorders(c.ctxA);
    const p = list.find((x) => x.name === "兩個人各買各的")!;
    // 小艾先付 1000，並且整筆算她自己負擔
    await preorders.payPreorder(c.ctxA, p.id, {
      amount: $(1000), accountId: c.accA, categoryId: null, occurredOn: "2026-09-20",
      title: "訂金", note: "", split: { method: "FULL", participants: [{ userId: c.aId }] },
      clientRequestId: rid(),
    });
    const v = await preorders.getPreorder(c.ctxA, p.id);
    const a = v!.shares.find((s) => s.userId === c.aId)!;
    const b = v!.shares.find((s) => s.userId === c.bId)!;
    assert.equal(a.due, $(3000));
    assert.equal(a.borne, $(1000));
    assert.equal(a.remaining, $(2000), "小艾還要負擔 2000");
    assert.equal(b.remaining, $(1000), "阿本那件還沒付");
  });

  it("8. 兩個人看到的應負擔一致（不會因為誰在看而不同）", async () => {
    const list = await preorders.listPreorders(c.ctxA);
    const p = list.find((x) => x.name === "有運費")!;
    const fromA = await preorders.getPreorder(c.ctxA, p.id);
    const fromB = await preorders.getPreorder(c.ctxB, p.id);
    assert.deepEqual(
      fromA!.shares.map((s) => [s.userId, s.due]).sort(),
      fromB!.shares.map((s) => [s.userId, s.due]).sort(),
    );
  });
});
