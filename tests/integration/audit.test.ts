/**
 * Phase 3-4 前完整驗收：帳本隔離、財務不變式、並發、金額極端情況。
 * 這裡全部直接呼叫 service（不透過畫面），確保後端本身就擋得住。
 */
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as goals from "../../src/server/services/goals";
import * as tasks from "../../src/server/services/tasks";
import * as recurring from "../../src/server/services/recurring";
import * as deletes from "../../src/server/services/deleteRequests";
import { createRefund, createTransfer, listRefundable, refundedAmount } from "../../src/server/services/transfers";
import { searchTransactions, searchOptions } from "../../src/server/services/search";
import { parseFilter } from "../../src/server/domain/search";
import { MAX_AMOUNT } from "../../src/lib/money";
import type { SplitRule } from "../../src/server/domain/split";
import type { RecurringInput } from "../../src/server/services/recurring";
import type { TaskInput } from "../../src/server/services/tasks";

const D = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;
const fulfilled = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === "fulfilled").length;

describe("驗收 A：帳本隔離（Book 1 的資料，Book 2 完全碰不到）", () => {
  let us: Awaited<ReturnType<typeof setupCouple>>;
  let them: Awaited<ReturnType<typeof setupCouple>>;
  let txId = "";
  let transferId = "";
  let refundId = "";
  let recurringId = "";
  let fundId = "";
  let goalId = "";
  let taskId = "";

  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: us.aId }, { userId: us.bId }] });

  before(async () => {
    await reset();
    us = await setupCouple("bk1");
    them = await setupCouple("bk2");
    await ledger.createTransaction(us.ctxA, { type: "INCOME", amount: $(50000), accountId: us.joint, categoryId: null, title: "薪水", note: "", occurredOn: D(1), split: eq(), clientRequestId: rid() });
    txId = (await ledger.createTransaction(us.ctxA, { type: "EXPENSE", amount: $(1000), accountId: us.accA, categoryId: null, title: "晚餐", note: "", occurredOn: D(2), split: eq(), clientRequestId: rid() })).id;
    transferId = (await createTransfer(us.ctxA, { fromAccountId: us.joint, toAccountId: us.accA, amount: $(1000), occurredOn: D(3), note: "", clientRequestId: rid() })).id;
    refundId = (await createRefund(us.ctxA, { originalId: txId, amount: $(100), accountId: us.accA, occurredOn: D(4), note: "", clientRequestId: rid() })).id;
    fundId = (await funds.createFund(us.ctxA, { name: "旅遊基金", targetAmount: $(10000), dueDate: null })).id;
    goalId = (await goals.createGoal(us.ctxA, { name: "日本行", description: "", emoji: "", targetAmount: $(10000), startDate: D(1), deadline: null, fundId, isActive: true })).id;
    taskId = (await tasks.createTask(us.ctxA, {
      title: "英文", description: "", emoji: "book", scope: "PERSONAL", assigneeId: us.aId, frequency: "DAILY", daysOfWeek: 127,
      requiresApproval: false, requiresPhoto: false, rewardAmount: $(50), fundId, penaltyAmount: 0, penaltyText: "", isActive: true, milestones: [],
    } satisfies TaskInput, D(5))).id;
    recurringId = (await recurring.createRecurring(us.ctxA, {
      name: "房租", note: "", amount: $(15500), categoryId: null, accountId: us.accA, split: eq(),
      frequency: "MONTHLY", dayOfWeek: null, dayOfMonth: 1, month: null, startDate: D(1), endDate: null,
    } satisfies RecurringInput, D(10))).id;
  });
  after(() => prisma.$disconnect());

  it("讀取：交易、帳戶、搜尋、退款清單、固定支出、基金、目標、任務都看不到", async () => {
    assert.equal(await ledger.getTransaction(them.ctxA, txId), null);
    assert.equal(await ledger.getTransaction(them.ctxA, transferId), null);
    assert.equal(await ledger.getTransaction(them.ctxA, refundId), null);
    assert.equal((await searchTransactions(them.ctxA, parseFilter({}), { take: 100 })).items.length, 0);
    assert.equal((await ledger.listAccounts(them.ctxA)).some((a) => a.id === us.accA || a.id === us.joint), false);
    assert.equal((await ledger.listSettlements(them.ctxA)).length, 0);
    assert.equal((await listRefundable(them.ctxA)).length, 0);
    assert.equal((await listRefundable(them.ctxA, { includeId: txId })).length, 0, "includeId 也不能把別的帳本的消費撈進來");
    assert.equal(await recurring.getRecurring(them.ctxA, recurringId), null);
    assert.equal((await recurring.listRecurring(them.ctxA)).length, 0);
    assert.equal((await recurring.pendingRecurring(them.ctxA)).length, 0);
    assert.equal(await funds.getFundDetail(them.ctxA, fundId), null);
    assert.equal(await goals.getGoal(them.ctxA, goalId), null);
    assert.equal(await tasks.getTaskDetail(them.ctxA, taskId), null);
    // 篩選選項也只會有自己帳本的東西
    const opts = await searchOptions(them.ctxA);
    assert.equal(opts.accounts.some((a) => a.id === us.accA), false);
    assert.equal(opts.funds.length, 0);
  });

  it("寫入：改不了、刪不了、退不了、轉不了、產生不了", async () => {
    const eqThem = { method: "EQUAL" as const, participants: [{ userId: them.aId }, { userId: them.bId }] };
    // 交易
    await rejects(ledger.updateTransaction(them.ctxA, txId, 1, { type: "EXPENSE", amount: $(1), accountId: them.accA, categoryId: null, title: "x", note: "", occurredOn: D(2), split: eqThem }), "TX_NOT_FOUND");
    await rejects(ledger.deleteTransaction(them.ctxA, txId), "TX_NOT_FOUND");
    await rejects(ledger.deleteTransaction(them.ctxA, transferId), "TX_NOT_FOUND");
    // 帳戶：不能拿別的帳本的帳戶記帳、不能改它
    await rejects(ledger.createTransaction(them.ctxA, { type: "EXPENSE", amount: $(1), accountId: us.accA, categoryId: null, title: "x", note: "", occurredOn: D(2), split: eqThem, clientRequestId: rid() }), "TX_ACCOUNT");
    await rejects(ledger.updateAccount(them.ctxA, us.accA, { name: "偷改" }), "ACCOUNT_NOT_FOUND");
    // 退款與轉帳
    await rejects(createRefund(them.ctxA, { originalId: txId, amount: $(1), accountId: them.accA, occurredOn: D(5), note: "", clientRequestId: rid() }), "REFUND_SOURCE_NOT_FOUND");
    await rejects(createRefund(us.ctxA, { originalId: txId, amount: $(1), accountId: them.accA, occurredOn: D(5), note: "", clientRequestId: rid() }), "REFUND_ACCOUNT");
    await rejects(createTransfer(them.ctxA, { fromAccountId: us.joint, toAccountId: them.accA, amount: $(1), occurredOn: D(5), note: "", clientRequestId: rid() }), "TRANSFER_ACCOUNT");
    await rejects(createTransfer(us.ctxA, { fromAccountId: us.joint, toAccountId: them.accA, amount: $(1), occurredOn: D(5), note: "", clientRequestId: rid() }), "TRANSFER_ACCOUNT");
    // 結算：不能把不是帳本成員的人塞進來
    await rejects(ledger.settle(us.ctxA, { fromUserId: them.aId, toUserId: us.aId, amount: $(1), fromAccountId: them.accA, toAccountId: us.accA, note: "", clientRequestId: rid() }), "SETTLE_MEMBER");
    // 固定支出
    const rec: RecurringInput = { name: "x", note: "", amount: $(1), categoryId: null, accountId: them.accA, split: eqThem, frequency: "MONTHLY", dayOfWeek: null, dayOfMonth: 1, month: null, startDate: D(1), endDate: null };
    await rejects(recurring.updateRecurring(them.ctxA, recurringId, rec, D(10)), "RECURRING_NOT_FOUND");
    await rejects(recurring.setRecurringActive(them.ctxA, recurringId, false, D(10)), "RECURRING_NOT_FOUND");
    await rejects(recurring.deleteRecurring(them.ctxA, recurringId), "RECURRING_NOT_FOUND");
    await rejects(recurring.generateRecurring(them.ctxA, recurringId, { today: D(30) }), "RECURRING_NOT_FOUND");
    await rejects(recurring.createRecurring(them.ctxA, { ...rec, accountId: us.accA }, D(10)), "RECURRING_ACCOUNT");
    // 基金、目標、任務、刪除申請
    await rejects(funds.addFundEntry(them.ctxA, { fundId, type: "DEPOSIT", amount: $(1), userId: them.aId, accountId: them.accA, note: "", occurredOn: D(5), clientRequestId: rid() }), "FUND_NOT_FOUND");
    await rejects(goals.setGoalAchieved(them.ctxA, goalId, true), "GOAL_NOT_FOUND");
    await rejects(tasks.checkIn(them.ctxA, taskId, { today: D(11) }), "TASK_NOT_FOUND");
    await rejects(tasks.deleteTask(them.ctxA, taskId), "TASK_NOT_FOUND");
    await rejects(deletes.requestDelete(them.ctxA, "FUND", fundId), "FUND_NOT_FOUND");
  });

  it("寫入被擋之後，Book 1 的資料完全沒有被動到", async () => {
    const tx = await ledger.getTransaction(us.ctxA, txId);
    assert.equal(tx?.amount, $(1000));
    assert.equal((await ledger.listAccounts(us.ctxA)).find((a) => a.id === us.accA)?.name, "現金");
    assert.equal(await refundedAmount(prisma, us.ctxA.book.id, txId), $(100));
    assert.equal((await recurring.listRecurring(us.ctxA, D(10))).length, 1);
    assert.equal((await searchTransactions(us.ctxA, parseFilter({}), { take: 100 })).items.length, 4);
  });

  it("錯誤訊息不會洩漏「這個 id 是否存在」（跨帳本與不存在的 id 回一樣的錯）", async () => {
    const same = async (fn: (id: string) => Promise<unknown>) => {
      const a = await fn(txId).then(() => "OK", (e: Error & { code?: string }) => `${e.code}:${e.message}`);
      const b = await fn("id-does-not-exist").then(() => "OK", (e: Error & { code?: string }) => `${e.code}:${e.message}`);
      assert.equal(a, b);
      assert.notEqual(a, "OK");
    };
    await same((id) => ledger.deleteTransaction(them.ctxA, id));
    await same((id) => createRefund(them.ctxA, { originalId: id, amount: $(1), accountId: them.accA, occurredOn: D(5), note: "", clientRequestId: rid() }));
    await same((id) => recurring.generateRecurring(them.ctxA, id, { today: D(30) }));
    await same((id) => tasks.deleteTask(them.ctxA, id));
    // 讀取也一樣：跨帳本與不存在都回 null，不會多透露什麼
    assert.equal(await ledger.getTransaction(them.ctxA, txId), await ledger.getTransaction(them.ctxA, "nope"));
    assert.equal(await recurring.getRecurring(them.ctxA, recurringId), await recurring.getRecurring(them.ctxA, "nope"));
  });

  it("同帳本的另一半可以正常使用同一批資料", async () => {
    assert.ok(await ledger.getTransaction(us.ctxB, txId));
    assert.equal((await searchTransactions(us.ctxB, parseFilter({}), { take: 100 })).items.length, 4);
    assert.ok((await recurring.listRecurring(us.ctxB, D(10))).some((r) => r.id === recurringId));
    assert.ok((await listRefundable(us.ctxB)).some((r) => r.id === txId));
  });
});

