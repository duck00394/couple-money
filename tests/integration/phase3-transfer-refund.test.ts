import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import { createRefund, createTransfer, listRefundable, refundedAmount, refundsOf } from "../../src/server/services/transfers";
import { searchTransactions } from "../../src/server/services/search";
import { parseFilter } from "../../src/server/domain/search";

const D = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;

describe("Phase 3-2：帳戶間轉帳與退款", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;
  let bBank = "";
  let card = "";
  let trip = "";
  let meal = ""; // 原始消費 $1,000（小艾 $400、阿本 $600）

  const balance = async (id: string) => (await ledger.listAccounts(c.ctxA)).find((a) => a.id === id)!.balance;
  const debtOf = async (userId: string) => (await ledger.getBalances(c.ctxA)).net.get(userId) ?? 0;
  const totals = async (params: Record<string, string> = {}) => (await searchTransactions(c.ctxA, parseFilter(params), { take: 200 })).totals;

  before(async () => {
    await reset();
    c = await setupCouple("tr");
    other = await setupCouple("ot");
    // 共同帳戶有 $30,000；阿本銀行 $20,000；小艾信用卡未繳 $1,500
    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(30000), accountId: c.joint, categoryId: null, title: "薪水存入共同帳戶", note: "",
      occurredOn: D(1), split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] }, clientRequestId: rid(),
    });
    bBank = (await ledger.createAccount(c.ctxB, { name: "阿本銀行", type: "BANK", shared: false, openingBalance: $(20000) })).id;
    card = (await ledger.createAccount(c.ctxA, { name: "玉山卡", type: "CREDIT_CARD", shared: false, openingBalance: -$(1500) })).id;
    meal = (await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1000), accountId: card, categoryId: null, title: "王品", note: "",
      occurredOn: D(5), split: { method: "AMOUNT", participants: [{ userId: c.aId, value: $(400) }, { userId: c.bId, value: $(600) }] },
      clientRequestId: rid(),
    })).id;
  });
  after(() => prisma.$disconnect());

  // ───────── 轉帳 ─────────

  it("轉帳實際影響兩個帳戶，且不算收入／支出、不影響誰欠誰", async () => {
    const debtBefore = await debtOf(c.aId);
    const t = await createTransfer(c.ctxB, { fromAccountId: bBank, toAccountId: c.joint, amount: $(5000), occurredOn: D(6), occurredTime: "09:30", note: "補共同帳戶", clientRequestId: rid() });
    assert.equal(t.type, "TRANSFER");
    assert.equal(await balance(bBank), $(15000));
    assert.equal(await balance(c.joint), $(35000));
    assert.equal(await debtOf(c.aId), debtBefore, "轉帳不影響欠款");
    const tt = await totals({ kind: "TRANSFER" });
    assert.equal(tt.expense, 0);
    assert.equal(tt.income, 0);
    assert.equal(tt.transferCount, 1);
    assert.equal(tt.transferAmount, $(5000));
    const saved = await prisma.transaction.findUniqueOrThrow({ where: { id: t.id }, include: { payments: true, splits: true } });
    assert.equal(saved.payments.reduce((a, p) => a + p.amount, 0), 0, "Σpayment = 0");
    assert.equal(saved.splits.length, 0, "轉帳不產生分帳");
    assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(saved.occurredAt), "09:30");
  });

  it("相同帳戶、金額 0、信用卡轉出都被擋", async () => {
    const base = { toAccountId: c.joint, amount: $(100), occurredOn: D(6), note: "", clientRequestId: rid() };
    await rejects(createTransfer(c.ctxA, { ...base, fromAccountId: c.joint, clientRequestId: rid() }), "TRANSFER_SAME");
    await rejects(createTransfer(c.ctxA, { ...base, fromAccountId: bBank, amount: 0, clientRequestId: rid() }), "TX_AMOUNT");
    await rejects(createTransfer(c.ctxA, { ...base, fromAccountId: bBank, amount: -$(50), clientRequestId: rid() }), "TX_AMOUNT");
    await rejects(createTransfer(c.ctxA, { ...base, fromAccountId: card, clientRequestId: rid() }), "TRANSFER_FROM_CARD");
    await rejects(createTransfer(c.ctxA, { ...base, fromAccountId: bBank, amount: $(999999), clientRequestId: rid() }), "TRANSFER_OVER_BALANCE");
  });

  it("重複送出同一個請求不會產生兩筆金流", async () => {
    const id = rid();
    const input = { fromAccountId: bBank, toAccountId: c.accB, amount: $(1000), occurredOn: D(7), note: "", clientRequestId: id };
    const a = await createTransfer(c.ctxB, input);
    const b = await createTransfer(c.ctxB, input);
    assert.equal(a.id, b.id);
    assert.equal(await balance(bBank), $(14000));
    assert.equal(await balance(c.accB), $(1000));
  });

  it("基金指定的錢不能被轉走：共同帳戶 $35,000、指定 $20,000 → 只能轉 $15,000", async () => {
    trip = (await funds.createFund(c.ctxA, { name: "日本旅遊基金", targetAmount: $(50000), dueDate: null })).id;
    await funds.addFundEntry(c.ctxA, { fundId: trip, type: "DEPOSIT", amount: $(20000), userId: c.aId, accountId: c.joint, note: "", occurredOn: D(8), clientRequestId: rid() });
    const free = await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.joint);
    assert.deepEqual([free.balance, free.earmarked, free.free], [$(35000), $(20000), $(15000)]);

    await rejects(
      createTransfer(c.ctxA, { fromAccountId: c.joint, toAccountId: c.accA, amount: $(15001), occurredOn: D(8), note: "", clientRequestId: rid() }),
      "TRANSFER_OVER_FREE",
    );
    await createTransfer(c.ctxA, { fromAccountId: c.joint, toAccountId: c.accA, amount: $(15000), occurredOn: D(8), note: "", clientRequestId: rid() });
    assert.equal(await balance(c.joint), $(20000), "剩下的剛好是基金指定的金額");
    assert.equal((await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.joint)).free, 0);
    // 把錢轉回來，後面的測試才好算
    await createTransfer(c.ctxA, { fromAccountId: c.accA, toAccountId: c.joint, amount: $(15000), occurredOn: D(9), note: "", clientRequestId: rid() });
    assert.equal(await balance(c.joint), $(35000));
  });

  it("作廢轉帳：餘額恢復；但轉入的錢已經被指定給基金時不能作廢", async () => {
    const t = await createTransfer(c.ctxB, { fromAccountId: bBank, toAccountId: c.joint, amount: $(3000), occurredOn: D(10), note: "", clientRequestId: rid() });
    assert.equal(await balance(c.joint), $(38000));
    // 轉進來的錢馬上指定給基金 → 不能作廢
    await funds.addFundEntry(c.ctxA, { fundId: trip, type: "DEPOSIT", amount: $(18000), userId: c.aId, accountId: c.joint, note: "", occurredOn: D(10), clientRequestId: rid() });
    await rejects(ledger.deleteTransaction(c.ctxA, t.id), "TRANSFER_EARMARK_BACKING");
    assert.equal(await balance(c.joint), $(38000), "被擋下來時餘額不變");
    // 取回基金額度後就可以作廢，餘額恢復
    const entry = (await prisma.fundTransaction.findFirstOrThrow({ where: { fundId: trip, type: "DEPOSIT", amount: $(18000) } })).id;
    await funds.cancelFundEntry(c.ctxA, entry);
    await ledger.deleteTransaction(c.ctxA, t.id);
    assert.equal(await balance(c.joint), $(35000));
    assert.equal(await balance(bBank), $(14000));
    await ledger.deleteTransaction(c.ctxA, t.id); // 重複刪除不報錯
  });

  it("結算與期初餘額不能從記帳頁作廢；任務獎金入金要到基金頁取消", async () => {
    const opening = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "OPENING_BALANCE" } });
    await rejects(ledger.deleteTransaction(c.ctxA, opening.id), "TX_NOT_DELETABLE");
  });

  // ───────── 退款 ─────────

  it("退款是獨立紀錄，不會修改原始消費，並且正確增加退款帳戶", async () => {
    const before = await prisma.transaction.findUniqueOrThrow({ where: { id: meal }, include: { splits: true } });
    const cardBefore = await balance(card);
    const r = await createRefund(c.ctxA, { originalId: meal, amount: $(300), accountId: card, occurredOn: D(11), occurredTime: "14:05", note: "少送一份", clientRequestId: rid() });
    assert.equal(r.type, "REFUND");
    assert.equal(r.relatedId, meal);
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: meal }, include: { splits: true } });
    assert.equal(after.amount, $(1000), "原始消費金額不變");
    assert.deepEqual(after.splits.map((s) => s.amount).sort(), before.splits.map((s) => s.amount).sort(), "原始分帳不變");
    assert.equal(await balance(card), cardBefore + $(300), "退款回到刷卡的那張卡（未繳金額減少）");
  });

  it("退款依原始分帳比例回沖，欠款正確重算", async () => {
    // 王品 $1,000：小艾刷卡付，小艾負擔 $400、阿本負擔 $600 → 阿本欠小艾 $600
    // 退款 $300 進小艾的卡：小艾少負擔 $120、阿本少負擔 $180 → 阿本欠小艾 $420
    const r = await refundsOf(c.ctxA, meal);
    assert.equal(r.length, 1);
    const splits = Object.fromEntries(r[0].splits.map((s) => [s.userId, s.amount]));
    assert.equal(splits[c.aId], -$(120));
    assert.equal(splits[c.bId], -$(180));
    const net = await ledger.getBalances(c.ctxA);
    assert.equal(net.net.get(c.bId), -$(420));
    assert.equal(net.net.get(c.aId), $(420));
  });

  it("實際淨支出 = 支出 − 退款", async () => {
    const t = await totals({ from: D(5), to: D(11) });
    assert.equal(t.expense, $(1000));
    assert.equal(t.refund, $(300));
    assert.equal(t.netExpense, $(700));
    assert.equal(t.income, 0);
    // 搜尋結果看得到退款與轉帳
    const refunds = await searchTransactions(c.ctxA, parseFilter({ kind: "REFUND" }), {});
    assert.equal(refunds.items.length, 1);
    const transfers = await searchTransactions(c.ctxA, parseFilter({ kind: "TRANSFER" }), {});
    assert.ok(transfers.items.length >= 1);
    assert.equal(transfers.totals.netExpense, 0, "轉帳不算支出");
  });

  it("退款不能超過尚未退款的金額，多次退款正確累計", async () => {
    assert.equal(await refundedAmount(prisma, c.ctxA.book.id, meal), $(300));
    await rejects(
      createRefund(c.ctxA, { originalId: meal, amount: $(701), accountId: card, occurredOn: D(12), note: "", clientRequestId: rid() }),
      "REFUND_OVER_LIMIT",
    );
    await createRefund(c.ctxB, { originalId: meal, amount: $(200), accountId: card, occurredOn: D(12), note: "第二次", clientRequestId: rid() });
    assert.equal(await refundedAmount(prisma, c.ctxA.book.id, meal), $(500));
    const item = (await listRefundable(c.ctxA)).find((x) => x.id === meal)!;
    assert.deepEqual([item.amount, item.refunded, item.refundable], [$(1000), $(500), $(500)]);
    await createRefund(c.ctxA, { originalId: meal, amount: $(500), accountId: card, occurredOn: D(12), note: "退完", clientRequestId: rid() });
    await rejects(
      createRefund(c.ctxA, { originalId: meal, amount: $(1), accountId: card, occurredOn: D(12), note: "", clientRequestId: rid() }),
      "REFUND_FULLY_REFUNDED",
    );
    assert.equal((await listRefundable(c.ctxA)).some((x) => x.id === meal), false, "退完的消費不會出現在可退款清單");
    assert.equal(await balance(card), -$(1500) - $(1000) + $(1000), "全額退款後卡片未繳金額回到原本");
    assert.equal((await totals({ from: D(5), to: D(12) })).netExpense, 0);
  });

  it("有退款的消費：不能刪除、金額不能改成比已退款少、不能改成收入", async () => {
    await rejects(ledger.deleteTransaction(c.ctxA, meal), "TX_HAS_REFUND");
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: meal } });
    const edit = (over: Partial<Parameters<typeof ledger.updateTransaction>[3]>) =>
      ledger.updateTransaction(c.ctxA, meal, tx.version, {
        type: "EXPENSE", amount: $(1000), accountId: card, categoryId: null, title: "王品", note: "",
        occurredOn: D(5), split: { method: "AMOUNT", participants: [{ userId: c.aId, value: $(400) }, { userId: c.bId, value: $(600) }] },
        ...over,
      });
    await rejects(edit({ amount: $(900) }), "TX_HAS_REFUND");
    await rejects(edit({ type: "INCOME", split: { method: "FULL", participants: [{ userId: c.aId }] } }), "TX_HAS_REFUND");
    await edit({ amount: $(1200), title: "王品（加菜）", split: { method: "AMOUNT", participants: [{ userId: c.aId, value: $(400) }, { userId: c.bId, value: $(800) }] } }); // 改大可以
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: meal } })).amount, $(1200));
  });

  it("作廢退款後，可退款金額與實際淨支出都會恢復", async () => {
    const last = (await refundsOf(c.ctxA, meal))[0];
    await ledger.deleteTransaction(c.ctxA, last.id);
    assert.equal(await refundedAmount(prisma, c.ctxA.book.id, meal), $(1000) - last.amount);
    const item = (await listRefundable(c.ctxA)).find((x) => x.id === meal)!;
    assert.equal(item.refundable, $(1200) - item.refunded);
    assert.equal((await totals({ from: D(5), to: D(12) })).netExpense, $(1200) - item.refunded);
  });

  it("只有支出可以退款，找不到的原始消費會被擋", async () => {
    const income = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "INCOME" } });
    await rejects(createRefund(c.ctxA, { originalId: income.id, amount: $(10), accountId: c.joint, occurredOn: D(12), note: "", clientRequestId: rid() }), "REFUND_SOURCE_TYPE");
    await rejects(createRefund(c.ctxA, { originalId: "not-exist", amount: $(10), accountId: c.joint, occurredOn: D(12), note: "", clientRequestId: rid() }), "REFUND_SOURCE_NOT_FOUND");
  });

  // ───────── 權限與資料隔離 ─────────

  it("另一半可以查看與建立；另一個帳本完全看不到也動不了", async () => {
    // 阿本看得到共同帳本的轉帳與退款
    const seen = await searchTransactions(c.ctxB, parseFilter({ kind: "REFUND" }), {});
    assert.ok(seen.items.length > 0);
    assert.ok((await listRefundable(c.ctxB)).some((x) => x.id === meal));

    // 另一個帳本：看不到
    assert.equal((await searchTransactions(other.ctxA, parseFilter({}), { take: 100 })).items.length, 0);
    assert.equal((await listRefundable(other.ctxA)).length, 0);
    assert.equal((await refundsOf(other.ctxA, meal)).length, 0);
    // 不能拿別的帳本的紀錄退款、不能用別的帳本的帳戶當轉入／轉出
    await rejects(createRefund(other.ctxA, { originalId: meal, amount: $(10), accountId: other.accA, occurredOn: D(12), note: "", clientRequestId: rid() }), "REFUND_SOURCE_NOT_FOUND");
    await rejects(createRefund(c.ctxA, { originalId: meal, amount: $(10), accountId: other.accA, occurredOn: D(12), note: "", clientRequestId: rid() }), "REFUND_ACCOUNT");
    await rejects(createTransfer(other.ctxA, { fromAccountId: other.accA, toAccountId: c.joint, amount: $(10), occurredOn: D(12), note: "", clientRequestId: rid() }), "TRANSFER_ACCOUNT");
    await rejects(createTransfer(c.ctxA, { fromAccountId: other.accA, toAccountId: c.joint, amount: $(10), occurredOn: D(12), note: "", clientRequestId: rid() }), "TRANSFER_ACCOUNT");
    await rejects(ledger.deleteTransaction(other.ctxA, meal), "TX_NOT_FOUND");
  });
});
