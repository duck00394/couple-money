import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import { searchTransactions } from "../../src/server/services/search";
import { monthStats } from "../../src/server/services/stats";
import { parseFilter } from "../../src/server/domain/search";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
const NOW = new Date(`${D(15)}T12:00:00+08:00`);

describe("Phase 3-4 C：餘額調整", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;
  let bank = "";
  let card = "";
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const full = (userId: string) => ({ method: "FULL" as const, participants: [{ userId }] });
  const balance = async (accountId: string) =>
    (await ledger.getBalances(c.ctxA)).accounts.get(accountId) ?? 0;
  const adjust = (ctx: typeof c.ctxA, accountId: string, targetBalance: number, note = "") =>
    ledger.adjustAccountBalance(ctx, { accountId, targetBalance, note, occurredOn: D(15), clientRequestId: rid() });

  before(async () => {
    await reset();
    c = await setupCouple("adj");
    other = await setupCouple("oth");
    bank = (await ledger.createAccount(c.ctxA, { name: "小艾銀行", type: "BANK", shared: false, openingBalance: $(10000) })).id;
    card = (await ledger.createAccount(c.ctxA, { name: "玉山卡", type: "CREDIT_CARD", shared: false, openingBalance: -$(1500) })).id;
    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(30000), accountId: c.joint, categoryId: null, title: "薪水",
      note: "", occurredOn: D(1), split: full(c.aId), clientRequestId: rid(),
    });
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1000), accountId: bank, categoryId: null, title: "火鍋",
      note: "", occurredOn: D(5), split: eq(), clientRequestId: rid(),
    });
  });
  after(() => prisma.$disconnect());

  // ───────── 基本行為 ─────────

  it("往下調整：對帳發現少記 → 餘額變成填進去的數字，差額記成一筆 ADJUSTMENT", async () => {
    const before = await balance(bank); // 10000 − 1000 = 9000
    assert.equal(before, $(9000));
    const tx = await adjust(c.ctxA, bank, $(8800), "對帳發現少記了早餐");
    assert.equal(tx.type, "ADJUSTMENT");
    assert.equal(tx.amount, $(200), "amount 是差額的絕對值");
    assert.equal(await balance(bank), $(8800));
    const payments = await prisma.transactionPayment.findMany({ where: { transactionId: tx.id } });
    assert.equal(payments.length, 1);
    assert.equal(payments[0].amount, $(200), "餘額減少 → payment 為正");
    assert.equal(await prisma.transactionSplit.count({ where: { transactionId: tx.id } }), 0, "不該有分帳");
  });

  it("往上調整：餘額增加，且可以疊加", async () => {
    const tx = await adjust(c.ctxA, bank, $(9000), "找到漏記的退款");
    assert.equal(tx.amount, $(200));
    assert.equal(await balance(bank), $(9000));
    await adjust(c.ctxA, bank, $(9500));
    assert.equal(await balance(bank), $(9500));
    assert.equal(await prisma.transaction.count({ where: { type: "ADJUSTMENT", deletedAt: null } }), 3);
  });

  it("不修改任何歷史交易：原本的消費與期初餘額完全沒變", async () => {
    const rows = await prisma.transaction.findMany({
      where: { bookId: c.ctxA.book.id, type: { in: ["EXPENSE", "OPENING_BALANCE"] } },
      select: { amount: true, version: true, deletedAt: true, updatedAt: true, createdAt: true },
    });
    for (const r of rows) {
      assert.equal(r.version, 1, "歷史交易不該被改過");
      assert.equal(r.deletedAt, null);
      assert.equal(r.updatedAt.getTime(), r.createdAt.getTime(), "歷史交易不該被更新過");
    }
  });

  it("信用卡：調整的是「未繳金額」（總帳裡是負餘額）", async () => {
    assert.equal(await balance(card), -$(1500));
    await adjust(c.ctxA, card, -$(1800), "帳單比 App 多 300");
    assert.equal(await balance(card), -$(1800));
  });

  it("填的數字跟目前一樣會被擋下來", async () => {
    await rejects(adjust(c.ctxA, bank, await balance(bank)), "ADJUST_SAME");
  });

  it("金額超過上限或不是整數會被擋下來", async () => {
    await rejects(adjust(c.ctxA, bank, 2_000_000_001), "ADJUST_AMOUNT");
    await rejects(adjust(c.ctxA, bank, 1.5), "ADJUST_AMOUNT");
  });

  // ───────── 不影響既有財務語意 ─────────

  it("不算收支：首頁 monthSummary、搜尋 totals、/stats 都不受影響", async () => {
    const beforeSummary = await ledger.monthSummary(c.ctxA, NOW);
    const beforeStats = await monthStats(c.ctxA, MONTH);
    const beforeSearch = await searchTransactions(c.ctxA, parseFilter({ from: D(1), to: D(30) }), { take: 500 });
    await adjust(c.ctxA, bank, (await balance(bank)) + $(7777), "大額調整");
    const afterSummary = await ledger.monthSummary(c.ctxA, NOW);
    const afterStats = await monthStats(c.ctxA, MONTH);
    const afterSearch = await searchTransactions(c.ctxA, parseFilter({ from: D(1), to: D(30) }), { take: 500 });

    assert.deepEqual(
      { e: afterSummary.expense, i: afterSummary.income, s: afterSummary.myShare },
      { e: beforeSummary.expense, i: beforeSummary.income, s: beforeSummary.myShare },
      "首頁數字不可以被餘額調整影響",
    );
    assert.equal(afterStats.totals.netExpense, beforeStats.totals.netExpense);
    assert.equal(afterStats.totals.income, beforeStats.totals.income);
    assert.equal(afterStats.totals.transferAmount, beforeStats.totals.transferAmount, "調整不是轉帳");
    assert.deepEqual(afterStats.paid, beforeStats.paid, "調整不算任何人掏錢");
    assert.deepEqual(afterStats.borne, beforeStats.borne, "調整不算任何人負擔");
    assert.deepEqual(afterStats.categories, beforeStats.categories, "調整不會變成某個分類的消費");
    assert.equal(afterSearch.totals.netExpense, beforeSearch.totals.netExpense);
    assert.equal(afterSearch.totals.count, beforeSearch.totals.count + 1, "筆數照實算（與搜尋頁一致）");
    // 對帳①②在加了調整之後仍然成立
    assert.equal(afterStats.borne.me, afterSummary.myShare);
    assert.deepEqual(afterStats.totals, afterSearch.totals);
  });

  it("不產生欠款", async () => {
    const before = (await ledger.getBalances(c.ctxA)).net.get(c.aId) ?? 0;
    await adjust(c.ctxA, bank, (await balance(bank)) - $(1234));
    assert.equal((await ledger.getBalances(c.ctxA)).net.get(c.aId) ?? 0, before);
  });

  it("搜尋得到：類型「餘額調整」可以查出這些紀錄", async () => {
    const r = await searchTransactions(c.ctxA, parseFilter({ kind: "ADJUSTMENT" }), { take: 100 });
    assert.ok(r.items.length >= 5);
    assert.ok(r.items.every((t) => t.type === "ADJUSTMENT"));
    // 可以只看某個帳戶的調整
    const byAccount = await searchTransactions(c.ctxA, parseFilter({ kind: "ADJUSTMENT", account: card }), { take: 100 });
    assert.equal(byAccount.items.length, 1);
  });

  // ───────── 基金不變式 ─────────

  it("不能把已指定給基金的錢調掉", async () => {
    const fund = await funds.createFund(c.ctxA, { name: "旅遊", targetAmount: null, dueDate: null });
    await funds.addFundEntry(c.ctxA, {
      fundId: fund.id, type: "DEPOSIT", amount: $(20000), userId: c.aId, accountId: c.joint,
      note: "", occurredOn: D(10), clientRequestId: rid(),
    });
    const jointBalance = (await ledger.getBalances(c.ctxA)).accounts.get(c.joint) ?? 0;
    assert.ok(jointBalance >= $(20000));
    await rejects(adjust(c.ctxA, c.joint, $(19999)), "TRANSFER_EARMARK_BACKING");
    // 調到剛好等於已指定的金額是可以的
    await adjust(c.ctxA, c.joint, $(20000), "共同帳戶對帳");
    assert.equal((await ledger.getBalances(c.ctxA)).accounts.get(c.joint), $(20000));
  });

  // ───────── 權限 ─────────

  it("只能調整自己的帳戶或共同帳戶", async () => {
    await rejects(adjust(c.ctxB, bank, $(1)), "ADJUST_FORBIDDEN");
    // 共同帳戶兩個人都可以調
    const joint = (await ledger.getBalances(c.ctxA)).accounts.get(c.joint) ?? 0;
    await funds.cancelFundEntry(c.ctxA, (await prisma.fundTransaction.findFirstOrThrow({ where: { type: "DEPOSIT", deletedAt: null } })).id);
    await ledger.adjustAccountBalance(c.ctxB, {
      accountId: c.joint, targetBalance: joint + $(10), note: "阿本也能調共同帳戶", occurredOn: D(16), clientRequestId: rid(),
    });
    assert.equal((await ledger.getBalances(c.ctxA)).accounts.get(c.joint), joint + $(10));
  });

  it("跨帳本：別的帳本的帳戶調不動，也不會出現在對方的紀錄裡", async () => {
    await rejects(adjust(c.ctxA, other.accA, $(500)), "ADJUST_ACCOUNT");
    await rejects(adjust(c.ctxA, "id-does-not-exist", $(500)), "ADJUST_ACCOUNT");
    const theirs = await searchTransactions(other.ctxA, parseFilter({ kind: "ADJUSTMENT" }), { take: 100 });
    assert.equal(theirs.items.length, 0, "對方的帳本看不到我們的調整");
  });

  // ───────── 防重送與並發 ─────────

  it("同一個 clientRequestId 只會調整一次", async () => {
    const reqId = rid();
    const input = { accountId: bank, targetBalance: (await balance(bank)) + $(999), note: "", occurredOn: D(17), clientRequestId: reqId };
    const first = await ledger.adjustAccountBalance(c.ctxA, input);
    const second = await ledger.adjustAccountBalance(c.ctxA, input);
    assert.equal(first.id, second.id, "第二次回傳同一筆，不會調兩次");
    assert.equal(await prisma.transaction.count({ where: { clientRequestId: reqId, bookId: c.ctxA.book.id } }), 1);
  });

  it("兩支手機同時調整同一個帳戶：第二筆用第一筆之後的餘額，不會互相覆蓋", async () => {
    const start = await balance(bank);
    const results = await Promise.allSettled([
      ledger.adjustAccountBalance(c.ctxA, { accountId: bank, targetBalance: start + $(100), note: "A", occurredOn: D(18), clientRequestId: rid() }),
      ledger.adjustAccountBalance(c.ctxA, { accountId: bank, targetBalance: start + $(100), note: "B", occurredOn: D(18), clientRequestId: rid() }),
    ]);
    // 兩筆的目標相同：先到的建立調整，後到的會發現「已經是這個數字」而被擋下
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await balance(bank), start + $(100), "最終餘額剛好是目標值，不會被加兩次");
  });

  // ───────── 作廢（soft delete）─────────

  it("作廢調整：餘額回到調整前，紀錄仍然查得到（soft delete）", async () => {
    const start = await balance(bank);
    const tx = await adjust(c.ctxA, bank, start - $(500), "打錯了");
    assert.equal(await balance(bank), start - $(500));
    await ledger.cancelAdjustment(c.ctxA, tx.id);
    assert.equal(await balance(bank), start, "餘額恢復");
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.ok(row.deletedAt, "是 soft delete，資料還在");
    assert.equal(row.deletedById, c.aId);
    // 作廢後不會出現在搜尋結果
    const r = await searchTransactions(c.ctxA, parseFilter({ kind: "ADJUSTMENT" }), { take: 200 });
    assert.ok(!r.items.some((t) => t.id === tx.id));
    // 重複作廢不會報錯
    await ledger.cancelAdjustment(c.ctxA, tx.id);
  });

  it("只有餘額調整可以用這個方式作廢；期初餘額與一般消費不行", async () => {
    const opening = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "OPENING_BALANCE" } });
    await rejects(ledger.cancelAdjustment(c.ctxA, opening.id), "ADJUST_ONLY");
    const expense = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "EXPENSE" } });
    await rejects(ledger.cancelAdjustment(c.ctxA, expense.id), "ADJUST_ONLY");
    // 反過來：餘額調整不能用一般的刪除流程
    const adjustment = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "ADJUSTMENT", deletedAt: null } });
    await rejects(ledger.deleteTransaction(c.ctxA, adjustment.id), "TX_NOT_DELETABLE");
  });

  it("作廢別的帳本的調整會被擋下（回傳與不存在的 id 相同的錯誤）", async () => {
    const mine = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "ADJUSTMENT", deletedAt: null } });
    await rejects(ledger.cancelAdjustment(other.ctxA, mine.id), "TX_NOT_FOUND");
    await rejects(ledger.cancelAdjustment(other.ctxA, "id-does-not-exist"), "TX_NOT_FOUND");
  });

  it("作廢會讓基金指定金額失去依靠時，要被擋下來", async () => {
    const fund = await funds.createFund(c.ctxA, { name: "家電", targetAmount: null, dueDate: null });
    const free = await funds.accountFreeAmount(prisma, c.ctxA.book.id, bank);
    const up = await adjust(c.ctxA, bank, free.balance + $(3000), "先加一筆");
    await funds.addFundEntry(c.ctxA, {
      fundId: fund.id, type: "DEPOSIT", amount: free.free + $(3000), userId: c.aId, accountId: bank,
      note: "", occurredOn: D(19), clientRequestId: rid(),
    });
    await rejects(ledger.cancelAdjustment(c.ctxA, up.id), "TRANSFER_EARMARK_BACKING");
  });

  // ───────── 稽核 ─────────

  it("每一次調整與作廢都有稽核紀錄（誰、何時、從多少改成多少）", async () => {
    const start = await balance(bank);
    const tx = await adjust(c.ctxA, bank, start + $(60), "稽核測試");
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { bookId: c.ctxA.book.id, action: "ADJUST", entityType: "Account", entityId: bank },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(log.actorId, c.aId);
    assert.deepEqual(log.before, { balance: start });
    assert.deepEqual(log.after, { balance: start + $(60), delta: $(60), transactionId: tx.id });
    await ledger.cancelAdjustment(c.ctxA, tx.id);
    const del = await prisma.auditLog.findFirstOrThrow({
      where: { bookId: c.ctxA.book.id, action: "DELETE", entityType: "Transaction", entityId: tx.id },
    });
    assert.equal(del.actorId, c.aId);
  });

  // ───────── 唯讀成員 ─────────

  it("沒有編輯權限的人不能調整", async () => {
    const readOnly = { ...c.ctxA, canWrite: false };
    await rejects(
      ledger.adjustAccountBalance(readOnly, { accountId: bank, targetBalance: $(1), note: "", occurredOn: D(20), clientRequestId: rid() }),
      "BOOK_READ_ONLY",
    );
    const adjustment = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "ADJUSTMENT", deletedAt: null } });
    await rejects(ledger.cancelAdjustment(readOnly, adjustment.id), "BOOK_READ_ONLY");
  });
});