describe("驗收 B：財務不變式", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const balance = async (id: string) => (await ledger.listAccounts(c.ctxA)).find((a) => a.id === id)!.balance;
  const free = async (id: string) => (await funds.accountFreeAmount(prisma, c.ctxA.book.id, id)).free;

  before(async () => {
    await reset();
    c = await setupCouple("inv");
  });
  after(() => prisma.$disconnect());

  it("基金指定的錢不能被一般支出花掉，也不能靠刪收入抽走", async () => {
    await ledger.createTransaction(c.ctxA, { type: "INCOME", amount: $(1000), accountId: c.joint, categoryId: null, title: "收入", note: "", occurredOn: D(1), split: eq(), clientRequestId: rid() });
    const fund = await funds.createFund(c.ctxA, { name: "基金", targetAmount: null, dueDate: null });
    await funds.addFundEntry(c.ctxA, { fundId: fund.id, type: "DEPOSIT", amount: $(1000), userId: c.aId, accountId: c.joint, note: "", occurredOn: D(2), clientRequestId: rid() });
    assert.equal(await free(c.joint), 0);

    // 1) 一般支出不能動用基金指定的錢
    await rejects(
      ledger.createTransaction(c.ctxA, { type: "EXPENSE", amount: $(300), accountId: c.joint, categoryId: null, title: "日用品", note: "", occurredOn: D(3), split: eq(), clientRequestId: rid() }),
      "TRANSFER_EARMARK_BACKING",
    );
    assert.equal(await balance(c.joint), $(1000), "被擋下來時餘額不變");

    // 2) 基金支出可以（同時扣掉基金額度，指定金額仍有實際的錢對應）
    const fundExpense = await ledger.createTransaction(c.ctxA, { type: "EXPENSE", amount: $(300), accountId: c.joint, categoryId: null, title: "機票", note: "", occurredOn: D(3), split: eq(), clientRequestId: rid(), fundId: fund.id, fundAccountId: c.joint });
    assert.equal(await balance(c.joint), $(700));
    assert.equal(await free(c.joint), 0);
    assert.equal((await funds.fundBalances(prisma, c.ctxA.book.id, [fund.id])).get(fund.id), $(700));

    // 3) 刪掉當初那筆收入會讓帳戶少於基金指定金額 → 擋下來
    const income = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "INCOME" } });
    await rejects(ledger.deleteTransaction(c.ctxA, income.id), "TRANSFER_EARMARK_BACKING");
    assert.equal(await balance(c.joint), $(700));

    // 4) 把基金支出刪掉會還原基金額度，帳戶餘額也回來
    await ledger.deleteTransaction(c.ctxA, fundExpense.id);
    assert.equal(await balance(c.joint), $(1000));
    assert.equal((await funds.fundBalances(prisma, c.ctxA.book.id, [fund.id])).get(fund.id), $(1000));
  });

  it("刪除任務會一起收回尚未入金的獎金與尚未抵扣的懲罰，基金才不會卡住", async () => {
    const fund = await funds.createFund(c.ctxA, { name: "任務基金", targetAmount: null, dueDate: null });
    const task = await tasks.createTask(c.ctxA, {
      title: "運動", description: "", emoji: "run", scope: "PERSONAL", assigneeId: c.aId, frequency: "DAILY", daysOfWeek: 127,
      requiresApproval: false, requiresPhoto: false, rewardAmount: $(50), fundId: fund.id, penaltyAmount: $(20), penaltyText: "", isActive: true, milestones: [],
    } satisfies TaskInput, D(10));
    await tasks.checkIn(c.ctxA, task.id, { today: D(10) });
    assert.equal((await funds.pendingByFund(prisma, c.ctxA.book.id, [fund.id])).get(fund.id)?.rewards, $(50));

    await tasks.deleteTask(c.ctxA, task.id);
    const pending = (await funds.pendingByFund(prisma, c.ctxA.book.id, [fund.id])).get(fund.id);
    assert.equal(pending?.rewards ?? 0, 0, "刪掉任務後不該還有尚未入金的獎金");
    assert.equal(pending?.penalties ?? 0, 0);
    await assert.doesNotReject(funds.assertFundDeletable(prisma, c.ctxA, fund.id), "基金應該可以刪除");
    assert.equal((await tasks.recentPenalties(c.ctxA)).some((p) => p.taskId === task.id), false, "已刪除任務的懲罰不再出現在列表");
  });

  it("任務獎金在入金前不是現金：不影響帳戶、不影響實際基金金額", async () => {
    const fund = await funds.createFund(c.ctxA, { name: "獎金基金", targetAmount: null, dueDate: null });
    const task = await tasks.createTask(c.ctxA, {
      title: "早起", description: "", emoji: "sparkles", scope: "PERSONAL", assigneeId: c.aId, frequency: "DAILY", daysOfWeek: 127,
      requiresApproval: false, requiresPhoto: false, rewardAmount: $(30), fundId: fund.id, penaltyAmount: 0, penaltyText: "", isActive: true, milestones: [],
    } satisfies TaskInput, D(12));
    await ledger.createTransaction(c.ctxA, { type: "INCOME", amount: $(5000), accountId: c.joint, categoryId: null, title: "共同收入", note: "", occurredOn: D(11), split: eq(), clientRequestId: rid() });
    const accBefore = await balance(c.accA);
    const jointBefore = await balance(c.joint);
    await tasks.checkIn(c.ctxA, task.id, { today: D(12) });
    assert.equal(await balance(c.accA), accBefore, "獎金不會直接進帳戶");
    assert.equal(await balance(c.joint), jointBefore);
    assert.equal((await funds.fundBalances(prisma, c.ctxA.book.id, [fund.id])).get(fund.id) ?? 0, 0, "尚未入金 → 實際基金金額還是 0");
    assert.equal((await funds.pendingByFund(prisma, c.ctxA.book.id, [fund.id])).get(fund.id)?.rewards, $(30));
    // 入金才會變成實際金額（從共同帳戶指定）
    await funds.depositRewards(c.ctxA, { fundId: fund.id, targetAccountId: c.joint, sourceAccountId: null, note: "", occurredOn: D(12), clientRequestId: rid() });
    assert.equal((await funds.fundBalances(prisma, c.ctxA.book.id, [fund.id])).get(fund.id), $(30));
    assert.equal(await balance(c.joint), jointBefore, "入金只是指定用途，帳戶餘額不變");
  });

  it("獎金入金不能從信用卡轉出", async () => {
    const card = await ledger.createAccount(c.ctxA, { name: "溢繳卡", type: "CREDIT_CARD", shared: false, openingBalance: $(2000) });
    const fund = await funds.createFund(c.ctxA, { name: "卡片基金", targetAmount: null, dueDate: null });
    const task = await tasks.createTask(c.ctxA, {
      title: "閱讀", description: "", emoji: "book", scope: "PERSONAL", assigneeId: c.aId, frequency: "DAILY", daysOfWeek: 127,
      requiresApproval: false, requiresPhoto: false, rewardAmount: $(10), fundId: fund.id, penaltyAmount: 0, penaltyText: "", isActive: true, milestones: [],
    } satisfies TaskInput, D(13));
    await tasks.checkIn(c.ctxA, task.id, { today: D(13) });
    await rejects(
      funds.depositRewards(c.ctxA, { fundId: fund.id, targetAccountId: c.joint, sourceAccountId: card.id, note: "", occurredOn: D(13), clientRequestId: rid() }),
      "TRANSFER_FROM_CARD",
    );
  });

  it("信用卡：刷卡增加未繳、繳卡費是轉帳（不會重複算成支出）", async () => {
    const card = await ledger.createAccount(c.ctxA, { name: "刷卡", type: "CREDIT_CARD", shared: false, openingBalance: 0 });
    await ledger.createTransaction(c.ctxA, { type: "INCOME", amount: $(3000), accountId: c.joint, categoryId: null, title: "繳卡費的錢", note: "", occurredOn: D(13), split: eq(), clientRequestId: rid() });
    await ledger.createTransaction(c.ctxA, { type: "EXPENSE", amount: $(1200), accountId: card.id, categoryId: null, title: "家電", note: "", occurredOn: D(14), split: eq(), clientRequestId: rid() });
    assert.equal(await balance(card.id), -$(1200), "未繳 $1,200");
    const before = (await searchTransactions(c.ctxA, parseFilter({ from: D(14), to: D(15) }), { take: 100 })).totals;
    await createTransfer(c.ctxA, { fromAccountId: c.joint, toAccountId: card.id, amount: $(1200), occurredOn: D(15), note: "繳卡費", clientRequestId: rid() });
    assert.equal(await balance(card.id), 0, "繳完卡費未繳歸零");
    const after = (await searchTransactions(c.ctxA, parseFilter({ from: D(14), to: D(15) }), { take: 100 })).totals;
    assert.equal(after.expense, before.expense, "繳卡費不會再算一次支出");
    assert.equal(after.transferCount, before.transferCount + 1);
  });

  it("帳戶餘額、欠款、搜尋統計三邊一致（由交易計算，沒有任何餘額欄位）", async () => {
    const all = await searchTransactions(c.ctxA, parseFilter({}), { take: 500 });
    const balances = (await ledger.getBalances(c.ctxA)).accounts;
    // 由 payment 自行加總一次，和 service 的結果比對
    const rows = await prisma.transactionPayment.findMany({
      where: { transaction: { bookId: c.ctxA.book.id, deletedAt: null, status: "POSTED" } },
      select: { accountId: true, amount: true },
    });
    const mine = new Map<string, number>();
    for (const r of rows) mine.set(r.accountId, (mine.get(r.accountId) ?? 0) - r.amount);
    for (const [id, v] of mine) assert.equal(balances.get(id), v, `帳戶 ${id} 餘額`);
    // 欠款 = Σ(payment) − Σ(split)，且兩人加總為 0
    const net = (await ledger.getBalances(c.ctxA)).net;
    assert.equal((net.get(c.aId) ?? 0) + (net.get(c.bId) ?? 0), 0, "兩人淨額相加恆為 0");
    // 搜尋統計：實際淨支出 = 支出 − 退款
    assert.equal(all.totals.netExpense, all.totals.expense - all.totals.refund);
  });
});

