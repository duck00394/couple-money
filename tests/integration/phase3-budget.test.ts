import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as tasks from "../../src/server/services/tasks";
import * as transfers from "../../src/server/services/transfers";
import * as recurring from "../../src/server/services/recurring";
import * as budgets from "../../src/server/services/budgets";
import * as cats from "../../src/server/services/categories";
import { monthStats } from "../../src/server/services/stats";
import { searchTransactions } from "../../src/server/services/search";
import { listActivity } from "../../src/server/services/notifications";
import { EMPTY_FILTER } from "../../src/server/domain/search";

const MONTH = "2026-09";
const LAST = "2026-08";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
const NOW = new Date(`${D(15)}T12:00:00+08:00`);

describe("Phase 3-4 B：每月分類預算", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;
  let food = "";
  let fun = "";
  let travel = "";
  let bank = "";
  let foodBudget = "";
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const full = (userId: string) => ({ method: "FULL" as const, participants: [{ userId }] });
  const cat = async (name: string) => (await ledger.listCategories(c.ctxA)).find((x) => x.name === name)!.id;
  const overview = (ctx = c.ctxA, month = MONTH) => budgets.budgetOverview(ctx, month);
  const rowOf = async (categoryId: string, ctx = c.ctxA, month = MONTH) =>
    (await overview(ctx, month)).rows.find((r) => r.categoryId === categoryId)!;
  const expense = (amount: number, categoryId: string | null, day: number, title = "消費") =>
    ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount, accountId: bank, categoryId, title,
      note: "", occurredOn: D(day), split: eq(), clientRequestId: rid(),
    });

  before(async () => {
    await reset();
    c = await setupCouple("bg");
    other = await setupCouple("oth");
    food = await cat("餐飲");
    fun = await cat("娛樂");
    travel = await cat("旅行");
    bank = (await ledger.createAccount(c.ctxA, { name: "小艾銀行", type: "BANK", shared: false, openingBalance: $(100000) })).id;
    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(30000), accountId: c.joint, categoryId: null, title: "薪水",
      note: "", occurredOn: D(1), split: full(c.aId), clientRequestId: rid(),
    });
  });
  after(() => prisma.$disconnect());

  // ───────── CRUD ─────────

  it("新增預算：屬於目前帳本、預設啟用，金額必須大於 0", async () => {
    const created = await budgets.createBudget(c.ctxA, { categoryId: food, month: MONTH, amount: $(8000), note: " 外食少一點 " });
    foodBudget = created.id;
    assert.equal(created.bookId, c.ctxA.book.id);
    assert.equal(created.month, MONTH);
    assert.equal(created.amount, $(8000));
    assert.equal(created.isActive, true);
    assert.equal(created.note, "外食少一點");
    await rejects(budgets.createBudget(c.ctxA, { categoryId: fun, month: MONTH, amount: 0 }), "BUDGET_AMOUNT");
    await rejects(budgets.createBudget(c.ctxA, { categoryId: fun, month: MONTH, amount: -$(100) }), "BUDGET_AMOUNT");
    await rejects(budgets.createBudget(c.ctxA, { categoryId: fun, month: "2026-13", amount: $(100) }), "BUDGET_MONTH");
    await rejects(budgets.createBudget(c.ctxA, { categoryId: fun, month: "abc", amount: $(100) }), "BUDGET_MONTH");
  });

  it("同一個月同一個分類只能有一個預算", async () => {
    await rejects(budgets.createBudget(c.ctxA, { categoryId: food, month: MONTH, amount: $(9000) }), "BUDGET_DUPLICATE");
    assert.equal((await overview()).rows.filter((r) => r.categoryId === food).length, 1);
    // 不同月份可以各有一個
    await budgets.createBudget(c.ctxA, { categoryId: food, month: LAST, amount: $(5000) });
    assert.equal((await overview(c.ctxA, LAST)).rows.length, 1);
    assert.equal((await overview()).rows.length, 1);
  });

  it("只能為支出分類設預算", async () => {
    const salary = (await ledger.listCategories(c.ctxA)).find((x) => x.name === "薪水")!.id;
    await rejects(budgets.createBudget(c.ctxA, { categoryId: salary, month: MONTH, amount: $(100) }), "BUDGET_CATEGORY_KIND");
  });

  it("修改金額與備註；停用與重新啟用", async () => {
    await budgets.updateBudget(c.ctxA, foodBudget, { amount: $(6000), note: "改嚴一點" });
    let row = await rowOf(food);
    assert.equal(row.progress.amount, $(6000));
    assert.equal(row.note, "改嚴一點");
    await rejects(budgets.updateBudget(c.ctxA, foodBudget, { amount: 0 }), "BUDGET_AMOUNT");

    await budgets.setBudgetActive(c.ctxA, foodBudget, false);
    row = await rowOf(food);
    assert.equal(row.isActive, false);
    assert.equal((await overview()).summary.count, 0, "停用的不算進摘要");
    await budgets.setBudgetActive(c.ctxA, foodBudget, false); // 重複不報錯
    await budgets.setBudgetActive(c.ctxA, foodBudget, true);
    assert.equal((await rowOf(food)).isActive, true);
  });

  // ───────── 統計口徑 ─────────

  it("已支出與 /stats 的分類統計完全相同", async () => {
    await expense($(1200), food, 5, "火鍋");
    await expense($(800), food, 6, "早餐");
    const stats = await monthStats(c.ctxA, MONTH);
    const statsFood = stats.categories.find((x) => x.categoryId === food)!.amount;
    assert.equal((await rowOf(food)).progress.spent, statsFood);
    assert.equal(statsFood, $(2000));
    assert.equal((await rowOf(food)).progress.remaining, $(4000));
  });

  it("退款會抵減已支出", async () => {
    const beforeSpent = (await rowOf(food)).progress.spent;
    const original = await expense($(1000), food, 7, "要退的");
    assert.equal((await rowOf(food)).progress.spent, beforeSpent + $(1000));
    await transfers.createRefund(c.ctxA, {
      originalId: original.id, amount: $(400), accountId: bank, occurredOn: D(8), note: "", clientRequestId: rid(),
    });
    const afterSpent = (await rowOf(food)).progress.spent;
    assert.equal(afterSpent, beforeSpent + $(600), "這筆消費實際只花了 1000 − 400 = 600");
    assert.equal(afterSpent, (await monthStats(c.ctxA, MONTH)).categories.find((x) => x.categoryId === food)!.amount);
  });

  it("不算支出的東西一律不進預算：收入、轉帳、結算、期初餘額、餘額調整、投入基金、未入金獎金", async () => {
    const before = (await rowOf(food)).progress.spent;
    // 收入（不同分類也不會進來，但仍確認一次）
    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(5000), accountId: bank, categoryId: null, title: "獎金",
      note: "", occurredOn: D(9), split: full(c.aId), clientRequestId: rid(),
    });
    await transfers.createTransfer(c.ctxA, {
      fromAccountId: bank, toAccountId: c.joint, amount: $(3000), occurredOn: D(9), note: "", clientRequestId: rid(),
    });
    const debt = (await ledger.getBalances(c.ctxA)).debts[0];
    if (debt) {
      await ledger.settle(c.ctxA, {
        fromUserId: debt.from, toUserId: debt.to, amount: Math.min(debt.amount, $(100)),
        fromAccountId: debt.from === c.aId ? bank : c.accB, toAccountId: debt.to === c.aId ? bank : c.accB,
        note: "", clientRequestId: rid(),
      });
    }
    await ledger.createAccount(c.ctxA, { name: "新帳戶", type: "CASH", shared: false, openingBalance: $(9000) });
    await ledger.adjustAccountBalance(c.ctxA, { accountId: bank, targetBalance: $(50000), note: "對帳", occurredOn: D(10), clientRequestId: rid() });
    const fund = await funds.createFund(c.ctxA, { name: "旅遊", targetAmount: null, dueDate: null });
    await funds.addFundEntry(c.ctxA, {
      fundId: fund.id, type: "DEPOSIT", amount: $(5000), userId: c.aId, accountId: c.joint,
      note: "", occurredOn: D(10), clientRequestId: rid(),
    });
    const task = await tasks.createTask(c.ctxA, {
      title: "運動", description: "", emoji: "🏃", scope: "PERSONAL", assigneeId: c.aId,
      frequency: "DAILY", daysOfWeek: 127, requiresApproval: false, requiresPhoto: false,
      rewardAmount: $(50), fundId: fund.id, penaltyAmount: 0, penaltyText: "", isActive: true, milestones: [],
    }, D(11));
    await tasks.checkIn(c.ctxA, task.id, { today: D(11) });

    assert.equal((await rowOf(food)).progress.spent, before, "這些都不該影響預算的已支出");
  });

  it("已作廢的交易不算；基金支出與固定支出產生的交易照算（與 /stats 一致）", async () => {
    const before = (await rowOf(food)).progress.spent;
    const tx = await expense($(500), food, 12, "要作廢的");
    assert.equal((await rowOf(food)).progress.spent, before + $(500));
    await ledger.deleteTransaction(c.ctxA, tx.id);
    assert.equal((await rowOf(food)).progress.spent, before, "作廢後回復");

    // 基金支出＝真實支出，/stats 這樣算，預算也一樣
    await budgets.createBudget(c.ctxA, { categoryId: travel, month: MONTH, amount: $(10000) });
    const fund = await prisma.fund.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, name: "旅遊" } });
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1200), accountId: c.joint, categoryId: travel, title: "機票",
      note: "", occurredOn: D(13), split: eq(), clientRequestId: rid(), fundId: fund.id, fundAccountId: c.joint,
    });
    assert.equal((await rowOf(travel)).progress.spent, $(1200));
    assert.equal(
      (await rowOf(travel)).progress.spent,
      (await monthStats(c.ctxA, MONTH)).categories.find((x) => x.categoryId === travel)!.amount,
    );

    // 固定支出產生的交易也算
    await budgets.createBudget(c.ctxA, { categoryId: fun, month: MONTH, amount: $(2000) });
    const r = await recurring.createRecurring(c.ctxA, {
      name: "串流訂閱", note: "", amount: $(390), categoryId: fun, accountId: bank,
      split: eq(), frequency: "MONTHLY", dayOfWeek: null, dayOfMonth: 14, month: null,
      startDate: D(14), endDate: null,
    }, D(14));
    assert.equal((await rowOf(fun)).progress.spent, 0, "設定本身不是金流");
    await recurring.generateRecurring(c.ctxA, r.id, { today: D(14) });
    assert.equal((await rowOf(fun)).progress.spent, $(390));
  });

  it("超支只是提醒，不會擋住記帳", async () => {
    const budget = await rowOf(fun);
    const over = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: budget.progress.amount + $(500), accountId: bank, categoryId: fun, title: "大手筆",
      note: "", occurredOn: D(15), split: eq(), clientRequestId: rid(),
    });
    assert.ok(over.id, "還是記得下去");
    const after = await rowOf(fun);
    assert.equal(after.progress.state, "OVER");
    assert.ok(after.progress.over > 0);
    assert.ok(after.progress.remaining < 0);
    assert.equal((await overview()).summary.over, 1);
  });

  // ───────── 月份 ─────────

  it("切換月份：各月各算各的，沒有預算的月份是空的", async () => {
    const sep = await overview(c.ctxA, MONTH);
    const aug = await overview(c.ctxA, LAST);
    assert.ok(sep.rows.length >= 3);
    assert.equal(aug.rows.length, 1, "八月只設過餐飲");
    assert.equal(aug.rows[0].progress.spent, 0, "八月沒有消費");
    const empty = await overview(c.ctxA, "2026-07");
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.summary.count, 0);
    assert.ok(empty.available.length > 0, "還沒設預算的分類可以新增");
  });

  it("歷史預算不會因為之後的操作而改變", async () => {
    const augBefore = await overview(c.ctxA, LAST);
    await expense($(300), food, 20, "九月又花了");
    const augAfter = await overview(c.ctxA, LAST);
    assert.deepEqual(augAfter.rows, augBefore.rows, "八月的預算與已支出都不該變");
  });

  // ───────── 分類停用 ─────────

  it("分類停用：歷史預算保留、統計照算，但不能為它新增預算", async () => {
    const before = await rowOf(food);
    await cats.setCategoryArchived(c.ctxA, food, true);
    const after = await rowOf(food);
    assert.equal(after.progress.amount, before.progress.amount, "預算保留");
    assert.equal(after.progress.spent, before.progress.spent, "已支出照算");
    assert.equal(after.categoryArchived, true);
    assert.ok(!(await overview()).available.some((x) => x.id === food), "停用分類不會出現在可新增清單");
    await rejects(budgets.createBudget(c.ctxA, { categoryId: food, month: "2026-10", amount: $(100) }), "BUDGET_CATEGORY_ARCHIVED");
    // 但既有的還是可以改與停用
    await budgets.updateBudget(c.ctxA, foodBudget, { amount: $(6500) });
    assert.equal((await rowOf(food)).progress.amount, $(6500));
    await cats.setCategoryArchived(c.ctxA, food, false);
  });

  it("有預算的分類不能被硬刪（改用停用）", async () => {
    const tmp = await cats.createCategory(c.ctxA, { name: "臨時預算分類", kind: "EXPENSE" });
    await budgets.createBudget(c.ctxA, { categoryId: tmp.id, month: MONTH, amount: $(500) });
    await rejects(cats.deleteCategory(c.ctxA, tmp.id), "CATEGORY_IN_USE");
    const manage = (await cats.listCategoriesForManage(c.ctxA)).find((x) => x.id === tmp.id)!;
    assert.equal(manage.usedByBudget, 1);
    assert.equal(manage.deletable, false);
    // 刪掉預算之後就可以刪分類了
    const b = (await overview()).rows.find((r) => r.categoryId === tmp.id)!;
    await budgets.deleteBudget(c.ctxA, b.id);
    await cats.deleteCategory(c.ctxA, tmp.id);
    assert.equal(await prisma.category.findUnique({ where: { id: tmp.id } }), null);
  });

  // ───────── 權限與隔離 ─────────

  it("唯讀成員看得到預算，但不能新增／修改／停用／刪除", async () => {
    const readOnly = { ...c.ctxB, canWrite: false };
    assert.ok((await overview(readOnly)).rows.length > 0);
    await rejects(budgets.createBudget(readOnly, { categoryId: travel, month: "2026-10", amount: $(100) }), "BOOK_READ_ONLY");
    await rejects(budgets.updateBudget(readOnly, foodBudget, { amount: $(1) }), "BOOK_READ_ONLY");
    await rejects(budgets.setBudgetActive(readOnly, foodBudget, false), "BOOK_READ_ONLY");
    await rejects(budgets.deleteBudget(readOnly, foodBudget), "BOOK_READ_ONLY");
    assert.equal((await rowOf(food)).progress.amount, $(6500), "什麼都沒被改到");
  });

  it("跨帳本：動不到也看不到別的帳本的預算", async () => {
    const theirs = await budgets.createBudget(other.ctxA, { categoryId: (await ledger.listCategories(other.ctxA)).find((x) => x.name === "餐飲")!.id, month: MONTH, amount: $(3000) });
    await rejects(budgets.updateBudget(c.ctxA, theirs.id, { amount: $(1) }), "BUDGET_NOT_FOUND");
    await rejects(budgets.setBudgetActive(c.ctxA, theirs.id, false), "BUDGET_NOT_FOUND");
    await rejects(budgets.deleteBudget(c.ctxA, theirs.id), "BUDGET_NOT_FOUND");
    await rejects(budgets.deleteBudget(c.ctxA, "id-does-not-exist"), "BUDGET_NOT_FOUND");
    assert.ok(!(await overview()).rows.some((r) => r.id === theirs.id));
    // 用別的帳本的分類 id 也建不出來
    await rejects(
      budgets.createBudget(c.ctxA, { categoryId: (await ledger.listCategories(other.ctxA)).find((x) => x.name === "娛樂")!.id, month: "2026-10", amount: $(100) }),
      "BUDGET_CATEGORY",
    );
    assert.equal((await prisma.budget.findUniqueOrThrow({ where: { id: theirs.id } })).amount, $(3000));
  });

  it("已離開帳本的人拿不到 context，自然管不了預算", async () => {
    const { getBookContext } = await import("../../src/server/services/books");
    await prisma.bookMember.update({
      where: { bookId_userId: { bookId: c.ctxA.book.id, userId: c.bId } },
      data: { status: "LEFT" },
    });
    const ctx = await getBookContext(c.bId);
    assert.ok(!ctx || ctx.book.id !== c.ctxA.book.id);
    await prisma.bookMember.update({
      where: { bookId_userId: { bookId: c.ctxA.book.id, userId: c.bId } },
      data: { status: "ACTIVE" },
    });
  });

  // ───────── 財務不變式 ─────────

  it("預算完全不碰金流：交易、金流、分帳、基金、餘額、欠款、stats、搜尋 totals 都不變", async () => {
    const snapshot = async () => ({
      tx: await prisma.transaction.count(),
      payments: await prisma.transactionPayment.count(),
      splits: await prisma.transactionSplit.count(),
      fundEntries: await prisma.fundTransaction.count(),
      accounts: [...(await ledger.getBalances(c.ctxA)).accounts].sort(),
      net: [...(await ledger.getBalances(c.ctxA)).net].sort(),
      stats: (await monthStats(c.ctxA, MONTH)).totals,
      statsCategories: (await monthStats(c.ctxA, MONTH)).categories,
      summary: await ledger.monthSummary(c.ctxA, NOW),
      search: (await searchTransactions(c.ctxA, EMPTY_FILTER, { take: 500 })).totals,
    });
    const before = await snapshot();
    const b = await budgets.createBudget(c.ctxA, { categoryId: travel, month: "2026-10", amount: $(1234) });
    await budgets.updateBudget(c.ctxA, b.id, { amount: $(4321) });
    await budgets.setBudgetActive(c.ctxA, b.id, false);
    await budgets.setBudgetActive(c.ctxA, b.id, true);
    await budgets.deleteBudget(c.ctxA, b.id);
    await overview();
    assert.deepEqual(await snapshot(), before);
  });

  it("預算操作寫進 AuditLog，也會出現在對方的最近動態；看預算不會產生通知", async () => {
    const created = await budgets.createBudget(c.ctxB, { categoryId: travel, month: "2026-10", amount: $(2000) });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { bookId: c.ctxA.book.id, entityType: "Budget", entityId: created.id, action: "CREATE" },
    });
    assert.equal(log.actorId, c.bId);
    const activity = await listActivity(c.ctxA);
    assert.equal(activity[0].text, "阿本 設了預算");
    assert.ok(activity[0].detail.includes("2026-10") && activity[0].detail.includes("旅行"));
    assert.equal(activity[0].href, "/budgets?m=2026-10");

    const countBefore = (await listActivity(c.ctxA)).length;
    await overview();
    await budgets.budgetSummary(c.ctxA, MONTH);
    assert.equal((await listActivity(c.ctxA)).length, countBefore, "只是看預算不會產生通知");
  });

  it("首頁摘要：沒有預算時回 null，有的話會算出超支數量", async () => {
    const fresh = await setupCouple("nobudget");
    assert.equal(await budgets.budgetSummary(fresh.ctxA, MONTH), null);
    const s = (await budgets.budgetSummary(c.ctxA, MONTH))!;
    assert.ok(s.count > 0);
    assert.equal(s.count, (await overview()).rows.filter((r) => r.isActive).length);
    assert.equal(s.ok + s.near + s.over, s.count);
  });
});
