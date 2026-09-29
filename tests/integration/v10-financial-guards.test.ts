import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as preorders from "../../src/server/services/preorders";
import { maxSettleAmount } from "../../src/server/domain/balance";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;

/**
 * 結算不可以把「已指定給基金」的錢花掉。
 *
 * 不變式：每個帳戶的餘額都要 ≥ 已指定給該帳戶的基金金額。
 * 記帳與轉帳本來就守這條，結算原本漏掉了。
 */
describe("V10：結算不會吃掉基金指定的錢", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;

  /** 讓小艾的現金帳戶有 amount 元 */
  const fundAccount = async (amount: number) =>
    ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount, accountId: c.accA, categoryId: null,
      title: "入帳", note: "", occurredOn: D(1),
      split: { method: "FULL", participants: [{ userId: c.aId }] },
      clientRequestId: rid(),
    });

  /** 阿本付一筆平分的錢 → 小艾欠阿本一半 */
  const owe = (amount: number) =>
    ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount, accountId: c.accB, categoryId: null,
      title: "阿本付的", note: "", occurredOn: D(2),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
      clientRequestId: rid(),
    });

  const earmark = async (amount: number) => {
    const f = await funds.createFund(c.ctxA, {
      name: "旅行基金", emoji: "piggy-bank", description: "", targetAmount: null, dueDate: null,
    });
    await funds.addFundEntry(c.ctxA, {
      fundId: f.id, type: "DEPOSIT", amount, userId: c.aId, accountId: c.accA,
      note: "", occurredOn: D(1), clientRequestId: rid(),
    });
    return f;
  };

  const balanceOf = async (accountId: string) =>
    (await ledger.listAccounts(c.ctxA)).find((a) => a.id === accountId)!.balance;

  before(async () => {
    await reset();
    c = await setupCouple("guard");
  });
  after(() => prisma.$disconnect());

  it("1. 餘額 1000、基金指定 1000、欠款 500 → 結算必須失敗", async () => {
    await reset();
    c = await setupCouple("guard1");
    await fundAccount($(1000));
    await earmark($(1000));
    await owe($(1000)); // 小艾欠阿本 $500

    const before = {
      balanceA: await balanceOf(c.accA),
      balanceB: await balanceOf(c.accB),
      free: (await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.accA)).free,
      settlements: await prisma.settlement.count({ where: { bookId: c.ctxA.book.id } }),
      txs: await prisma.transaction.count({ where: { bookId: c.ctxA.book.id } }),
    };
    assert.equal(before.free, 0, "可自由使用是 0");

    await rejects(
      ledger.settle(c.ctxA, {
        fromUserId: c.aId, toUserId: c.bId, amount: $(500),
        fromAccountId: c.accA, toAccountId: c.accB, note: "", clientRequestId: rid(),
      }),
      "TRANSFER_EARMARK_BACKING",
    );

    assert.equal(await prisma.settlement.count({ where: { bookId: c.ctxA.book.id } }), before.settlements, "沒有建立 Settlement");
    assert.equal(await prisma.transaction.count({ where: { bookId: c.ctxA.book.id } }), before.txs, "沒有留下半筆交易");
    assert.equal(await balanceOf(c.accA), before.balanceA, "餘額沒有被動到");
    assert.equal(await balanceOf(c.accB), before.balanceB);
    const b = await ledger.getBalances(c.ctxA);
    assert.equal(maxSettleAmount(b.net, c.aId, c.bId), $(500), "欠款也沒有被動到");
  });

  it("2. 錯誤訊息看得懂：說出已指定多少、可自由使用多少", async () => {
    await assert.rejects(
      ledger.settle(c.ctxA, {
        fromUserId: c.aId, toUserId: c.bId, amount: $(500),
        fromAccountId: c.accA, toAccountId: c.accB, note: "", clientRequestId: rid(),
      }),
      (e: Error) => {
        assert.match(e.message, /已指定給基金/);
        assert.match(e.message, /可自由使用/);
        assert.match(e.message, /無法用這筆錢結算/);
        return true;
      },
    );
  });

  it("3. 餘額 1500、基金指定 1000、結算 500 → 成功，而且結算後仍然 餘額 ≥ 已指定", async () => {
    await reset();
    c = await setupCouple("guard3");
    await fundAccount($(1500));
    await earmark($(1000));
    await owe($(1000)); // 小艾欠阿本 $500

    await ledger.settle(c.ctxA, {
      fromUserId: c.aId, toUserId: c.bId, amount: $(500),
      fromAccountId: c.accA, toAccountId: c.accB, note: "", clientRequestId: rid(),
    });

    const after = await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.accA);
    assert.equal(after.balance, $(1000));
    assert.equal(after.earmarked, $(1000));
    assert.equal(after.free, 0);
    assert.ok(after.balance >= after.earmarked, "不變式仍然成立");
    const b = await ledger.getBalances(c.ctxA);
    assert.equal(maxSettleAmount(b.net, c.aId, c.bId), 0, "欠款結清");
  });

  it("4. 剛好結算到 free 見底可以，再多一塊就不行", async () => {
    await reset();
    c = await setupCouple("guard4");
    await fundAccount($(1200));
    await earmark($(1000));
    await owe($(1000)); // 欠 $500，可自由使用只有 $200

    await rejects(
      ledger.settle(c.ctxA, {
        fromUserId: c.aId, toUserId: c.bId, amount: $(201),
        fromAccountId: c.accA, toAccountId: c.accB, note: "", clientRequestId: rid(),
      }),
      "TRANSFER_EARMARK_BACKING",
    );
    await ledger.settle(c.ctxA, {
      fromUserId: c.aId, toUserId: c.bId, amount: $(200),
      fromAccountId: c.accA, toAccountId: c.accB, note: "", clientRequestId: rid(),
    });
    const after = await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.accA);
    assert.equal(after.free, 0);
  });

  it("5. 沒有指定給基金的帳戶不受影響（餘額可以被結算到負的）", async () => {
    await reset();
    c = await setupCouple("guard5");
    await owe($(1000)); // 小艾欠 $500，帳戶是 0
    await ledger.settle(c.ctxA, {
      fromUserId: c.aId, toUserId: c.bId, amount: $(500),
      fromAccountId: c.accA, toAccountId: c.accB, note: "", clientRequestId: rid(),
    });
    assert.equal(await balanceOf(c.accA), -$(500));
  });

  it("6. 作廢結算之後，欠款與餘額都回得來", async () => {
    const s = (await ledger.listSettlements(c.ctxA))[0];
    await ledger.cancelSettlement(c.ctxA, s.id);
    assert.equal(await balanceOf(c.accA), 0);
    const b = await ledger.getBalances(c.ctxA);
    assert.equal(maxSettleAmount(b.net, c.aId, c.bId), $(500));
  });
});

