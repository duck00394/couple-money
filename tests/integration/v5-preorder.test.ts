import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as preorders from "../../src/server/services/preorders";
import * as ledger from "../../src/server/services/ledger";
import * as transfers from "../../src/server/services/transfers";
import { monthStats } from "../../src/server/services/stats";
import type { PreorderInput } from "../../src/server/services/preorders";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;

/**
 * 預購。最重要的一條：**待結款不是支出**。
 * 還沒付的錢不扣帳戶、不進統計；真的建立那筆 Transaction 才算花出去。
 */
describe("V5：預購", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;

  const input = (over: Partial<PreorderInput> = {}): PreorderInput => ({
    name: "Switch 2 主機", seller: "博客來", emoji: "gamepad",
    expectedOn: D(30), itemAmount: $(13000), shipping: $(150),
    ownerId: null, note: "", ...over,
  });
  const pay = (id: string, amount: number, day: number, accountId?: string) =>
    preorders.payPreorder(c.ctxA, id, {
      amount, accountId: accountId ?? c.accA, categoryId: null,
      title: "預購付款", note: "", occurredOn: D(day),
      split: { method: "FULL", participants: [{ userId: c.aId }] },
      clientRequestId: rid(),
    });
  const view = async (id: string) => (await preorders.getPreorder(c.ctxA, id, { today: D(20) }))!;

  before(async () => {
    await reset();
    c = await setupCouple("po");
  });
  after(() => prisma.$disconnect());

  it("1. 建立我的／對方的／共同預購", async () => {
    const mine = await preorders.createPreorder(c.ctxA, input({ ownerId: c.aId }));
    const hers = await preorders.createPreorder(c.ctxA, input({ name: "他的預購", ownerId: c.bId }));
    const both = await preorders.createPreorder(c.ctxA, input({ name: "共同預購", ownerId: null }));
    assert.equal(mine.ownerId, c.aId);
    assert.equal(hers.ownerId, c.bId);
    assert.equal(both.ownerId, null);
    await rejects(preorders.createPreorder(c.ctxA, input({ ownerId: "nobody" })), "PREORDER_OWNER");
    await rejects(preorders.createPreorder(c.ctxA, input({ itemAmount: 0 })), "PREORDER_AMOUNT");
    await rejects(preorders.createPreorder(c.ctxA, input({ name: "" })), "PREORDER_NAME");
  });

  it("2. 剛建立：總額 = 商品 + 運費，已付 0，全部都是待結，而且不影響任何帳務", async () => {
    const solo = await setupCouple("po2");
    const p = await preorders.createPreorder(solo.ctxA, { ...input(), ownerId: solo.aId });
    const balBefore = (await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance;
    const v = (await preorders.getPreorder(solo.ctxA, p.id, { today: D(20) }))!;

    assert.equal(v.money.total, $(13150));
    assert.equal(v.money.paid, 0);
    assert.equal(v.money.remaining, $(13150));
    assert.equal(v.state, "ACTIVE");
    assert.equal((await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance, balBefore, "待結款不扣帳戶");
    assert.equal((await monthStats(solo.ctxA, MONTH)).totals.expense, 0, "待結款不進統計");
  });

  it("3. 多次付款：金額不固定、次數不固定，已付是加總，待結自己減少", async () => {
    const p = await preorders.createPreorder(c.ctxA, input({ name: "多次付款", ownerId: c.aId, itemAmount: $(10500), shipping: 0 }));
    for (const [amt, day] of [[$(1000), 2], [$(2000), 3], [$(3500), 4], [$(4000), 5]] as const) await pay(p.id, amt, day);

    const v = await view(p.id);
    assert.equal(v.payments.length, 4);
    assert.equal(v.money.paid, $(10500));
    assert.equal(v.money.remaining, 0);
    assert.equal(v.state, "SETTLED", "付完就是已結清");
  });

  it("4. 部分付款：付了一部分還是進行中，而且帳戶只少掉真的付出去的那些", async () => {
    const solo = await setupCouple("po4");
    const p = await preorders.createPreorder(solo.ctxA, { ...input(), ownerId: solo.aId });
    await preorders.payPreorder(solo.ctxA, p.id, {
      amount: $(3000), accountId: solo.accA, categoryId: null, title: "訂金", note: "", occurredOn: D(2),
      split: { method: "FULL", participants: [{ userId: solo.aId }] }, clientRequestId: rid(),
    });
    const v = (await preorders.getPreorder(solo.ctxA, p.id, { today: D(20) }))!;
    assert.equal(v.money.paid, $(3000));
    assert.equal(v.money.remaining, $(10150));
    assert.equal(v.state, "ACTIVE");
    assert.equal((await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance, -$(3000), "只扣已付的");
    assert.equal((await monthStats(solo.ctxA, MONTH)).totals.expense, $(3000), "統計也只算已付的");
  });

  it("5. 取消不會產生任何金流（取消但不退款）", async () => {
    const solo = await setupCouple("po5");
    const p = await preorders.createPreorder(solo.ctxA, { ...input(), ownerId: solo.aId });
    await preorders.payPreorder(solo.ctxA, p.id, {
      amount: $(3000), accountId: solo.accA, categoryId: null, title: "訂金", note: "", occurredOn: D(2),
      split: { method: "FULL", participants: [{ userId: solo.aId }] }, clientRequestId: rid(),
    });
    const txCount = await prisma.transaction.count({ where: { bookId: solo.ctxA.book.id } });

    await preorders.setPreorderCancelled(solo.ctxA, p.id, true);
    const v = (await preorders.getPreorder(solo.ctxA, p.id, { today: D(20) }))!;
    assert.equal(v.state, "CANCELLED");
    assert.equal(v.money.paid, $(3000), "已付的錢還是已付");
    assert.equal(v.money.remaining, 0, "取消之後不用再付了，待結是 0");
    assert.equal(v.money.total, $(13150), "應付總額仍然看得到原本訂了多少");
    assert.equal(await prisma.transaction.count({ where: { bookId: solo.ctxA.book.id } }), txCount, "沒有多產生任何交易");
    assert.equal((await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance, -$(3000));

    // 可以恢復
    await preorders.setPreorderCancelled(solo.ctxA, p.id, false);
    const back = (await preorders.getPreorder(solo.ctxA, p.id, { today: D(20) }))!;
    assert.equal(back.state, "ACTIVE");
    assert.equal(back.money.remaining, $(10150), "恢復之後待結自己回來");
  });

  it("6. 全額退款：走既有的退款流程，已付自己變回 0、待結變回全額", async () => {
    const solo = await setupCouple("po6");
    const p = await preorders.createPreorder(solo.ctxA, { ...input(), ownerId: solo.aId, itemAmount: $(5000), shipping: 0 });
    const tx = await preorders.payPreorder(solo.ctxA, p.id, {
      amount: $(5000), accountId: solo.accA, categoryId: null, title: "全額", note: "", occurredOn: D(2),
      split: { method: "FULL", participants: [{ userId: solo.aId }] }, clientRequestId: rid(),
    });
    assert.equal((await preorders.getPreorder(solo.ctxA, p.id, { today: D(20) }))!.state, "SETTLED");

    await transfers.createRefund(solo.ctxA, {
      originalId: tx.id, amount: $(5000), accountId: solo.accA, note: "退款", occurredOn: D(6), clientRequestId: rid(),
    });
    const v = (await preorders.getPreorder(solo.ctxA, p.id, { today: D(20) }))!;
    assert.equal(v.money.paid, 0, "退完就等於沒付");
    assert.equal(v.money.remaining, $(5000));
    assert.equal(v.state, "ACTIVE", "退款之後回到進行中");
    assert.equal((await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance, 0, "帳戶也回到原狀");
  });

  it("7. 部分退款：已付只扣掉退回來的那部分", async () => {
    const solo = await setupCouple("po7");
    const p = await preorders.createPreorder(solo.ctxA, { ...input(), ownerId: solo.aId, itemAmount: $(5000), shipping: 0 });
    const tx = await preorders.payPreorder(solo.ctxA, p.id, {
      amount: $(5000), accountId: solo.accA, categoryId: null, title: "全額", note: "", occurredOn: D(2),
      split: { method: "FULL", participants: [{ userId: solo.aId }] }, clientRequestId: rid(),
    });
    await transfers.createRefund(solo.ctxA, {
      originalId: tx.id, amount: $(2000), accountId: solo.accA, note: "部分退款", occurredOn: D(6), clientRequestId: rid(),
    });
    const v = (await preorders.getPreorder(solo.ctxA, p.id, { today: D(20) }))!;
    assert.equal(v.money.paid, $(3000));
    assert.equal(v.money.remaining, $(2000));
    assert.equal(v.payments[0].refunded, $(2000), "詳細頁看得到這筆退了多少");
  });

  it("8. 付款走的是既有 Transaction：分帳、帳戶、統計、CSV 全部沿用", async () => {
    const solo = await setupCouple("po8");
    const p = await preorders.createPreorder(solo.ctxA, { ...input(), ownerId: null, itemAmount: $(1000), shipping: 0 });
    const tx = await preorders.payPreorder(solo.ctxA, p.id, {
      amount: $(1000), accountId: solo.accA, categoryId: null, title: "共同預購付款", note: "", occurredOn: D(2),
      split: { method: "EQUAL", participants: [{ userId: solo.aId }, { userId: solo.bId }] }, clientRequestId: rid(),
    });
    assert.equal(tx.type, "EXPENSE");
    assert.equal(tx.preorderId, p.id);
    // 分帳有生效：阿本欠小艾一半
    const debts = (await ledger.getBalances(solo.ctxA)).debts;
    assert.equal(debts[0]?.amount, $(500));
    // 交易明細看得到這一筆（沒有另外一套付款紀錄）
    const list = await ledger.listTransactions(solo.ctxA, { take: 10 });
    assert.ok(list.some((t) => t.id === tx.id));
  });

  it("9. 首頁提醒：只算進行中且還有待結的，金額是待結總和", async () => {
    const solo = await setupCouple("po9");
    const a = await preorders.createPreorder(solo.ctxA, { ...input(), name: "A", ownerId: solo.aId, itemAmount: $(10000), shipping: 0, expectedOn: D(22) });
    const b = await preorders.createPreorder(solo.ctxA, { ...input(), name: "B", ownerId: solo.aId, itemAmount: $(2300), shipping: 0, expectedOn: D(28) });
    const done = await preorders.createPreorder(solo.ctxA, { ...input(), name: "已付完", ownerId: solo.aId, itemAmount: $(500), shipping: 0 });
    const cancelled = await preorders.createPreorder(solo.ctxA, { ...input(), name: "取消的", ownerId: solo.aId, itemAmount: $(9999), shipping: 0 });
    await preorders.payPreorder(solo.ctxA, done.id, {
      amount: $(500), accountId: solo.accA, categoryId: null, title: "付清", note: "", occurredOn: D(2),
      split: { method: "FULL", participants: [{ userId: solo.aId }] }, clientRequestId: rid(),
    });
    await preorders.setPreorderCancelled(solo.ctxA, cancelled.id, true);

    const pending = await preorders.pendingPreorders(solo.ctxA, { today: D(20) });
    assert.equal(pending.count, 2, "已結清與已取消都不算");
    assert.equal(pending.remaining, $(12300));
    assert.equal(pending.soonest?.id, a.id, "最快到貨的排第一");
    assert.ok(b.id && done.id);
  });

  it("10. 排序：7 天內到貨 → 其他進行中 → 已結清 → 已取消", async () => {
    const solo = await setupCouple("po10");
    const mk = async (name: string, day: number | null, amount = $(100)) =>
      preorders.createPreorder(solo.ctxA, { ...input(), name, ownerId: solo.aId, itemAmount: amount, shipping: 0, expectedOn: day ? D(day) : null });
    await mk("遠的", 28);
    await mk("快到了", 22);
    await mk("沒日期", null);
    const paid = await mk("已結清", 21);
    const gone = await mk("已取消", 21);
    await preorders.payPreorder(solo.ctxA, paid.id, {
      amount: $(100), accountId: solo.accA, categoryId: null, title: "付清", note: "", occurredOn: D(2),
      split: { method: "FULL", participants: [{ userId: solo.aId }] }, clientRequestId: rid(),
    });
    await preorders.setPreorderCancelled(solo.ctxA, gone.id, true);

    const names = (await preorders.listPreorders(solo.ctxA, { today: D(20) })).map((p) => p.name);
    assert.deepEqual(names, ["快到了", "遠的", "沒日期", "已結清", "已取消"]);
  });

  it("11. 刪除訂單：付款紀錄留著，只是不再屬於任何一張預購", async () => {
    const solo = await setupCouple("po11");
    const p = await preorders.createPreorder(solo.ctxA, { ...input(), ownerId: solo.aId, itemAmount: $(300), shipping: 0 });
    const tx = await preorders.payPreorder(solo.ctxA, p.id, {
      amount: $(300), accountId: solo.accA, categoryId: null, title: "付款", note: "", occurredOn: D(2),
      split: { method: "FULL", participants: [{ userId: solo.aId }] }, clientRequestId: rid(),
    });
    await preorders.deletePreorder(solo.ctxA, p.id);
    assert.equal(await preorders.getPreorder(solo.ctxA, p.id), null);
    const kept = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(kept.deletedAt, null, "交易還在");
    assert.equal(kept.preorderId, null);
    assert.equal((await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance, -$(300), "餘額不變");
  });

  it("12. 作廢一筆付款：已付跟著減少，不會 double count", async () => {
    const solo = await setupCouple("po12");
    const p = await preorders.createPreorder(solo.ctxA, { ...input(), ownerId: solo.aId, itemAmount: $(1000), shipping: 0 });
    const tx = await preorders.payPreorder(solo.ctxA, p.id, {
      amount: $(400), accountId: solo.accA, categoryId: null, title: "訂金", note: "", occurredOn: D(2),
      split: { method: "FULL", participants: [{ userId: solo.aId }] }, clientRequestId: rid(),
    });
    assert.equal((await preorders.getPreorder(solo.ctxA, p.id, { today: D(20) }))!.money.paid, $(400));
    await ledger.deleteTransaction(solo.ctxA, tx.id);
    const v = (await preorders.getPreorder(solo.ctxA, p.id, { today: D(20) }))!;
    assert.equal(v.money.paid, 0, "作廢的付款不算");
    assert.equal(v.money.remaining, $(1000));
  });
});
