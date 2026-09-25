import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as recurring from "../../src/server/services/recurring";
import { createRefund } from "../../src/server/services/transfers";
import { searchTransactions } from "../../src/server/services/search";
import { parseFilter } from "../../src/server/domain/search";
import type { RecurringInput } from "../../src/server/services/recurring";

const TODAY = "2026-09-18"; // 週五

describe("Phase 3-3：固定支出", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;
  let card = "";
  let rent = ""; // 房租：每月 1 日 $15,500，小艾現金付款，平分

  const equal = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const base = (): RecurringInput => ({
    name: "房租", note: "", amount: $(15500), categoryId: null, accountId: c.accA, split: equal(),
    frequency: "MONTHLY", dayOfWeek: null, dayOfMonth: 1, month: null, startDate: "2026-01-01", endDate: null,
  });
  const balance = async (id: string) => (await ledger.listAccounts(c.ctxA)).find((a) => a.id === id)!.balance;
  const debtOf = async (userId: string) => (await ledger.getBalances(c.ctxA)).net.get(userId) ?? 0;
  const view = async (id: string, today = TODAY) => (await recurring.listRecurring(c.ctxA, today)).find((r) => r.id === id)!;
  const txCount = (id: string) => prisma.transaction.count({ where: { recurringExpenseId: id, deletedAt: null } });

  before(async () => {
    await reset();
    c = await setupCouple("rc");
    other = await setupCouple("ox");
    card = (await ledger.createAccount(c.ctxA, { name: "玉山卡", type: "CREDIT_CARD", shared: false, openingBalance: 0 })).id;
  });
  after(() => prisma.$disconnect());

  it("建立固定支出：不產生交易、不動帳戶餘額，下一次應付日 = 今天之後的第一個週期", async () => {
    const before = await balance(c.accA);
    const r = await recurring.createRecurring(c.ctxA, base(), TODAY);
    rent = r.id;
    assert.equal(await balance(c.accA), before, "建立設定不會扣錢");
    assert.equal(await txCount(rent), 0, "建立設定不會產生交易");
    assert.equal(await prisma.transaction.count({ where: { bookId: c.ctxA.book.id } }), 0);
    const v = await view(rent);
    assert.equal(v.nextDueDate, "2026-10-01", "9/18 建立 → 下一次 10/1，不補 9/1");
    assert.equal(v.state, "UPCOMING");
    assert.equal(v.scheduleText, "每月 1 日");
    assert.equal(v.splitText, "平分");
    assert.equal(v.payerName, "我");
    assert.equal((await recurring.pendingRecurring(c.ctxA, TODAY)).length, 0);
  });

  it("還沒到期不能產生；到期後產生一筆真正的支出（金流、分帳、欠款都正確）", async () => {
    await rejects(recurring.generateRecurring(c.ctxA, rent, { today: TODAY }), "RECURRING_NOT_DUE");

    const day = "2026-10-01";
    const accBefore = await balance(c.accA);
    const debtBefore = await debtOf(c.bId);
    const pending = await recurring.pendingRecurring(c.ctxA, day);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].state, "TODAY");

    const tx = (await recurring.generateRecurring(c.ctxA, rent, { today: day, expectedDueDate: day })).transaction!;
    assert.equal(tx.type, "EXPENSE");
    assert.equal(tx.amount, $(15500));
    assert.equal(tx.recurringExpenseId, rent);
    assert.equal(tx.title, "房租");
    const saved = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id }, include: { payments: true, splits: true } });
    assert.equal(saved.payments.length, 1);
    assert.equal(saved.payments[0].accountId, c.accA);
    assert.equal(saved.payments[0].amount, $(15500), "小艾的現金付款");
    assert.deepEqual(saved.splits.map((s) => s.amount), [$(7750), $(7750)], "平分");
    assert.equal(await balance(c.accA), accBefore - $(15500));
    assert.equal(await debtOf(c.bId), debtBefore - $(7750), "阿本欠小艾多 $7,750");

    const v = await view(rent, day);
    assert.equal(v.nextDueDate, "2026-11-01", "下一次往前推一個月");
    assert.equal(v.lastGeneratedDate, "2026-10-01");
    assert.equal(v.generated, 1);
    assert.equal((await recurring.pendingRecurring(c.ctxA, day)).length, 0, "產生後就從待處理消失");
  });

  it("同一個應付日不會產生第二筆（連點、兩支手機同時按）", async () => {
    // 畫面帶著舊的應付日再送一次 → 直接擋下
    await rejects(recurring.generateRecurring(c.ctxA, rent, { today: "2026-10-01", expectedDueDate: "2026-10-01" }), "RECURRING_STALE");
    assert.equal(await txCount(rent), 1);

    // 兩支手機同時按同一個到期項目
    const day = "2026-11-01";
    const results = await Promise.allSettled([
      recurring.generateRecurring(c.ctxA, rent, { today: day, expectedDueDate: day }),
      recurring.generateRecurring(c.ctxB, rent, { today: day, expectedDueDate: day }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "只有一個成功");
    assert.equal(await prisma.transaction.count({ where: { recurringExpenseId: rent, recurringDueDate: new Date("2026-11-01T00:00:00Z") } }), 1);
    assert.equal(await txCount(rent), 2);
    assert.equal((await view(rent, day)).nextDueDate, "2026-12-01");
  });

  it("逾期時逐期補產生（不會一次全部自動產生）", async () => {
    const today = "2027-02-10"; // 12/1、1/1、2/1 都逾期了
    const p = await recurring.pendingRecurring(c.ctxA, today);
    assert.equal(p.length, 1);
    assert.equal(p[0].nextDueDate, "2026-12-01");
    assert.equal(p[0].state, "OVERDUE");
    await recurring.generateRecurring(c.ctxA, rent, { today, expectedDueDate: "2026-12-01" });
    assert.equal((await view(rent, today)).nextDueDate, "2027-01-01", "一次只補一期");
    assert.equal(await txCount(rent), 3);
    await recurring.generateRecurring(c.ctxA, rent, { today, expectedDueDate: "2027-01-01" });
    await recurring.generateRecurring(c.ctxA, rent, { today, expectedDueDate: "2027-02-01" });
    assert.equal(await txCount(rent), 5);
    assert.equal((await recurring.pendingRecurring(c.ctxA, today)).length, 0);
    const dates = (await prisma.transaction.findMany({ where: { recurringExpenseId: rent }, orderBy: { recurringDueDate: "asc" }, select: { recurringDueDate: true } }))
      .map((t) => t.recurringDueDate!.toISOString().slice(0, 10));
    assert.deepEqual(dates, ["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
  });

  it("修改設定不會改到已經產生的交易，只影響之後產生的", async () => {
    const oldOnes = await prisma.transaction.findMany({ where: { recurringExpenseId: rent }, select: { id: true, amount: true, title: true } });
    await recurring.updateRecurring(c.ctxB, rent, { ...base(), amount: $(16000), name: "房租（調漲）", note: "2027 起調漲" }, "2027-02-10");
    const after = await prisma.transaction.findMany({ where: { recurringExpenseId: rent }, select: { id: true, amount: true, title: true } });
    assert.deepEqual(after.sort((x, y) => x.id.localeCompare(y.id)), oldOnes.sort((x, y) => x.id.localeCompare(y.id)), "歷史交易完全沒變");
    const v = await view(rent, "2027-02-10");
    assert.equal(v.amount, $(16000));
    assert.equal(v.nextDueDate, "2027-03-01", "只改金額不會影響下一次應付日");

    const tx = (await recurring.generateRecurring(c.ctxA, rent, { today: "2027-03-01", expectedDueDate: "2027-03-01" })).transaction!;
    assert.equal(tx.amount, $(16000), "新產生的用新金額");
    assert.equal(tx.title, "房租（調漲）");
  });

  it("改週期會重新計算下一次應付日（從今天起算）", async () => {
    const weekly = await recurring.createRecurring(c.ctxA, { ...base(), name: "掃地機器人耗材", amount: $(300), frequency: "WEEKLY", dayOfWeek: 1, dayOfMonth: null }, TODAY);
    assert.equal((await view(weekly.id)).nextDueDate, "2026-09-21", "9/18 是週五 → 下週一");
    await recurring.updateRecurring(c.ctxA, weekly.id, { ...base(), name: "掃地機器人耗材", amount: $(300), frequency: "YEARLY", dayOfMonth: 15, month: 1, dayOfWeek: null }, TODAY);
    assert.equal((await view(weekly.id)).nextDueDate, "2027-01-15");
    // 結束日期在下一次應付日之前 → 已結束
    await recurring.updateRecurring(c.ctxA, weekly.id, { ...base(), name: "掃地機器人耗材", amount: $(300), frequency: "YEARLY", dayOfMonth: 15, month: 1, dayOfWeek: null, endDate: "2026-12-31" }, TODAY);
    const v = await view(weekly.id);
    assert.equal(v.nextDueDate, null);
    assert.equal(v.state, "ENDED");
    await rejects(recurring.generateRecurring(c.ctxA, weekly.id, { today: "2027-01-15" }), "RECURRING_ENDED");
    await recurring.deleteRecurring(c.ctxA, weekly.id);
  });

  it("停用不再產生；重新啟用不補停用期間的付款", async () => {
    const netflix = await recurring.createRecurring(c.ctxA, { ...base(), name: "Netflix", amount: $(390), accountId: card, dayOfMonth: 15 }, "2026-09-01");
    assert.equal((await view(netflix.id, "2026-09-01")).nextDueDate, "2026-09-15");

    await recurring.setRecurringActive(c.ctxA, netflix.id, false, "2026-09-01");
    const paused = await view(netflix.id, "2026-09-20");
    assert.equal(paused.status, "PAUSED");
    assert.equal((await recurring.pendingRecurring(c.ctxA, "2026-09-20")).some((r) => r.id === netflix.id), false, "停用後不出現在待處理");
    await rejects(recurring.generateRecurring(c.ctxA, netflix.id, { today: "2026-09-20" }), "RECURRING_PAUSED");

    // 停了 9 月與 10 月，11/20 重新啟用 → 從 12/15 開始，不會補 9/15、10/15、11/15
    await recurring.setRecurringActive(c.ctxA, netflix.id, true, "2026-11-20");
    const resumed = await view(netflix.id, "2026-11-20");
    assert.equal(resumed.status, "ACTIVE");
    assert.equal(resumed.nextDueDate, "2026-12-15");
    assert.equal(await txCount(netflix.id), 0, "重新啟用不會補產生歷史交易");

    // 信用卡：產生後未繳金額增加，而且是支出不是轉帳
    const tx = (await recurring.generateRecurring(c.ctxA, netflix.id, { today: "2026-12-15", expectedDueDate: "2026-12-15" })).transaction!;
    assert.equal(tx.type, "EXPENSE");
    assert.equal(await balance(card), -$(390), "信用卡未繳 $390");
    const t = await searchTransactions(c.ctxA, parseFilter({ kind: "TRANSFER" }), { take: 100 });
    assert.equal(t.items.length, 0, "信用卡消費不是轉帳");
  });

  it("付款帳戶停用時不能產生，訊息要說清楚", async () => {
    const water = await recurring.createRecurring(c.ctxA, { ...base(), name: "水費", amount: $(600), accountId: card, dayOfMonth: 5 }, "2026-09-01");
    await prisma.account.update({ where: { id: card }, data: { isActive: false } });
    await rejects(recurring.generateRecurring(c.ctxA, water.id, { today: "2026-09-05" }), "RECURRING_ACCOUNT_INACTIVE");
    await assert.rejects(recurring.generateRecurring(c.ctxA, water.id, { today: "2026-09-05" }), /已停用，請先修改付款帳戶/);
    // 停用的帳戶也不能被選成新的固定支出的付款帳戶
    await rejects(recurring.createRecurring(c.ctxA, { ...base(), accountId: card }, TODAY), "RECURRING_ACCOUNT_INACTIVE");
    await prisma.account.update({ where: { id: card }, data: { isActive: true } });
    await recurring.deleteRecurring(c.ctxA, water.id);
  });

  it("分帳方式：自訂比例／自訂金額／一人負擔都沿用既有分帳邏輯", async () => {
    const cases: Array<[string, RecurringInput["split"], number[]]> = [
      ["比例", { method: "RATIO", participants: [{ userId: c.aId, value: 30 }, { userId: c.bId, value: 70 }] }, [$(600), $(1400)]],
      ["金額", { method: "AMOUNT", participants: [{ userId: c.aId, value: $(500) }, { userId: c.bId, value: $(1500) }] }, [$(500), $(1500)]],
      ["一人負擔", { method: "FULL", participants: [{ userId: c.bId }] }, [$(2000)]],
    ];
    for (const [name, split, expected] of cases) {
      const r = await recurring.createRecurring(c.ctxA, { ...base(), name: `網路費${name}`, amount: $(2000), split, dayOfMonth: 8 }, "2026-09-01");
      const tx = (await recurring.generateRecurring(c.ctxA, r.id, { today: "2026-09-08", expectedDueDate: "2026-09-08" })).transaction!;
      const splits = await prisma.transactionSplit.findMany({ where: { transactionId: tx.id }, orderBy: { amount: "asc" } });
      assert.deepEqual(splits.map((s) => s.amount).sort((x, y) => x - y), expected.sort((x, y) => x - y), name);
      assert.equal(splits.reduce((a, s) => a + s.amount, 0), $(2000), `${name}：分帳加總等於金額`);
    }
    // 不合法的分帳在建立時就被擋
    await rejects(
      recurring.createRecurring(c.ctxA, { ...base(), split: { method: "RATIO", participants: [{ userId: c.aId, value: 30 }, { userId: c.bId, value: 30 }] } }, TODAY),
      "SPLIT_RATIO_SUM",
    );
  });

  it("固定支出產生的交易可以搜尋、看得出來源；退款不影響下一期", async () => {
    const byKind = await searchTransactions(c.ctxA, parseFilter({ kind: "RECURRING" }), { take: 100 });
    assert.ok(byKind.items.length >= 6);
    assert.ok(byKind.items.every((t) => t.recurringExpenseId !== null));
    assert.ok(byKind.items.some((t) => t.recurring?.name === "房租（調漲）"));
    const byName = await searchTransactions(c.ctxA, parseFilter({ q: "Netflix" }), { take: 100 });
    assert.equal(byName.items.length, 1);

    // 退款：不會動到固定支出的設定與下一次應付日
    const netflixTx = byName.items[0];
    const r = (await recurring.listRecurring(c.ctxA, "2026-12-16")).find((x) => x.name === "Netflix")!;
    await createRefund(c.ctxA, { originalId: netflixTx.id, amount: $(390), accountId: netflixTx.payments[0].accountId, occurredOn: "2026-12-16", note: "取消訂閱退款", clientRequestId: rid() });
    const after = (await recurring.listRecurring(c.ctxA, "2026-12-16")).find((x) => x.name === "Netflix")!;
    assert.equal(after.nextDueDate, r.nextDueDate, "退款不會改下一次應付日");
    assert.equal(after.amount, r.amount);
    const totals = (await searchTransactions(c.ctxA, parseFilter({ q: "Netflix" }), { take: 100 })).totals;
    assert.equal(totals.netExpense, 0, "實際淨支出 = $390 − $390");
  });

  it("刪除設定不會刪掉已經產生的交易", async () => {
    const before = await txCount(rent);
    assert.ok(before > 0);
    await recurring.deleteRecurring(c.ctxA, rent);
    assert.equal((await recurring.listRecurring(c.ctxA, TODAY)).some((r) => r.id === rent), false);
    assert.equal(await txCount(rent), before, "歷史交易保留");
    assert.equal((await searchTransactions(c.ctxA, parseFilter({ q: "房租" }), { take: 100 })).items.length, before);
    await rejects(recurring.generateRecurring(c.ctxA, rent, { today: "2027-04-01" }), "RECURRING_NOT_FOUND");
  });

  it("兩人都能管理；別的帳本查不到、改不了、產生不了", async () => {
    const r = await recurring.createRecurring(c.ctxB, { ...base(), name: "管理費", amount: $(1200), accountId: c.joint, dayOfMonth: 3 }, "2026-09-01");
    assert.ok((await recurring.listRecurring(c.ctxA, "2026-09-01")).some((x) => x.id === r.id), "另一半建立的，我也看得到");
    await recurring.updateRecurring(c.ctxA, r.id, { ...base(), name: "管理費", amount: $(1300), accountId: c.joint, dayOfMonth: 3 }, "2026-09-01");
    const tx = (await recurring.generateRecurring(c.ctxB, r.id, { today: "2026-09-03", expectedDueDate: "2026-09-03" })).transaction!;
    assert.equal(tx.amount, $(1300));

    assert.equal((await recurring.listRecurring(other.ctxA, TODAY)).length, 0);
    assert.equal(await recurring.getRecurring(other.ctxA, r.id), null);
    await rejects(recurring.updateRecurring(other.ctxA, r.id, base(), TODAY), "RECURRING_NOT_FOUND");
    await rejects(recurring.setRecurringActive(other.ctxA, r.id, false, TODAY), "RECURRING_NOT_FOUND");
    await rejects(recurring.deleteRecurring(other.ctxA, r.id), "RECURRING_NOT_FOUND");
    await rejects(recurring.generateRecurring(other.ctxA, r.id, { today: "2026-10-03" }), "RECURRING_NOT_FOUND");
    // 也不能用別的帳本的帳戶或分類
    await rejects(recurring.createRecurring(c.ctxA, { ...base(), accountId: other.accA }, TODAY), "RECURRING_ACCOUNT");
    assert.equal((await searchTransactions(other.ctxA, parseFilter({ kind: "RECURRING" }), { take: 100 })).items.length, 0);
  });

  it("共同帳戶付款的固定支出不產生欠款", async () => {
    const joint = await recurring.createRecurring(c.ctxA, { ...base(), name: "第四台", amount: $(500), accountId: c.joint, dayOfMonth: 20 }, "2026-09-01");
    const debtBefore = await debtOf(c.bId);
    await recurring.generateRecurring(c.ctxA, joint.id, { today: "2026-09-20", expectedDueDate: "2026-09-20" });
    assert.equal(await debtOf(c.bId), debtBefore, "共同帳戶付款不影響誰欠誰");
    assert.equal(await balance(c.joint), -$(500) - $(1300), "共同帳戶照實扣款");
  });
});