/**
 * 預購只有「進行中」能付款。
 * 已結清再付 = 超付、已取消再付 = 憑空多一筆支出，兩個都要在 service 層擋掉。
 */
describe("V10：預購只有進行中能付款", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;

  const make = (total: number) =>
    preorders.createPreorder(c.ctxA, {
      name: "預購", seller: "", emoji: "package", expectedOn: null,
      itemAmount: total, shipping: 0, ownerId: c.aId, note: "",
    });
  const pay = (id: string, amount: number) =>
    preorders.payPreorder(c.ctxA, id, {
      amount, accountId: c.accA, categoryId: null, title: "付款", note: "",
      occurredOn: D(5), split: { method: "FULL", participants: [{ userId: c.aId }] },
      clientRequestId: rid(),
    });
  const view = (id: string) => preorders.getPreorder(c.ctxA, id, { today: D(20) });
  const txCount = () => prisma.transaction.count({ where: { bookId: c.ctxA.book.id } });

  before(async () => {
    await reset();
    c = await setupCouple("pay");
  });
  after(() => prisma.$disconnect());

  it("1. ACTIVE 且還有待付 → 可以付款", async () => {
    const p = await make($(1000));
    await pay(p.id, $(400));
    const v = (await view(p.id))!;
    assert.equal(v.state, "ACTIVE");
    assert.equal(v.money.paid, $(400));
    assert.equal(v.money.remaining, $(600));
  });

  it("2. 付完剩下的 → 正確轉成 SETTLED", async () => {
    const p = await make($(1000));
    await pay(p.id, $(600));
    await pay(p.id, $(400));
    const v = (await view(p.id))!;
    assert.equal(v.state, "SETTLED");
    assert.equal(v.money.remaining, 0);
  });

  it("3. SETTLED → payPreorder 必須失敗，而且不留下任何交易", async () => {
    const p = await make($(500));
    await pay(p.id, $(500));
    assert.equal((await view(p.id))!.state, "SETTLED");

    const before = { txs: await txCount(), paid: (await view(p.id))!.money.paid };
    await rejects(pay(p.id, $(100)), "PREORDER_NOT_PAYABLE");
    assert.equal(await txCount(), before.txs, "沒有多出任何 Transaction");
    assert.equal((await view(p.id))!.money.paid, before.paid, "已付金額沒有變");
    assert.equal((await view(p.id))!.money.overpaid, 0, "沒有變成超付");
  });

  it("4. CANCELLED → payPreorder 必須失敗，而且不留下任何交易", async () => {
    const p = await make($(800));
    await pay(p.id, $(300));
    await preorders.setPreorderCancelled(c.ctxA, p.id, true);

    const before = { txs: await txCount(), paid: (await view(p.id))!.money.paid };
    await rejects(pay(p.id, $(100)), "PREORDER_NOT_PAYABLE");
    assert.equal(await txCount(), before.txs);
    assert.equal((await view(p.id))!.money.paid, before.paid, "既有的付款紀錄完全沒被動到");
  });

  it("5. 錯誤訊息講得出原因", async () => {
    const p = await make($(300));
    await pay(p.id, $(300));
    await assert.rejects(pay(p.id, $(50)), (e: Error) => {
      assert.match(e.message, /已經付清/);
      return true;
    });
    await preorders.setPreorderCancelled(c.ctxA, p.id, true);
    await assert.rejects(pay(p.id, $(50)), (e: Error) => {
      assert.match(e.message, /已經取消/);
      return true;
    });
  });

  it("6. 恢復取消之後又可以付款", async () => {
    const p = await make($(900));
    await pay(p.id, $(200));
    await preorders.setPreorderCancelled(c.ctxA, p.id, true);
    await rejects(pay(p.id, $(100)), "PREORDER_NOT_PAYABLE");
    await preorders.setPreorderCancelled(c.ctxA, p.id, false);
    await pay(p.id, $(100));
    assert.equal((await view(p.id))!.money.paid, $(300));
  });

  it("7. 把總額改大之後，已結清的單子重新變回可以付款", async () => {
    const p = await make($(500));
    await pay(p.id, $(500));
    await rejects(pay(p.id, $(100)), "PREORDER_NOT_PAYABLE");
    await preorders.updatePreorder(c.ctxA, p.id, {
      name: "預購", seller: "", emoji: "package", expectedOn: null,
      itemAmount: $(800), shipping: 0, ownerId: c.aId, note: "",
    });
    assert.equal((await view(p.id))!.state, "ACTIVE");
    await pay(p.id, $(300));
    assert.equal((await view(p.id))!.state, "SETTLED");
  });
});