describe("驗收 C：並發（兩支手機同時操作）", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const balance = async (id: string) => (await ledger.listAccounts(c.ctxA)).find((a) => a.id === id)!.balance;

  before(async () => {
    await reset();
    c = await setupCouple("cc");
    await ledger.createTransaction(c.ctxA, { type: "INCOME", amount: $(100000), accountId: c.joint, categoryId: null, title: "本金", note: "", occurredOn: D(1), split: eq(), clientRequestId: rid() });
    await ledger.createTransaction(c.ctxA, { type: "INCOME", amount: $(20000), accountId: c.accA, categoryId: null, title: "小艾本金", note: "", occurredOn: D(1), split: { method: "FULL", participants: [{ userId: c.aId }] }, clientRequestId: rid() });
  });
  after(() => prisma.$disconnect());

  it("同時修改同一筆交易：一個成功、一個被版本擋下（不會 lost update）", async () => {
    const tx = await ledger.createTransaction(c.ctxA, { type: "EXPENSE", amount: $(500), accountId: c.accA, categoryId: null, title: "原本", note: "", occurredOn: D(2), split: eq(), clientRequestId: rid() });
    const input = (title: string, amount: number) => ({ type: "EXPENSE" as const, amount, accountId: c.accA, categoryId: null, title, note: "", occurredOn: D(2), split: eq() });
    const rs = await Promise.allSettled([
      ledger.updateTransaction(c.ctxA, tx.id, tx.version, input("小艾改的", $(600))),
      ledger.updateTransaction(c.ctxB, tx.id, tx.version, input("阿本改的", $(700))),
    ]);
    assert.equal(fulfilled(rs), 1, "只有一個成功");
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(after.version, 2, "版本只會 +1");
    assert.ok(["小艾改的", "阿本改的"].includes(after.title!));
    assert.equal(await prisma.transactionPayment.count({ where: { transactionId: tx.id } }), 1, "不會留下重複的金流列");
  });

  it("同時刪除同一筆交易：不會重複扣、餘額只恢復一次", async () => {
    const tx = await ledger.createTransaction(c.ctxA, { type: "EXPENSE", amount: $(300), accountId: c.accA, categoryId: null, title: "要刪的", note: "", occurredOn: D(3), split: eq(), clientRequestId: rid() });
    const before = await balance(c.accA);
    await Promise.allSettled([ledger.deleteTransaction(c.ctxA, tx.id), ledger.deleteTransaction(c.ctxB, tx.id)]);
    assert.equal(await balance(c.accA), before + $(300));
    assert.equal(await prisma.transaction.count({ where: { id: tx.id, deletedAt: null } }), 0);
  });

  it("同時結算：加起來不會超過欠款", async () => {
    const debt = (await ledger.getBalances(c.ctxA)).debts[0];
    assert.ok(debt && debt.amount > 0, "要有欠款才測得到");
    const half = Math.floor(debt.amount / 2) + $(1); // 兩筆加起來會超過
    const rs = await Promise.allSettled([
      ledger.settle(c.ctxA, { fromUserId: debt.from, toUserId: debt.to, amount: debt.amount, fromAccountId: debt.from === c.aId ? c.accA : c.accB, toAccountId: debt.to === c.aId ? c.accA : c.accB, note: "", clientRequestId: rid() }),
      ledger.settle(c.ctxB, { fromUserId: debt.from, toUserId: debt.to, amount: half, fromAccountId: debt.from === c.aId ? c.accA : c.accB, toAccountId: debt.to === c.aId ? c.accA : c.accB, note: "", clientRequestId: rid() }),
    ]);
    assert.equal(fulfilled(rs), 1, "第二筆會超過欠款，必須被擋");
    // 誰先搶到鎖不一定，但「成功的那一筆」與「剩下的欠款」一定要對得起來
    const paid = rs[0].status === "fulfilled" ? debt.amount : half;
    const after = await ledger.getBalances(c.ctxA);
    assert.equal(Math.abs(after.net.get(c.aId) ?? 0), debt.amount - paid, "剩下的欠款剛好是沒被結算掉的部分");
    assert.equal(after.debts.reduce((a, d) => a + d.amount, 0), debt.amount - paid, "兩筆加起來不會超過欠款");
  });

  it("同時轉帳：可自由使用的錢不會被轉出兩次", async () => {
    const cash = await ledger.createAccount(c.ctxA, { name: "零用金", type: "CASH", shared: false, openingBalance: $(1000) });
    const rs = await Promise.allSettled([
      createTransfer(c.ctxA, { fromAccountId: cash.id, toAccountId: c.joint, amount: $(1000), occurredOn: D(4), note: "", clientRequestId: rid() }),
      createTransfer(c.ctxB, { fromAccountId: cash.id, toAccountId: c.joint, amount: $(1000), occurredOn: D(4), note: "", clientRequestId: rid() }),
    ]);
    assert.equal(fulfilled(rs), 1);
    assert.equal(await balance(cash.id), 0, "不會變成負的");
  });

  it("同時退款：總退款不會超過原始消費", async () => {
    const tx = await ledger.createTransaction(c.ctxA, { type: "EXPENSE", amount: $(1000), accountId: c.accA, categoryId: null, title: "退款測試", note: "", occurredOn: D(5), split: eq(), clientRequestId: rid() });
    const rs = await Promise.allSettled([
      createRefund(c.ctxA, { originalId: tx.id, amount: $(700), accountId: c.accA, occurredOn: D(6), note: "", clientRequestId: rid() }),
      createRefund(c.ctxB, { originalId: tx.id, amount: $(700), accountId: c.accB, occurredOn: D(6), note: "", clientRequestId: rid() }),
    ]);
    assert.equal(fulfilled(rs), 1, "兩筆各 $700 不可能同時成立");
    assert.equal(await refundedAmount(prisma, c.ctxA.book.id, tx.id), $(700));
  });

  it("同時投入基金：不會超過帳戶可自由使用的金額", async () => {
    const fund = await funds.createFund(c.ctxA, { name: "並發基金", targetAmount: null, dueDate: null });
    const freeNow = (await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.joint)).free;
    const rs = await Promise.allSettled([
      funds.addFundEntry(c.ctxA, { fundId: fund.id, type: "DEPOSIT", amount: freeNow, userId: c.aId, accountId: c.joint, note: "", occurredOn: D(7), clientRequestId: rid() }),
      funds.addFundEntry(c.ctxB, { fundId: fund.id, type: "DEPOSIT", amount: freeNow, userId: c.bId, accountId: c.joint, note: "", occurredOn: D(7), clientRequestId: rid() }),
    ]);
    assert.equal(fulfilled(rs), 1);
    assert.ok((await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.joint)).free >= 0, "可自由使用不會變負");
    // 收尾：取回，避免影響後面的測試
    const entry = await prisma.fundTransaction.findFirstOrThrow({ where: { fundId: fund.id, type: "DEPOSIT", deletedAt: null } });
    await funds.cancelFundEntry(c.ctxA, entry.id);
  });

  it("同時修改同一個基金：第二個會被樂觀鎖擋下（不會蓋掉對方）", async () => {
    const fund = await funds.createFund(c.ctxA, { name: "編輯基金", targetAmount: null, dueDate: null });
    const version = (await prisma.fund.findUniqueOrThrow({ where: { id: fund.id } })).updatedAt.toISOString();
    const rs = await Promise.allSettled([
      funds.updateFund(c.ctxA, fund.id, { name: "小艾命名", emoji: "piggy-bank", targetAmount: null, dueDate: null, isArchived: false }, version),
      funds.updateFund(c.ctxB, fund.id, { name: "阿本命名", emoji: "piggy-bank", targetAmount: null, dueDate: null, isArchived: false }, version),
    ]);
    assert.equal(fulfilled(rs), 1, "帶著同一個版本送出，只有第一個能成功");
  });

  it("同時打卡同一個共同任務：只會有一筆打卡與一筆獎金", async () => {
    const fund = await funds.createFund(c.ctxA, { name: "共同任務基金", targetAmount: null, dueDate: null });
    const task = await tasks.createTask(c.ctxA, {
      title: "一起運動", description: "", emoji: "run", scope: "SHARED", assigneeId: null, frequency: "DAILY", daysOfWeek: 127,
      requiresApproval: false, requiresPhoto: false, rewardAmount: $(40), fundId: fund.id, penaltyAmount: 0, penaltyText: "", isActive: true, milestones: [],
    } satisfies TaskInput, D(8));
    const rs = await Promise.allSettled([
      tasks.checkIn(c.ctxA, task.id, { today: D(8) }),
      tasks.checkIn(c.ctxB, task.id, { today: D(8) }),
    ]);
    assert.equal(fulfilled(rs), 1, "共同任務同一天只算一次");
    assert.equal(await prisma.checkIn.count({ where: { taskId: task.id, status: { in: ["APPROVED", "PENDING"] } } }), 1);
    assert.equal((await funds.pendingByFund(prisma, c.ctxA.book.id, [fund.id])).get(fund.id)?.rewards, $(40), "獎金只發一次");
  });

  it("同時處理刪除申請：只會被同意一次", async () => {
    const fund = await funds.createFund(c.ctxA, { name: "要刪的基金", targetAmount: null, dueDate: null });
    const req = await deletes.requestDelete(c.ctxA, "FUND", fund.id);
    assert.ok(req.request, "兩人帳本要先送出申請");
    const rs = await Promise.allSettled([
      deletes.decideDelete(c.ctxB, req.request!.id, "APPROVE"),
      deletes.decideDelete(c.ctxB, req.request!.id, "APPROVE"),
    ]);
    assert.equal(fulfilled(rs), 1);
    assert.equal(await prisma.fund.count({ where: { id: fund.id, deletedAt: null } }), 0);
  });

  it("同時產生同一期固定支出：只會有一筆交易", async () => {
    const r = await recurring.createRecurring(c.ctxA, {
      name: "網路費", note: "", amount: $(899), categoryId: null, accountId: c.accA, split: eq(),
      frequency: "MONTHLY", dayOfWeek: null, dayOfMonth: 20, month: null, startDate: D(1), endDate: null,
    } satisfies RecurringInput, D(19));
    const rs = await Promise.allSettled([
      recurring.generateRecurring(c.ctxA, r.id, { today: D(20), expectedDueDate: D(20) }),
      recurring.generateRecurring(c.ctxB, r.id, { today: D(20), expectedDueDate: D(20) }),
    ]);
    assert.equal(fulfilled(rs), 1);
    assert.equal(await prisma.transaction.count({ where: { recurringExpenseId: r.id, deletedAt: null } }), 1);
  });
});

