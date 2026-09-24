import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as transfers from "../../src/server/services/transfers";
import * as budgets from "../../src/server/services/budgets";
import { monthStats } from "../../src/server/services/stats";
import { COUPLE } from "../../src/server/services/tasks";
import type { SplitRule } from "../../src/server/domain/split";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;

/**
 * 個人預算（V2）。
 *
 * 最重要的一條：個人「已使用」＝**分帳後的實際負擔**（TransactionSplit），
 * 不是付款人金額。下面每一項都在驗這件事，以及「兩人加總 = 分類總支出」。
 */
describe("V2：共同／個人預算", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let bankA = "";
  let bankB = "";
  let fun = "";
  let food = "";

  const eq = (): SplitRule => ({ method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] });
  const full = (userId: string): SplitRule => ({ method: "FULL", participants: [{ userId }] });
  const cat = async (name: string) => (await ledger.listCategories(c.ctxA)).find((x) => x.name === name)!.id;

  const spend = (ctx: typeof c.ctxA, title: string, amount: number, accountId: string, categoryId: string, split: SplitRule = eq(), day = 5) =>
    ledger.createTransaction(ctx, {
      type: "EXPENSE", amount, accountId, categoryId, title,
      note: "", occurredOn: D(day), split, clientRequestId: rid(),
    });

  /** 某個分類、某個人這個月的「已使用」 */
  const used = async (categoryId: string, subjectKey: string) => {
    const { groups } = await budgets.budgetOverview(c.ctxA, MONTH);
    const g = groups.find((x) => x.categoryId === categoryId)!;
    const row = subjectKey === COUPLE ? g.couple! : g.people.find((p) => p.subjectKey === subjectKey)!;
    return row.progress.spent;
  };

  before(async () => {
    await reset();
    c = await setupCouple("pb");
    bankA = (await ledger.createAccount(c.ctxA, { name: "小艾銀行", type: "BANK", shared: false, openingBalance: $(500000) })).id;
    bankB = (await ledger.createAccount(c.ctxB, { name: "阿本銀行", type: "BANK", shared: false, openingBalance: $(500000) })).id;
    fun = await cat("娛樂");
    food = await cat("餐飲");
  });
  after(() => prisma.$disconnect());

  // ───────── 1～3：實際負擔，不是付款人 ─────────

  it("A 付款 $1,000、兩人 AA → A 與 B 的個人已使用各 $500（不是 A $1,000）", async () => {
    await budgets.createBudgets(c.ctxA, {
      categoryId: fun, month: MONTH,
      entries: [{ subjectKey: c.aId, amount: $(1500) }, { subjectKey: c.bId, amount: $(1500) }],
    });
    await spend(c.ctxA, "電影 AA", $(1000), bankA, fun);

    assert.equal(await used(fun, c.aId), $(500), "A 只算自己負擔的一半");
    assert.equal(await used(fun, c.bId), $(500), "B 也算到，即使不是他付的");
  });

  it("A 付款、A 全額負擔 → A 加 $600、B 不變", async () => {
    const beforeB = await used(fun, c.bId);
    await spend(c.ctxA, "A 自己的遊戲", $(600), bankA, fun, full(c.aId));
    assert.equal(await used(fun, c.aId), $(500) + $(600));
    assert.equal(await used(fun, c.bId), beforeB, "B 完全沒被影響");
  });

  it("B 付款但由 A 全額負擔 → 算到 A 的預算，不是 B 的", async () => {
    const beforeA = await used(fun, c.aId);
    const beforeB = await used(fun, c.bId);
    await spend(c.ctxB, "B 幫 A 買的", $(400), bankB, fun, full(c.aId));
    assert.equal(await used(fun, c.aId), beforeA + $(400), "負擔的人是 A");
    assert.equal(await used(fun, c.bId), beforeB, "付錢的 B 不算");
  });

  // ───────── 4：退款回沖 ─────────

  it("退款會正確回沖個人預算（A 負擔 $500 → 退 $200 → 變 $300）", async () => {
    await budgets.createBudgets(c.ctxA, {
      categoryId: food, month: MONTH,
      entries: [{ subjectKey: c.aId, amount: $(3000) }, { subjectKey: c.bId, amount: $(3000) }],
    });
    const meal = await spend(c.ctxA, "要退的一餐", $(1000), bankA, food); // AA → 各 500
    assert.equal(await used(food, c.aId), $(500));

    await transfers.createRefund(c.ctxA, {
      originalId: meal.id, amount: $(400), accountId: bankA, occurredOn: D(6), note: "", clientRequestId: rid(),
    });
    // 退款按原比例回沖：$400 的一半 = $200
    assert.equal(await used(food, c.aId), $(300), "A 從 500 變成 300");
    assert.equal(await used(food, c.bId), $(300), "B 也一起回沖");
  });

  // ───────── 5：共同帳戶付款 ─────────

  it("共同帳戶付款（payment.userId = null）仍然依 split 計入兩人的個人預算", async () => {
    const beforeA = await used(food, c.aId);
    const beforeB = await used(food, c.bId);
    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(20000), accountId: c.joint, categoryId: null, title: "共同帳戶入金",
      note: "", occurredOn: D(1), split: full(c.aId), clientRequestId: rid(),
    });
    await spend(c.ctxA, "共同帳戶付的晚餐", $(800), c.joint, food);

    const payments = await prisma.transactionPayment.findMany({
      where: { transaction: { title: "共同帳戶付的晚餐" } },
      select: { userId: true },
    });
    assert.deepEqual(payments.map((p) => p.userId), [null], "確認這筆真的是共同帳戶付的");
    assert.equal(await used(food, c.aId), beforeA + $(400), "還是照 split 算給 A");
    assert.equal(await used(food, c.bId), beforeB + $(400), "也算給 B");
  });

  // ───────── 6：不變式 ─────────

  it("A 的已使用 + B 的已使用 = 該分類的總支出（與 /stats 完全一致）", async () => {
    const stats = await monthStats(c.ctxA, MONTH);
    const { groups } = await budgets.budgetOverview(c.ctxA, MONTH);
    for (const g of groups) {
      const statsAmount = stats.categories.find((s) => s.categoryId === g.categoryId)?.amount ?? 0;
      assert.equal(g.spent, statsAmount, `${g.categoryName} 的分類總支出要與 /stats 一致`);
      if (g.people.length === 2) {
        const sum = g.people.reduce((a, p) => a + p.progress.spent, 0);
        assert.equal(sum, statsAmount, `${g.categoryName}：兩人負擔加總要等於分類總支出`);
      }
    }
  });

  it("「共同（兩人合計）」的金額是個人預算加總，已支出是分類總支出", async () => {
    const { groups } = await budgets.budgetOverview(c.ctxA, MONTH);
    const g = groups.find((x) => x.categoryId === fun)!;
    assert.equal(g.couple, null, "這個分類沒有設共同預算");
    assert.ok(g.combined?.fromPeople, "所以共同那一行是由個人預算合計出來的");
    assert.equal(g.combined!.amount, $(1500) + $(1500));
    assert.equal(g.combined!.progress.spent, g.spent);
    assert.equal(g.combined!.progress.remaining, $(3000) - g.spent);
  });

  // ───────── 7：舊的共同預算行為完全不變 ─────────

  it("舊的共同預算（subjectKey = COUPLE）行為完全不變：已支出是分類總支出", async () => {
    const travel = await cat("旅行");
    await spend(c.ctxA, "機票", $(5000), bankA, travel, full(c.aId));
    await budgets.createBudget(c.ctxA, { categoryId: travel, month: MONTH, amount: $(20000), note: "出國" });

    const { groups } = await budgets.budgetOverview(c.ctxA, MONTH);
    const g = groups.find((x) => x.categoryId === travel)!;
    assert.equal(g.couple!.subjectKey, COUPLE);
    assert.equal(g.couple!.progress.spent, $(5000), "即使全部由 A 負擔，共同預算算的還是分類總額");
    assert.equal(g.couple!.progress.amount, $(20000));
    assert.equal(g.people.length, 0);
    assert.ok(!g.combined!.fromPeople, "有共同預算時就用它，不是個人合計");
  });

  it("預設不帶 subjectKey 時就是共同預算（V1 的呼叫方式）", async () => {
    const shop = await cat("購物");
    const row = await budgets.createBudget(c.ctxA, { categoryId: shop, month: MONTH, amount: $(1000) });
    assert.equal(row.subjectKey, COUPLE);
  });

  // ───────── 驗證與權限 ─────────

  it("同一個分類同一個月，同一個人只能有一筆預算", async () => {
    const pet = await cat("醫療");
    await budgets.createBudgets(c.ctxA, { categoryId: pet, month: MONTH, entries: [{ subjectKey: c.aId, amount: $(500) }] });
    await rejects(
      budgets.createBudgets(c.ctxA, { categoryId: pet, month: MONTH, entries: [{ subjectKey: c.aId, amount: $(900) }] }),
      "BUDGET_DUPLICATE",
    );
    // 但同一個分類的「共同」與「B 的個人」都還可以設
    await budgets.createBudgets(c.ctxA, { categoryId: pet, month: MONTH, entries: [{ subjectKey: c.bId, amount: $(900) }] });
    await budgets.createBudget(c.ctxA, { categoryId: pet, month: MONTH, amount: $(2000) });
    const { groups } = await budgets.budgetOverview(c.ctxA, MONTH);
    const g = groups.find((x) => x.categoryId === pet)!;
    assert.equal(g.people.length, 2);
    assert.ok(g.couple);
  });

  it("不能為帳本以外的人設定個人預算", async () => {
    const other = await setupCouple("pbx");
    const home = await cat("居家");
    await rejects(
      budgets.createBudgets(c.ctxA, { categoryId: home, month: MONTH, entries: [{ subjectKey: other.aId, amount: $(100) }] }),
      "BUDGET_SUBJECT",
    );
  });

  it("一批裡有一筆不合法就整批不建立", async () => {
    const trans = await cat("交通");
    await rejects(
      budgets.createBudgets(c.ctxA, {
        categoryId: trans, month: MONTH,
        entries: [{ subjectKey: c.aId, amount: $(500) }, { subjectKey: c.bId, amount: 0 }],
      }),
      "BUDGET_AMOUNT",
    );
    assert.equal(await prisma.budget.count({ where: { bookId: c.ctxA.book.id, categoryId: trans } }), 0, "A 的那筆也沒有被建立");
  });

  it("停用個人預算後不算進摘要，但紀錄保留、已使用照算", async () => {
    const { groups: before } = await budgets.budgetOverview(c.ctxA, MONTH);
    const target = before.find((g) => g.categoryId === fun)!.people[0];
    await budgets.setBudgetActive(c.ctxA, target.id, false);
    const { groups: after, summary } = await budgets.budgetOverview(c.ctxA, MONTH);
    const g = after.find((x) => x.categoryId === fun)!;
    const row = g.people.find((p) => p.id === target.id)!;
    assert.equal(row.isActive, false);
    assert.equal(row.progress.spent, target.progress.spent, "已使用不受停用影響");
    assert.equal(g.combined!.amount, $(1500), "合計只算啟用中的那一筆");
    assert.ok(summary.count >= 1);
    await budgets.setBudgetActive(c.ctxA, target.id, true); // 還原
  });

  it("預算不會產生任何交易、分帳或餘額變化", async () => {
    const snapshot = async () => ({
      tx: await prisma.transaction.count({ where: { bookId: c.ctxA.book.id } }),
      payments: await prisma.transactionPayment.count(),
      splits: await prisma.transactionSplit.count(),
      balances: (await ledger.getBalances(c.ctxA)).accounts,
      debts: (await ledger.getBalances(c.ctxA)).debts,
    });
    const a = await snapshot();
    const music = await cat("其他");
    await budgets.createBudgets(c.ctxA, {
      categoryId: music, month: MONTH,
      entries: [{ subjectKey: COUPLE, amount: $(100) }, { subjectKey: c.aId, amount: $(50) }],
    });
    const b = await snapshot();
    assert.deepEqual(b, a, "建立預算前後，交易、金流、分帳、餘額、欠款完全一樣");
  });
});