/**
 * 把預購總額改到低於已付金額是合理的（降價、少買一件），不阻擋；
 * 但動態紀錄要看得出來是哪一次改出來的。
 */
describe("V10：預購改小造成超付", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;

  before(async () => {
    await reset();
    c = await setupCouple("over");
  });
  after(() => prisma.$disconnect());

  it("1. 10,000 付了 8,000，改成 5,000：允許，並標記成超付 3,000", async () => {
    const p = await preorders.createPreorder(c.ctxA, {
      name: "降價的單", seller: "", emoji: "package", expectedOn: null,
      itemAmount: $(10000), shipping: 0, ownerId: c.aId, note: "",
    });
    await preorders.payPreorder(c.ctxA, p.id, {
      amount: $(8000), accountId: c.accA, categoryId: null, title: "訂金", note: "",
      occurredOn: D(5), split: { method: "FULL", participants: [{ userId: c.aId }] }, clientRequestId: rid(),
    });
    await preorders.updatePreorder(c.ctxA, p.id, {
      name: "降價的單", seller: "", emoji: "package", expectedOn: null,
      itemAmount: $(5000), shipping: 0, ownerId: c.aId, note: "",
    });

    const v = (await preorders.getPreorder(c.ctxA, p.id))!;
    assert.equal(v.money.total, $(5000));
    assert.equal(v.money.paid, $(8000), "已付的錢不會憑空消失");
    assert.equal(v.money.overpaid, $(3000));
    assert.equal(v.money.remaining, 0);
    assert.equal(v.state, "SETTLED");

    // 動態紀錄追得到：這一次修改把它改成超付
    const log = await prisma.auditLog.findFirst({
      where: { bookId: c.ctxA.book.id, entityType: "Preorder", entityId: p.id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(log, "有留下修改紀錄");
    const after = log.after as Record<string, unknown> | null;
    assert.equal(after?.overpaidAfter, $(3000), "紀錄裡看得到超付多少");
    assert.equal(after?.paidBefore, $(8000), "也看得到當時已付多少");
  });

  it("2. 改成超付之後不能再付款（已經是 SETTLED）", async () => {
    const p = (await preorders.listPreorders(c.ctxA)).find((x) => x.name === "降價的單")!;
    await rejects(
      preorders.payPreorder(c.ctxA, p.id, {
        amount: $(100), accountId: c.accA, categoryId: null, title: "再付", note: "",
        occurredOn: D(6), split: { method: "FULL", participants: [{ userId: c.aId }] }, clientRequestId: rid(),
      }),
      "PREORDER_NOT_PAYABLE",
    );
  });
});