describe("驗收 D：金額與日期的極端情況", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const expense = (amount: number, split: SplitRule = eq(), accountId?: string) =>
    ledger.createTransaction(c.ctxA, { type: "EXPENSE", amount, accountId: accountId ?? c.accA, categoryId: null, title: "測試", note: "", occurredOn: D(2), split, clientRequestId: rid() });

  before(async () => {
    await reset();
    c = await setupCouple("edge");
    await ledger.createTransaction(c.ctxA, { type: "INCOME", amount: $(50000), accountId: c.accA, categoryId: null, title: "本金", note: "", occurredOn: D(1), split: { method: "FULL", participants: [{ userId: c.aId }] }, clientRequestId: rid() });
  });
  after(() => prisma.$disconnect());

  it("金額：0、負數、超過上限、非整數都被擋；小數點兩位可以", async () => {
    await rejects(expense(0), "TX_AMOUNT");
    await rejects(expense(-$(100)), "TX_AMOUNT");
    await rejects(expense(MAX_AMOUNT + 1), "TX_AMOUNT");
    await rejects(expense(10.5), "TX_AMOUNT");
    const cents = await expense(1250); // $12.50
    assert.equal(cents.amount, 1250);
    const splits = await prisma.transactionSplit.findMany({ where: { transactionId: cents.id } });
    assert.equal(splits.reduce((a, s) => a + s.amount, 0), 1250);
  });

  it("除不盡的分帳：平分奇數、比例除不盡，加總都等於總金額", async () => {
    const odd = await expense(999); // $9.99 平分
    const oddSplits = await prisma.transactionSplit.findMany({ where: { transactionId: odd.id }, orderBy: { amount: "desc" } });
    assert.equal(oddSplits.reduce((a, s) => a + s.amount, 0), 999);
    assert.deepEqual(oddSplits.map((s) => s.amount), [500, 499]);

    const ratio = await expense($(1000), { method: "RATIO", participants: [{ userId: c.aId, value: 33.33 }, { userId: c.bId, value: 66.67 }] });
    const rs = await prisma.transactionSplit.findMany({ where: { transactionId: ratio.id } });
    assert.equal(rs.reduce((a, s) => a + s.amount, 0), $(1000));
  });

  it("自訂金額：剛好等於總額可以、超過或不足會被擋", async () => {
    await assert.doesNotReject(expense($(100), { method: "AMOUNT", participants: [{ userId: c.aId, value: $(40) }, { userId: c.bId, value: $(60) }] }));
    await rejects(expense($(100), { method: "AMOUNT", participants: [{ userId: c.aId, value: $(70) }, { userId: c.bId, value: $(60) }] }), "SPLIT_AMOUNT_SUM");
    await rejects(expense($(100), { method: "AMOUNT", participants: [{ userId: c.aId, value: $(10) }, { userId: c.bId, value: $(10) }] }), "SPLIT_AMOUNT_SUM");
    await rejects(expense($(100), { method: "RATIO", participants: [{ userId: c.aId, value: 30 }, { userId: c.bId, value: 30 }] }), "SPLIT_RATIO_SUM");
  });

  it("轉帳：同帳戶、0 元、超過餘額、信用卡轉出都被擋；轉入信用卡可以", async () => {
    const card = await ledger.createAccount(c.ctxA, { name: "卡", type: "CREDIT_CARD", shared: false, openingBalance: -$(500) });
    const base = { toAccountId: c.joint, amount: $(100), occurredOn: D(3), note: "" };
    await rejects(createTransfer(c.ctxA, { ...base, fromAccountId: c.joint, clientRequestId: rid() }), "TRANSFER_SAME");
    await rejects(createTransfer(c.ctxA, { ...base, fromAccountId: c.accA, amount: 0, clientRequestId: rid() }), "TX_AMOUNT");
    await rejects(createTransfer(c.ctxA, { ...base, fromAccountId: c.accA, amount: $(999999), clientRequestId: rid() }), "TRANSFER_OVER_BALANCE");
    await rejects(createTransfer(c.ctxA, { ...base, fromAccountId: card.id, clientRequestId: rid() }), "TRANSFER_FROM_CARD");
    await assert.doesNotReject(createTransfer(c.ctxA, { fromAccountId: c.accA, toAccountId: card.id, amount: $(500), occurredOn: D(3), note: "繳卡費", clientRequestId: rid() }));
    assert.equal((await ledger.listAccounts(c.ctxA)).find((a) => a.id === card.id)?.balance, 0);
  });

  it("退款：全額退完之後不能再退，原始消費完全沒被改過", async () => {
    const tx = await expense($(1000), { method: "AMOUNT", participants: [{ userId: c.aId, value: $(400) }, { userId: c.bId, value: $(600) }] });
    const snapshot = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id }, include: { splits: true } });
    await createRefund(c.ctxA, { originalId: tx.id, amount: $(300), accountId: c.accA, occurredOn: D(4), note: "", clientRequestId: rid() });
    await createRefund(c.ctxA, { originalId: tx.id, amount: $(700), accountId: c.accA, occurredOn: D(5), note: "", clientRequestId: rid() });
    await rejects(createRefund(c.ctxA, { originalId: tx.id, amount: $(1), accountId: c.accA, occurredOn: D(6), note: "", clientRequestId: rid() }), "REFUND_FULLY_REFUNDED");
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id }, include: { splits: true } });
    assert.equal(after.amount, snapshot.amount);
    assert.deepEqual(after.splits.map((s) => s.amount).sort(), snapshot.splits.map((s) => s.amount).sort());
    assert.equal(after.version, snapshot.version);
    // 退款後的實際淨支出為 0
    const totals = (await searchTransactions(c.ctxA, parseFilter({ q: "測試" }), { take: 100 })).totals;
    assert.equal(totals.expense - totals.refund, totals.netExpense);
  });

  it("固定支出：月底、2 月、閏年都落在存在的日期上", async () => {
    const mk = (dayOfMonth: number, today: string) => recurring.createRecurring(c.ctxA, {
      name: `月底${dayOfMonth}`, note: "", amount: $(100), categoryId: null, accountId: c.accA, split: eq(),
      frequency: "MONTHLY", dayOfWeek: null, dayOfMonth, month: null, startDate: "2026-01-01", endDate: null,
    } satisfies RecurringInput, today);
    const r31 = await mk(31, "2026-02-01");
    assert.equal((await recurring.listRecurring(c.ctxA, "2026-02-01")).find((x) => x.id === r31.id)?.nextDueDate, "2026-02-28");
    const leap = await recurring.createRecurring(c.ctxA, {
      name: "閏年", note: "", amount: $(100), categoryId: null, accountId: c.accA, split: eq(),
      frequency: "YEARLY", dayOfWeek: null, dayOfMonth: 31, month: 2, startDate: "2028-01-01", endDate: null,
    } satisfies RecurringInput, "2028-01-01");
    assert.equal((await recurring.listRecurring(c.ctxA, "2028-01-01")).find((x) => x.id === leap.id)?.nextDueDate, "2028-02-29");
  });

  it("固定支出：已產生又被刪除的那一期不會再產生，也不會卡在待處理", async () => {
    const r = await recurring.createRecurring(c.ctxA, {
      name: "水費", note: "", amount: $(600), categoryId: null, accountId: c.accA, split: eq(),
      frequency: "MONTHLY", dayOfWeek: null, dayOfMonth: 10, month: null, startDate: "2026-01-01", endDate: null,
    } satisfies RecurringInput, "2026-09-09");
    const first = await recurring.generateRecurring(c.ctxA, r.id, { today: D(10), expectedDueDate: D(10) });
    await ledger.deleteTransaction(c.ctxA, first.transaction!.id);
    // 手動把應付日改回同一天（模擬改週期後又落在同一天）
    await prisma.recurringExpense.update({ where: { id: r.id }, data: { nextDueDate: new Date(`${D(10)}T00:00:00Z`) } });
    const again = await recurring.generateRecurring(c.ctxA, r.id, { today: D(11), expectedDueDate: D(10) });
    assert.equal(again.skipped, true, "不會重複產生，而是跳過這一期");
    assert.equal(again.transaction, null);
    assert.equal((await recurring.listRecurring(c.ctxA, D(11))).find((x) => x.id === r.id)?.nextDueDate, "2026-10-10", "已經跳到下一期");
    assert.equal(await prisma.transaction.count({ where: { recurringExpenseId: r.id, deletedAt: null } }), 0);
  });
});
