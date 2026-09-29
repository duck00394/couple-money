import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as preorders from "../../src/server/services/preorders";
import * as transfers from "../../src/server/services/transfers";
import { payablePreorders, loadTxFormOptions } from "../../src/server/txFormData";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;

/**
 * V7：預購可以直接在記帳頁選，並顯示已付／待付／每個人還需付。
 * 付款仍然是普通的 EXPENSE，只是多帶一個 preorderId——沒有第二套金流。
 */
describe("V7：在記帳頁掛預購", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let joint: string; // 共同預購 $10,000
  let mine: string; //  我的預購 $2,000

  const spend = (over: Partial<Parameters<typeof ledger.createTransaction>[1]> = {}) =>
    ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1000), accountId: c.accA, categoryId: null,
      title: "預購付款", note: "", occurredOn: D(5),
      split: { method: "FULL", participants: [{ userId: c.aId }] },
      clientRequestId: rid(), ...over,
    });
  const view = (id: string) => preorders.getPreorder(c.ctxA, id, { today: D(20) });
  const shareOf = async (id: string, userId: string) => (await view(id))!.shares.find((s) => s.userId === userId)!;

  before(async () => {
    await reset();
    c = await setupCouple("po7");
    joint = (await preorders.createPreorder(c.ctxA, {
      name: "共同預購", seller: "", emoji: "package", expectedOn: D(30),
      itemAmount: $(10000), shipping: 0, ownerId: null, note: "",
    })).id;
    mine = (await preorders.createPreorder(c.ctxA, {
      name: "我的預購", seller: "", emoji: "package", expectedOn: null,
      itemAmount: $(2000), shipping: 0, ownerId: c.aId, note: "",
    })).id;
  });
  after(() => prisma.$disconnect());

  it("1. 記帳頁拿得到還沒付完的預購，而且帶著已付／待付／每人應負擔", async () => {
    const list = await payablePreorders(c.ctxA);
    assert.deepEqual(list.map((p) => p.name).sort(), ["共同預購", "我的預購"]);
    const j = list.find((p) => p.name === "共同預購")!;
    assert.equal(j.total, $(10000));
    assert.equal(j.paid, 0);
    assert.equal(j.remaining, $(10000));
    assert.deepEqual(j.shares.map((s) => s.due).sort((a, b) => a - b), [$(5000), $(5000)]);
    const options = await loadTxFormOptions(c.ctxA);
    assert.equal(options.preorders.length, 2, "記帳表單的選項裡就有");
  });

  it("2. 從記帳頁記一筆並掛上預購：就是普通 EXPENSE，只是多一個關聯", async () => {
    const tx = await spend({ amount: $(4000), preorderId: joint });
    const saved = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(saved.preorderId, joint);
    assert.equal(saved.type, "EXPENSE");
    const v = (await view(joint))!;
    assert.equal(v.money.paid, $(4000));
    assert.equal(v.money.remaining, $(6000));
    // 帳戶真的被扣了（待付款不扣，付了才扣）
    assert.equal((await ledger.listAccounts(c.ctxA)).find((a) => a.id === c.accA)!.balance, -$(4000));
  });

  it("3. 每個人還需付：我自己付全額 → 我已負擔 4,000，對方還是要付自己那 5,000", async () => {
    assert.deepEqual(await shareOf(joint, c.aId), { userId: c.aId, due: $(5000), borne: $(4000), remaining: $(1000), over: 0 });
    assert.deepEqual(await shareOf(joint, c.bId), { userId: c.bId, due: $(5000), borne: 0, remaining: $(5000), over: 0 });
  });

  it("4. 換成兩人平分的付款：兩個人的「還需付」一起往下降", async () => {
    await spend({
      amount: $(2000), preorderId: joint,
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
    });
    assert.equal((await shareOf(joint, c.aId)).borne, $(5000));
    assert.equal((await shareOf(joint, c.aId)).remaining, 0);
    assert.equal((await shareOf(joint, c.bId)).borne, $(1000));
    assert.equal((await shareOf(joint, c.bId)).remaining, $(4000));
    const v = (await view(joint))!;
    assert.equal(v.money.paid, $(6000));
    assert.equal(v.money.remaining, $(4000));
  });

  it("5. 應負擔加總永遠等於應付總額", async () => {
    const v = (await view(joint))!;
    assert.equal(v.shares.reduce((a, s) => a + s.due, 0), v.money.total);
  });

  it("6. 我的預購：全部算我的，對方應負擔 0", async () => {
    assert.equal((await shareOf(mine, c.aId)).due, $(2000));
    assert.equal((await shareOf(mine, c.bId)).due, 0);
    assert.equal((await shareOf(mine, c.bId)).remaining, 0);
  });

  it("7. 編輯一筆記帳可以改掛到另一張預購，也可以解除關聯", async () => {
    const tx = await spend({ amount: $(500), preorderId: joint });
    const before = (await view(joint))!.money.paid;

    const base = {
      type: "EXPENSE" as const, amount: $(500), accountId: c.accA, categoryId: null,
      title: "預購付款", note: "", occurredOn: D(5),
      split: { method: "FULL" as const, participants: [{ userId: c.aId }] },
    };
    await ledger.updateTransaction(c.ctxA, tx.id, tx.version, { ...base, preorderId: mine });
    assert.equal((await view(joint))!.money.paid, before - $(500), "從原本那張移走");
    assert.equal((await view(mine))!.money.paid, $(500), "掛到新的那張");

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    await ledger.updateTransaction(c.ctxA, tx.id, after.version, { ...base, preorderId: null });
    assert.equal((await view(mine))!.money.paid, 0, "解除關聯");
    assert.equal(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).preorderId,
      null,
    );
  });

  it("8. 不能掛到別的帳本、或不存在的預購", async () => {
    const other = await setupCouple("po7b");
    const stranger = await preorders.createPreorder(other.ctxA, {
      name: "別人的預購", seller: "", emoji: "package", expectedOn: null,
      itemAmount: $(100), shipping: 0, ownerId: null, note: "",
    });
    await rejects(spend({ preorderId: stranger.id }), "PREORDER_NOT_FOUND");
    await rejects(spend({ preorderId: "no-such-id" }), "PREORDER_NOT_FOUND");
  });

  it("9. 作廢一筆付款：已付與每個人的已負擔一起退回去", async () => {
    const tx = await spend({ amount: $(1000), preorderId: joint });
    const paid = (await view(joint))!.money.paid;
    const borne = (await shareOf(joint, c.aId)).borne;
    await ledger.deleteTransaction(c.ctxA, tx.id);
    assert.equal((await view(joint))!.money.paid, paid - $(1000));
    assert.equal((await shareOf(joint, c.aId)).borne, borne - $(1000));
  });

  it("10. 退款：已付與已負擔一起降下來（退款的分帳是負的）", async () => {
    const tx = await spend({
      amount: $(1000), preorderId: joint,
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
    });
    const borneA = (await shareOf(joint, c.aId)).borne;
    const borneB = (await shareOf(joint, c.bId)).borne;
    await transfers.createRefund(c.ctxA, {
      originalId: tx.id, amount: $(400), accountId: c.accA, occurredOn: D(6), note: "", clientRequestId: rid(),
    });
    assert.equal((await shareOf(joint, c.aId)).borne, borneA - $(200));
    assert.equal((await shareOf(joint, c.bId)).borne, borneB - $(200));
  });

  it("11. 結清之後就不會再出現在記帳頁的選單裡（除非正在編輯那一筆）", async () => {
    const solo = await setupCouple("po7c");
    const p = await preorders.createPreorder(solo.ctxA, {
      name: "馬上付完", seller: "", emoji: "package", expectedOn: null,
      itemAmount: $(300), shipping: 0, ownerId: solo.aId, note: "",
    });
    const tx = await ledger.createTransaction(solo.ctxA, {
      type: "EXPENSE", amount: $(300), accountId: solo.accA, categoryId: null,
      title: "付清", note: "", occurredOn: D(5),
      split: { method: "FULL", participants: [{ userId: solo.aId }] },
      clientRequestId: rid(), preorderId: p.id,
    });
    assert.ok(!(await payablePreorders(solo.ctxA)).some((x) => x.id === p.id), "已結清不在選單裡");
    assert.ok((await payablePreorders(solo.ctxA, p.id)).some((x) => x.id === p.id), "編輯那一筆時仍然留著");
    assert.ok(tx.id);
  });

  it("12. 取消的預購：每個人都不用再付", async () => {
    await preorders.setPreorderCancelled(c.ctxA, mine, true);
    const v = (await view(mine))!;
    assert.equal(v.money.remaining, 0);
    assert.ok(v.shares.every((s) => s.remaining === 0));
    await preorders.setPreorderCancelled(c.ctxA, mine, false);
    assert.equal((await view(mine))!.shares.find((s) => s.userId === c.aId)!.remaining, $(2000));
  });
});
