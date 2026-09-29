import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as preorders from "../../src/server/services/preorders";
import * as ledger from "../../src/server/services/ledger";
import { payablePreorders } from "../../src/server/txFormData";
import type { PreorderInput } from "../../src/server/services/preorders";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;

describe("V8：預購的誰付多少與明細品項", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;

  const base = (over: Partial<PreorderInput> = {}): PreorderInput => ({
    name: "預購", seller: "", emoji: "package", expectedOn: D(30),
    itemAmount: $(10000), shipping: 0, ownerId: null, note: "", ...over,
  });
  const view = async (id: string) => (await preorders.getPreorder(c.ctxA, id, { today: D(20) }))!;
  const dueOf = async (id: string, uid: string) => (await view(id)).shares.find((s) => s.userId === uid)!;

  before(async () => {
    await reset();
    c = await setupCouple("po8");
  });
  after(() => prisma.$disconnect());

  it("1. 沒設規則時維持舊行為：共同就平分", async () => {
    const p = await preorders.createPreorder(c.ctxA, base());
    assert.equal((await dueOf(p.id, c.aId)).due, $(5000));
    assert.equal((await dueOf(p.id, c.bId)).due, $(5000));
    assert.equal((await view(p.id)).splitRule, null);
  });

  it("2. 比例 7:3：不再是一人一半", async () => {
    const p = await preorders.createPreorder(c.ctxA, base({
      splitRule: { method: "RATIO", participants: [{ userId: c.aId, value: 70 }, { userId: c.bId, value: 30 }] },
    }));
    assert.equal((await dueOf(p.id, c.aId)).due, $(7000));
    assert.equal((await dueOf(p.id, c.bId)).due, $(3000));
  });

  it("3. 直接指定金額：小艾 $8,000、阿本 $2,000", async () => {
    const p = await preorders.createPreorder(c.ctxA, base({
      splitRule: { method: "AMOUNT", participants: [{ userId: c.aId, value: $(8000) }, { userId: c.bId, value: $(2000) }] },
    }));
    assert.equal((await dueOf(p.id, c.aId)).due, $(8000));
    assert.equal((await dueOf(p.id, c.bId)).due, $(2000));
    assert.equal((await view(p.id)).shares.reduce((a, s) => a + s.due, 0), $(10000));
  });

  it("4. 指定金額加起來不等於應付總額 → 直接擋下來，不會存錯的規則", async () => {
    await rejects(
      preorders.createPreorder(c.ctxA, base({
        splitRule: { method: "AMOUNT", participants: [{ userId: c.aId, value: $(8000) }, { userId: c.bId, value: $(1000) }] },
      })),
      "SPLIT_AMOUNT_SUM",
    );
  });

  it("5. 規則對象必須是帳本成員", async () => {
    await rejects(
      preorders.createPreorder(c.ctxA, base({
        splitRule: { method: "EQUAL", participants: [{ userId: "ghost" }] },
      })),
      "PREORDER_SPLIT",
    );
  });

  it("6. 明細品項：商品金額由品項自動加總，傳進來的數字會被蓋掉", async () => {
    const p = await preorders.createPreorder(c.ctxA, base({
      itemAmount: $(999), // 故意亂填
      shipping: $(150),
      items: [
        { name: "主機", unitAmount: $(12000), qty: 1, ownerId: null },
        { name: "保護貼", unitAmount: $(150), qty: 2, ownerId: c.aId },
      ],
    }));
    const v = await view(p.id);
    assert.equal(v.itemAmount, $(12300), "12,000 + 150×2");
    assert.equal(v.money.total, $(12450), "再加運費 150");
    assert.deepEqual(v.items.map((i) => [i.name, i.qty, i.total]), [["主機", 1, $(12000)], ["保護貼", 2, $(300)]]);
    assert.equal(v.items[1].ownerId, c.aId);
  });

  it("7. 編輯：品項整批換掉，商品金額跟著重算", async () => {
    const p = await preorders.createPreorder(c.ctxA, base({
      items: [{ name: "A", unitAmount: $(1000), qty: 1, ownerId: null }],
    }));
    assert.equal((await view(p.id)).itemAmount, $(1000));
    await preorders.updatePreorder(c.ctxA, p.id, base({
      items: [
        { name: "B", unitAmount: $(500), qty: 3, ownerId: null },
        { name: "C", unitAmount: $(250), qty: 1, ownerId: c.bId },
      ],
    }));
    const v = await view(p.id);
    assert.equal(v.itemAmount, $(1750));
    assert.deepEqual(v.items.map((i) => i.name), ["B", "C"], "舊的 A 不會留著");
    assert.equal(await prisma.preorderItem.count({ where: { preorderId: p.id } }), 2);
  });

  it("8. 清空品項之後，商品金額回到手動填的數字", async () => {
    const p = await preorders.createPreorder(c.ctxA, base({
      items: [{ name: "A", unitAmount: $(1000), qty: 1, ownerId: null }],
    }));
    await preorders.updatePreorder(c.ctxA, p.id, base({ itemAmount: $(7777), items: [] }));
    const v = await view(p.id);
    assert.equal(v.items.length, 0);
    assert.equal(v.itemAmount, $(7777));
  });

  it("9. 品項的驗證：名稱、單價、數量、誰的", async () => {
    await rejects(preorders.createPreorder(c.ctxA, base({ items: [{ name: "  ", unitAmount: $(1), qty: 1, ownerId: null }] })), "PREORDER_ITEM_NAME");
    await rejects(preorders.createPreorder(c.ctxA, base({ items: [{ name: "A", unitAmount: 0, qty: 1, ownerId: null }] })), "PREORDER_ITEM_AMOUNT");
    await rejects(preorders.createPreorder(c.ctxA, base({ items: [{ name: "A", unitAmount: $(1), qty: 0, ownerId: null }] })), "PREORDER_ITEM_QTY");
    await rejects(preorders.createPreorder(c.ctxA, base({ items: [{ name: "A", unitAmount: $(1), qty: 1, ownerId: "ghost" }] })), "PREORDER_ITEM_OWNER");
  });

  it("10. 誰付多少會反映到「還需付」：7:3 的單，我先付了 $2,000", async () => {
    const p = await preorders.createPreorder(c.ctxA, base({
      splitRule: { method: "RATIO", participants: [{ userId: c.aId, value: 70 }, { userId: c.bId, value: 30 }] },
    }));
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(2000), accountId: c.accA, categoryId: null,
      title: "訂金", note: "", occurredOn: D(5),
      split: { method: "FULL", participants: [{ userId: c.aId }] },
      clientRequestId: rid(), preorderId: p.id,
    });
    assert.deepEqual(await dueOf(p.id, c.aId), { userId: c.aId, due: $(7000), borne: $(2000), remaining: $(5000), over: 0 });
    assert.deepEqual(await dueOf(p.id, c.bId), { userId: c.bId, due: $(3000), borne: 0, remaining: $(3000), over: 0 });
  });

  it("11. 記帳頁的選單也拿得到規則算出來的每人應負擔", async () => {
    const p = await preorders.createPreorder(c.ctxA, base({
      name: "記帳頁用",
      splitRule: { method: "AMOUNT", participants: [{ userId: c.aId, value: $(9000) }, { userId: c.bId, value: $(1000) }] },
    }));
    const hit = (await payablePreorders(c.ctxA)).find((x) => x.id === p.id)!;
    assert.equal(hit.shares.find((s) => s.userId === c.aId)!.due, $(9000));
    assert.equal(hit.shares.find((s) => s.userId === c.bId)!.due, $(1000));
  });

  it("12. 取消之後每個人都不用再付，恢復之後規則還在", async () => {
    const p = await preorders.createPreorder(c.ctxA, base({
      splitRule: { method: "RATIO", participants: [{ userId: c.aId, value: 70 }, { userId: c.bId, value: 30 }] },
    }));
    await preorders.setPreorderCancelled(c.ctxA, p.id, true);
    assert.ok((await view(p.id)).shares.every((s) => s.remaining === 0));
    await preorders.setPreorderCancelled(c.ctxA, p.id, false);
    assert.equal((await dueOf(p.id, c.aId)).due, $(7000), "恢復之後規則還在");
  });

  it("13. 刪除預購是軟刪除：品項留著（單子可以被還原），付款紀錄也留著", async () => {
    const p = await preorders.createPreorder(c.ctxA, base({
      items: [{ name: "A", unitAmount: $(1000), qty: 1, ownerId: null }],
    }));
    const tx = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(500), accountId: c.accA, categoryId: null,
      title: "訂金", note: "", occurredOn: D(5),
      split: { method: "FULL", participants: [{ userId: c.aId }] },
      clientRequestId: rid(), preorderId: p.id,
    });
    await preorders.deletePreorder(c.ctxA, p.id);
    assert.equal(await preorders.getPreorder(c.ctxA, p.id, { today: D(20) }), null, "查不到了");
    assert.equal(await prisma.preorderItem.count({ where: { preorderId: p.id } }), 1, "軟刪除，品項沒有被硬刪");
    const kept = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(kept.deletedAt, null, "付款紀錄沒有被刪掉");
    assert.equal(kept.preorderId, null, "只是不再屬於任何預購");
  });

  it("14. 舊資料（沒有規則也沒有品項）完全不受影響", async () => {
    const p = await preorders.createPreorder(c.ctxA, base({ name: "舊的", itemAmount: $(3000), ownerId: c.bId }));
    const v = await view(p.id);
    assert.equal(v.splitRule, null);
    assert.equal(v.items.length, 0);
    assert.equal(v.shares.find((s) => s.userId === c.bId)!.due, $(3000));
    assert.equal(v.shares.find((s) => s.userId === c.aId)!.due, 0);
  });
});
