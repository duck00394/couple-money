import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rid, reset, rejects, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as goals from "../../src/server/services/goals";
import * as deletes from "../../src/server/services/deleteRequests";

describe("Phase 2：共同基金、共同目標（實際可用資金規則）", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let trip = "";
  let rent = "";
  let bBank = "";
  const detail = async (id = trip) => (await funds.getFundDetail(c.ctxA, id))!;
  const free = async (accountId: string) => (await funds.accountFreeAmount(prisma, c.ctxA.book.id, accountId)).free;
  const entry = (ctx = c.ctxA, over: Partial<Parameters<typeof funds.addFundEntry>[1]> = {}) =>
    funds.addFundEntry(ctx, { fundId: trip, type: "DEPOSIT", amount: $(1000), userId: ctx.me.userId, accountId: c.joint, note: "", occurredOn: "2026-09-01", clientRequestId: rid(), ...over });
  const expenseInput = (over: Partial<Parameters<typeof ledger.createTransaction>[1]> = {}) => ({
    type: "EXPENSE" as const, amount: $(1200), accountId: c.accA, categoryId: null, title: "機票訂金", note: "", occurredOn: "2026-09-02",
    split: { method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] }, clientRequestId: rid(), ...over,
  });

  before(async () => {
    await reset();
    c = await setupCouple();
    // 共同帳戶有 $30,000、阿本的銀行有 $20,000、小艾的現金 $0
    await ledger.createTransaction(c.ctxA, { ...expenseInput(), type: "INCOME", amount: $(30000), accountId: c.joint, title: "存入共同帳戶", split: { method: "FULL", participants: [{ userId: c.aId }] } });
    bBank = (await ledger.createAccount(c.ctxB, { name: "阿本銀行", type: "BANK", shared: false, openingBalance: $(20000) })).id;
  });
  after(() => prisma.$disconnect());

  it("投入必須選帳戶、不得超過帳戶可自由使用金額；投入不改變帳戶餘額、不影響誰欠誰", async () => {
    trip = (await funds.createFund(c.ctxA, { name: "日本旅遊基金", emoji: "plane", targetAmount: $(30000), dueDate: "2027-03-01" })).id;
    rent = (await funds.createFund(c.ctxB, { name: "租屋基金", emoji: "house", targetAmount: $(50000), dueDate: null })).id;
    const balancesBefore = (await ledger.listAccounts(c.ctxA)).map((a) => a.balance);

    await rejects(entry(c.ctxA, { accountId: null }), "FUND_ACCOUNT_REQUIRED");
    await rejects(entry(c.ctxA, { accountId: c.accA, amount: $(1) }), "FUND_OVER_FREE"); // 現金是 $0
    await entry(c.ctxA, { amount: $(10000) });
    await entry(c.ctxB, { amount: $(8000), accountId: bBank });
    await entry(c.ctxA, { amount: $(520), userId: null });
    assert.equal(await free(c.joint), $(30000 - 10520));

    await rejects(entry(c.ctxB, { fundId: rent, amount: $(19481) }), "FUND_OVER_FREE", );
    await entry(c.ctxB, { fundId: rent, amount: $(19480) });
    assert.equal(await free(c.joint), 0, "共同帳戶的錢全部被指定，可自由使用 = 0");
    await rejects(entry(c.ctxA, { amount: 1 }), "FUND_OVER_FREE");

    assert.deepEqual((await ledger.listAccounts(c.ctxA)).map((a) => a.balance), balancesBefore, "基金只是指定用途，帳戶餘額不變");
    assert.deepEqual((await ledger.getBalances(c.ctxA)).debts, []);

    const d = await detail();
    assert.equal(d.summary.balance, $(18520));
    assert.equal(d.summary.contributions.get(c.aId), $(10000));
    assert.equal(d.summary.contributions.get(c.bId), $(8000));
    assert.equal(d.summary.contributions.get("JOINT"), $(520));
    assert.equal(d.summary.byAccount.get(c.joint), $(10520));
    assert.equal(d.summary.byAccount.get(bBank), $(8000));
    assert.equal(d.remaining, $(30000 - 18520));
    const earmarked = await funds.earmarkedByAccount(prisma, c.ctxA.book.id);
    assert.equal(earmarked.get(c.joint), $(30000));
  });

  it("取回只能從該帳戶的額度；取消取回若會讓可自由使用變負數會被擋；重複送出只記一筆", async () => {
    await rejects(entry(c.ctxA, { type: "WITHDRAW", amount: $(10521) }), "FUND_ALLOCATION_INSUFFICIENT");
    await rejects(entry(c.ctxA, { type: "WITHDRAW", amount: $(8001), accountId: bBank }), "FUND_ALLOCATION_INSUFFICIENT");
    const w = await entry(c.ctxA, { type: "WITHDRAW", amount: $(520), userId: null });
    assert.equal(await free(c.joint), $(520));
    const req = rid();
    const [x, y] = await Promise.all([entry(c.ctxB, { fundId: rent, amount: $(520), clientRequestId: req }), entry(c.ctxB, { fundId: rent, amount: $(520), clientRequestId: req })]);
    assert.equal(x.id, y.id);
    assert.equal(await free(c.joint), 0);
    await rejects(funds.cancelFundEntry(c.ctxA, w.id), "FUND_OVER_FREE"); // 取消取回＝重新指定 $520，但共同帳戶已經沒有可自由使用的錢
    await funds.cancelFundEntry(c.ctxB, x.id);
    await funds.cancelFundEntry(c.ctxA, w.id);
    assert.equal((await detail()).summary.balance, $(18520));
    assert.equal(await free(c.joint), 0);
  });

  it("基金支出：一定要自己選動用哪個帳戶的額度（系統不會自動挑）", async () => {
    await rejects(ledger.createTransaction(c.ctxA, expenseInput({ fundId: trip })), "FUND_ACCOUNT_REQUIRED");
    await rejects(ledger.createTransaction(c.ctxA, expenseInput({ fundId: trip, fundAccountId: c.accA })), "FUND_ALLOCATION_INSUFFICIENT");
    assert.equal(await prisma.transaction.count({ where: { title: "機票訂金", deletedAt: null } }), 0, "沒選來源時整筆消費都不會建立");
  });

  it("基金支出：付款帳戶只扣一次、基金用途減少、欠款照分帳；動用哪個帳戶的額度可追溯", async () => {
    const t = await ledger.createTransaction(c.ctxA, expenseInput({ fundId: trip, fundAccountId: c.joint }));
    let d = await detail();
    assert.equal(d.summary.balance, $(18520 - 1200));
    const fe = await prisma.fundTransaction.findUnique({ where: { transactionId: t.id } });
    assert.equal(fe!.accountId, c.joint, "動用的是使用者指定的共同帳戶額度");
    assert.equal(fe!.userId, c.aId, "付款人");
    const accs = await ledger.listAccounts(c.ctxA);
    assert.equal(accs.find((a) => a.id === c.accA)!.balance, -$(1200), "實際付款帳戶扣一次");
    assert.equal(accs.find((a) => a.id === c.joint)!.balance, $(30000), "共同帳戶的錢沒動");
    assert.equal(await free(c.joint), $(1200), "共同帳戶的指定額度被用掉 $1,200，之後可以轉帳還給小艾");
    assert.deepEqual((await ledger.getBalances(c.ctxA)).debts, [{ from: c.bId, to: c.aId, amount: $(600) }], "個人帳戶付款照分帳產生欠款");

    const base = { ...expenseInput(), amount: $(1000), fundId: trip };
    await ledger.updateTransaction(c.ctxA, t.id, 1, { ...base, fundAccountId: bBank });
    assert.equal((await prisma.fundTransaction.findUnique({ where: { transactionId: t.id } }))!.accountId, bBank, "可以指定動用阿本銀行的額度");
    await rejects(ledger.updateTransaction(c.ctxA, t.id, 2, { ...base, amount: $(9000), fundAccountId: bBank }), "FUND_ALLOCATION_INSUFFICIENT");
    await ledger.updateTransaction(c.ctxA, t.id, 2, { ...base, fundId: null });
    assert.equal((await detail()).summary.balance, $(18520));
    await ledger.updateTransaction(c.ctxA, t.id, 3, { ...base, fundAccountId: bBank });
    assert.equal(await prisma.fundTransaction.count({ where: { transactionId: t.id } }), 1);
    await ledger.deleteTransaction(c.ctxA, t.id);
    d = await detail();
    assert.equal(d.summary.balance, $(18520));
    await rejects(funds.cancelFundEntry(c.ctxA, (await prisma.fundTransaction.findFirst({ where: { transactionId: t.id } }))!.id), "FUND_ENTRY_SOURCE");

    await rejects(ledger.createTransaction(c.ctxA, expenseInput({ amount: $(20000), fundId: trip, fundAccountId: c.joint })), "FUND_OVER_BALANCE");
    // 基金總額夠、但單一帳戶的額度不夠 → 要使用者改選帳戶，不會自動換一個
    await assert.rejects(ledger.createTransaction(c.ctxA, expenseInput({ amount: $(12000), fundId: trip, fundAccountId: bBank })), /不夠這筆/);
    assert.equal(await prisma.transaction.count({ where: { type: "EXPENSE", amount: { in: [$(20000), $(12000)] } } }), 0, "基金不夠時整筆消費都不會建立");
  });

  let goalId = "";
  it("共同目標：目前金額 = 實際基金金額、剩餘金額、達成自動完成、改目標金額重新判斷", async () => {
    goalId = (await goals.createGoal(c.ctxA, { name: "日本旅行", description: "明年春天", emoji: "leaf", targetAmount: $(30000), startDate: "2026-09-01", deadline: "2027-03-31", fundId: trip, isActive: true })).id;
    let v = (await goals.getGoal(c.ctxA, goalId))!;
    assert.equal(v.current, $(18520));
    assert.equal(v.pending, 0);
    assert.equal(v.remaining, $(30000 - 18520));
    assert.equal(v.status, "ACTIVE");
    await ledger.createTransaction(c.ctxB, { ...expenseInput(), type: "INCOME", amount: $(11480), accountId: bBank, title: "獎金", split: { method: "FULL", participants: [{ userId: c.bId }] } });
    await entry(c.ctxB, { amount: $(11480), accountId: bBank });
    v = (await goals.getGoal(c.ctxA, goalId))!;
    assert.equal(v.status, "ACHIEVED");
    await goals.updateGoal(c.ctxB, goalId, { name: "日本旅行", description: "", emoji: "leaf", targetAmount: $(40000), startDate: "2026-09-01", deadline: "2027-03-31", fundId: trip, isActive: true });
    v = (await goals.getGoal(c.ctxA, goalId))!;
    assert.equal(v.status, "ACTIVE");
    assert.equal(v.progress, 0.75);
    await rejects(goals.createGoal(c.ctxA, { name: "x", description: "", emoji: "", targetAmount: $(1), startDate: "2026-09-10", deadline: "2026-09-01", fundId: null, isActive: true }), "GOAL_DEADLINE");
  });

  it("刪除目標與基金需要另一半確認；有錢的基金連申請都不行；申請人不能自己同意", async () => {
    const r = await deletes.requestDelete(c.ctxA, "GOAL", goalId);
    assert.equal(r.deleted, false);
    assert.ok(await goals.getGoal(c.ctxA, goalId), "還沒同意前不會刪除");
    const again = await deletes.requestDelete(c.ctxA, "GOAL", goalId);
    assert.equal(again.request!.id, r.request!.id, "重複申請沿用同一筆");
    await rejects(deletes.decideDelete(c.ctxA, r.request!.id, "APPROVE"), "DELETE_REQUEST_SELF");
    await rejects(deletes.decideDelete(c.ctxB, r.request!.id, "CANCEL"), "DELETE_REQUEST_NOT_MINE");
    await deletes.decideDelete(c.ctxB, r.request!.id, "REJECT");
    assert.ok(await goals.getGoal(c.ctxA, goalId));
    const r2 = await deletes.requestDelete(c.ctxB, "GOAL", goalId);
    await deletes.decideDelete(c.ctxA, r2.request!.id, "APPROVE");
    assert.equal(await goals.getGoal(c.ctxA, goalId), null);
    assert.equal((await detail()).summary.balance, $(30000), "刪除目標不影響基金紀錄");
    await rejects(deletes.decideDelete(c.ctxA, r2.request!.id, "APPROVE"), "DELETE_REQUEST_DONE");

    await rejects(deletes.requestDelete(c.ctxA, "FUND", trip), "FUND_NOT_EMPTY");
    const empty = await funds.createFund(c.ctxA, { name: "生日基金", targetAmount: null, dueDate: null });
    const fr = await deletes.requestDelete(c.ctxA, "FUND", empty.id);
    await deletes.decideDelete(c.ctxA, fr.request!.id, "CANCEL");
    assert.ok(await funds.getFundDetail(c.ctxA, empty.id));
    const fr2 = await deletes.requestDelete(c.ctxA, "FUND", empty.id);
    await deletes.decideDelete(c.ctxB, fr2.request!.id, "APPROVE");
    assert.equal(await funds.getFundDetail(c.ctxA, empty.id), null);
  });

  it("建立目標可同時建立同名基金；無基金目標可手動完成；停用", async () => {
    const g = await goals.createGoal(c.ctxB, { name: "新沙發", description: "", emoji: "sofa", targetAmount: $(15000), startDate: "2026-09-17", deadline: null, fundId: "NEW", isActive: true });
    const linked = (await funds.listFunds(c.ctxA)).find((f) => f.name === "新沙發");
    assert.equal(g.fundId, linked!.id);
    const hike = await goals.createGoal(c.ctxA, { name: "一起爬玉山", description: "", emoji: "mountain", targetAmount: $(1), startDate: "2026-09-17", deadline: null, fundId: null, isActive: true });
    await goals.setGoalAchieved(c.ctxA, hike.id, true);
    assert.equal((await goals.getGoal(c.ctxA, hike.id))!.status, "ACHIEVED");
    await goals.updateGoal(c.ctxA, hike.id, { name: "一起爬玉山", description: "", emoji: "mountain", targetAmount: $(1), startDate: "2026-09-17", deadline: null, fundId: null, isActive: false });
    assert.ok(!(await goals.listGoals(c.ctxA)).some((x) => x.id === hike.id));
    // 帳本只有一個人時，刪除不需要確認
    const solo = await setupCoupleSolo();
    const sg = await goals.createGoal(solo, { name: "單人目標", description: "", emoji: "", targetAmount: $(1), startDate: "2026-09-17", deadline: null, fundId: null, isActive: true });
    assert.equal((await deletes.requestDelete(solo, "GOAL", sg.id)).deleted, true);
  });
});

async function setupCoupleSolo() {
  const users = await import("../../src/server/services/users");
  const books = await import("../../src/server/services/books");
  const u = await users.registerUser({ email: `solo-${rid().slice(0, 6)}@example.com`, password: "password123", name: "Solo" });
  await books.createBook(u.id, { name: "單人", nickname: "單" });
  return (await books.getBookContext(u.id))!;
}
