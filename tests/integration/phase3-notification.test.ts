import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as tasks from "../../src/server/services/tasks";
import * as receipts from "../../src/server/services/receipts";
import * as recurring from "../../src/server/services/recurring";
import { listActivity, RECENT_LIMIT } from "../../src/server/services/notifications";
import { exportTransactionsCsv, recordExport } from "../../src/server/services/export";
import { monthStats } from "../../src/server/services/stats";
import { searchTransactions } from "../../src/server/services/search";
import { EMPTY_FILTER } from "../../src/server/domain/search";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
const NOW = new Date(`${D(15)}T12:00:00+08:00`);
const png = (name: string) =>
  new File([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56, 9)])], name, { type: "image/png" });

describe("Phase 3-4 H：最近動態", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;
  let bank = "";
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const full = (userId: string) => ({ method: "FULL" as const, participants: [{ userId }] });
  /** 小艾（A）看到的動態 = 阿本（B）做的事 */
  const amySees = () => listActivity(c.ctxA);
  const benSees = () => listActivity(c.ctxB);
  const texts = async (list: Awaited<ReturnType<typeof listActivity>>) => list.map((x) => `${x.text}｜${x.detail}`);

  before(async () => {
    await reset();
    c = await setupCouple("nt");
    other = await setupCouple("ot");
    bank = (await ledger.createAccount(c.ctxA, { name: "小艾銀行", type: "BANK", shared: false, openingBalance: $(20000) })).id;
    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(30000), accountId: c.joint, categoryId: null, title: "薪水",
      note: "", occurredOn: D(1), split: full(c.aId), clientRequestId: rid(),
    });
  });
  after(() => prisma.$disconnect());

  // ───────── 基本行為 ─────────

  it("對方新增記帳會出現在我的動態；自己的操作不會通知自己", async () => {
    const tx = await ledger.createTransaction(c.ctxB, {
      type: "EXPENSE", amount: $(500), accountId: c.accB, categoryId: null, title: "阿本買的咖啡",
      note: "", occurredOn: D(5), split: eq(), clientRequestId: rid(),
    });
    const amy = await amySees();
    const first = amy[0];
    assert.equal(first.text, "阿本 新增了一筆支出");
    assert.ok(first.detail.includes("阿本買的咖啡") && first.detail.includes("$500"));
    assert.equal(first.href, `/transactions/${tx.id}`);
    // 阿本自己看不到這一筆，但看得到小艾建的帳戶與收入
    const ben = await texts(await benSees());
    assert.ok(!ben.some((t) => t.includes("阿本買的咖啡")), "自己的操作不會變成自己的通知");
    assert.ok(ben.some((t) => t.includes("新增了帳戶")));
    assert.ok(ben.some((t) => t.includes("新增了一筆收入")));
  });

  it("修改與作廢都看得出來；作廢後沒有連結（不能靠通知看已刪除的資料）", async () => {
    const tx = await ledger.createTransaction(c.ctxB, {
      type: "EXPENSE", amount: $(900), accountId: c.accB, categoryId: null, title: "要改要刪的",
      note: "", occurredOn: D(6), split: eq(), clientRequestId: rid(),
    });
    await ledger.updateTransaction(c.ctxB, tx.id, tx.version, {
      type: "EXPENSE", amount: $(700), accountId: c.accB, categoryId: null, title: "要改要刪的",
      note: "", occurredOn: D(6), split: eq(),
    });
    const afterUpdate = (await amySees())[0];
    assert.equal(afterUpdate.text, "阿本 修改了一筆支出");
    assert.ok(afterUpdate.detail.includes("$900") && afterUpdate.detail.includes("→ $700"));
    assert.equal(afterUpdate.href, `/transactions/${tx.id}`);

    await ledger.deleteTransaction(c.ctxB, tx.id);
    const afterDelete = (await amySees())[0];
    assert.equal(afterDelete.text, "阿本 作廢了一筆支出");
    assert.equal(afterDelete.href, null, "已作廢的記帳不給連結");
    // 之前那筆「新增／修改」的通知也不再給連結
    const sameTx = (await amySees()).filter((x) => x.detail.includes("要改要刪的"));
    assert.ok(sameTx.length >= 3);
    assert.ok(sameTx.every((x) => x.href === null), "同一筆交易的所有動態都不該再連得過去");
  });

  it("餘額調整與作廢調整都顯示得出來", async () => {
    const benBank = (await ledger.createAccount(c.ctxB, { name: "阿本銀行", type: "BANK", shared: false, openingBalance: $(5000) })).id;
    const adj = await ledger.adjustAccountBalance(c.ctxB, {
      accountId: benBank, targetBalance: $(4800), note: "對帳", occurredOn: D(7), clientRequestId: rid(),
    });
    const created = (await amySees())[0];
    assert.equal(created.text, "阿本 調整了帳戶餘額");
    assert.ok(created.detail.includes("阿本銀行") && created.detail.includes("−$200"));
    assert.equal(created.href, `/transactions/${adj.id}`);

    await ledger.cancelAdjustment(c.ctxB, adj.id);
    const cancelled = (await amySees())[0];
    assert.equal(cancelled.text, "阿本 作廢了一筆餘額調整");
    assert.equal(cancelled.href, null);
  });

  it("收據新增與刪除會通知，且不會洩漏檔名或路徑", async () => {
    const tx = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(300), accountId: bank, categoryId: null, title: "有收據的",
      note: "", occurredOn: D(8), split: eq(), clientRequestId: rid(),
    });
    const att = await receipts.addReceipt(c.ctxB, tx.id, png("secret-filename.png"));
    const added = (await amySees())[0];
    assert.equal(added.text, "阿本 加了一張收據");
    assert.equal(added.detail, "有收據的");
    assert.equal(added.href, `/transactions/${tx.id}`);
    assert.ok(!JSON.stringify(added).includes("secret-filename"), "不該出現檔名");

    await receipts.removeReceipt(c.ctxB, att.id);
    assert.equal((await amySees())[0].text, "阿本 刪掉了一張收據");
  });

  it("打卡、結算、基金、目標、任務、固定支出都會出現", async () => {
    const fund = await funds.createFund(c.ctxB, { name: "日本旅遊", targetAmount: null, dueDate: null });
    await funds.addFundEntry(c.ctxB, {
      fundId: fund.id, type: "DEPOSIT", amount: $(1000), userId: c.bId, accountId: c.joint,
      note: "", occurredOn: D(9), clientRequestId: rid(),
    });
    const task = await tasks.createTask(c.ctxB, {
      title: "每天運動", description: "", emoji: "🏃", scope: "PERSONAL", assigneeId: c.bId,
      frequency: "DAILY", daysOfWeek: 127, requiresApproval: false, requiresPhoto: false,
      rewardAmount: $(50), fundId: fund.id, penaltyAmount: 0, penaltyText: "", isActive: true, milestones: [],
    }, D(10));
    await tasks.checkIn(c.ctxB, task.id, { today: D(10) });
    await recurring.createRecurring(c.ctxB, {
      name: "房租", note: "", amount: $(15000), categoryId: null, accountId: c.joint,
      split: eq(), frequency: "MONTHLY", dayOfWeek: null, dayOfMonth: 10, month: null,
      startDate: D(10), endDate: null,
    }, D(10));
    // 依目前實際的欠款方向結算（金額不固定，所以只檢查有這則通知）
    const debt = (await ledger.getBalances(c.ctxB)).debts[0];
    assert.ok(debt, "要有欠款才測得到結算通知");
    await ledger.settle(c.ctxB, {
      fromUserId: debt.from, toUserId: debt.to, amount: Math.min(debt.amount, $(50)),
      fromAccountId: debt.from === c.aId ? bank : c.accB,
      toAccountId: debt.to === c.aId ? bank : c.accB,
      note: "", clientRequestId: rid(),
    });

    const list = await texts(await amySees());
    assert.ok(list.some((t) => t.startsWith("阿本 新增了基金｜日本旅遊")), list.join("\n"));
    assert.ok(list.some((t) => t.startsWith("阿本 動了基金的錢")));
    assert.ok(list.some((t) => t.startsWith("阿本 新增了任務｜每天運動")));
    assert.ok(list.some((t) => t.startsWith("阿本 完成了打卡｜每天運動")));
    assert.ok(list.some((t) => t.startsWith("阿本 新增了固定支出｜房租")));
    assert.ok(list.some((t) => t.startsWith("阿本 結算了｜$")), list.join("\n"));
  });

  // ───────── 雜訊控制 ─────────

  it("匯出 CSV 不會變成通知", async () => {
    const before = (await amySees()).length;
    const { count } = await exportTransactionsCsv(c.ctxB, EMPTY_FILTER);
    await recordExport(c.ctxB, { count, filter: EMPTY_FILTER });
    assert.equal(await prisma.auditLog.count({ where: { action: "EXPORT" } }), 1, "AuditLog 仍然記得住");
    assert.equal((await amySees()).length, before, "但不該出現在動態裡");
  });

  it("固定支出產生記帳只會有一則通知（不會 GENERATE 與 CREATE 各一則）", async () => {
    const r = await prisma.recurringExpense.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, name: "房租" } });
    const before = await amySees();
    await recurring.generateRecurring(c.ctxB, r.id, { today: D(10) });
    const added = (await amySees()).filter((x) => !before.some((b) => b.id === x.id));
    assert.equal(added.length, 1, `只該多一則，實際：${added.map((x) => x.text).join(" / ")}`);
    assert.equal(added[0].text, "阿本 新增了一筆支出");
  });

  it("系統自動產生的漏做懲罰不會被當成某個人做的事", async () => {
    const fund = await prisma.fund.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, name: "日本旅遊" } });
    await tasks.createTask(c.ctxB, {
      title: "會漏做的任務", description: "", emoji: "😴", scope: "PERSONAL", assigneeId: c.bId,
      frequency: "DAILY", daysOfWeek: 127, requiresApproval: false, requiresPhoto: false,
      rewardAmount: 0, fundId: fund.id, penaltyAmount: $(10), penaltyText: "", isActive: true, milestones: [],
    }, D(1));
    await tasks.applyMissedPenalties(c.ctxA, D(20));
    const penalties = await prisma.auditLog.count({ where: { action: "PENALTY" } });
    assert.ok(penalties > 0, "AuditLog 有記錄");
    assert.ok(!(await texts(await benSees())).some((t) => t.includes("漏做")), "但不會變成通知");
  });

  // ───────── 權限與隔離 ─────────

  it("跨帳本：看不到別的帳本的任何動態", async () => {
    await ledger.createTransaction(other.ctxB, {
      type: "EXPENSE", amount: $(9999), accountId: other.accB, categoryId: null, title: "別人的秘密消費",
      note: "", occurredOn: D(5), split: full(other.bId), clientRequestId: rid(),
    });
    const mine = await texts(await amySees());
    assert.ok(!mine.some((t) => t.includes("別人的秘密消費")));
    const theirs = await texts(await listActivity(other.ctxA));
    assert.ok(theirs.some((t) => t.includes("別人的秘密消費")));
    assert.ok(!theirs.some((t) => t.includes("阿本買的咖啡")));
  });

  it("唯讀成員看得到動態，而且不會因此多拿到東西", async () => {
    const readOnly = { ...c.ctxA, canWrite: false };
    const normal = await amySees();
    const limited = await listActivity(readOnly);
    assert.deepEqual(limited.map((x) => x.id), normal.map((x) => x.id));
    assert.deepEqual(limited.map((x) => x.href), normal.map((x) => x.href));
  });

  it("已離開帳本的人拿不到這個帳本的 context，自然讀不到動態", async () => {
    const { getBookContext } = await import("../../src/server/services/books");
    await prisma.bookMember.update({
      where: { bookId_userId: { bookId: c.ctxA.book.id, userId: c.bId } },
      data: { status: "LEFT" },
    });
    const ctx = await getBookContext(c.bId);
    assert.ok(!ctx || ctx.book.id !== c.ctxA.book.id, "離開後不該再拿到這個帳本");
    await prisma.bookMember.update({
      where: { bookId_userId: { bookId: c.ctxA.book.id, userId: c.bId } },
      data: { status: "ACTIVE" },
    });
  });

  it("不洩漏任何系統欄位", async () => {
    const json = JSON.stringify(await amySees());
    for (const bad of ["clientRequestId", "storageKey", "passwordHash", "payments", "splits", "accountId", "token", "session"]) {
      assert.ok(!json.includes(bad), `不該出現 ${bad}`);
    }
  });

  // ───────── 不影響財務 ─────────

  it("讀動態不會改動任何資料，也不影響統計與搜尋", async () => {
    const beforeStats = await monthStats(c.ctxA, MONTH);
    const beforeSearch = await searchTransactions(c.ctxA, EMPTY_FILTER, { take: 500 });
    const beforeSummary = await ledger.monthSummary(c.ctxA, NOW);
    const counts = await Promise.all([prisma.transaction.count(), prisma.auditLog.count(), prisma.attachment.count()]);

    await amySees();
    await benSees();

    assert.deepEqual(await Promise.all([prisma.transaction.count(), prisma.auditLog.count(), prisma.attachment.count()]), counts);
    assert.deepEqual((await monthStats(c.ctxA, MONTH)).totals, beforeStats.totals);
    assert.deepEqual((await searchTransactions(c.ctxA, EMPTY_FILTER, { take: 500 })).totals, beforeSearch.totals);
    assert.deepEqual(await ledger.monthSummary(c.ctxA, NOW), beforeSummary);
  });

  // ───────── 規模與效能 ─────────

  it("最多 50 筆、依時間新到舊，而且查詢數不會隨筆數增加（沒有 N+1）", async () => {
    // 再塞 120 筆對方的記帳
    const bulk = Array.from({ length: 120 }, (_, i) => ({
      bookId: c.ctxA.book.id, type: "EXPENSE" as const, occurredAt: new Date(`${D(14)}T12:00:00+08:00`),
      amount: $(10), title: `大量 ${i}`, clientRequestId: rid(), createdById: c.bId, updatedById: c.bId,
    }));
    await prisma.transaction.createMany({ data: bulk });
    const created = await prisma.transaction.findMany({ where: { bookId: c.ctxA.book.id, title: { startsWith: "大量 " } }, select: { id: true } });
    await prisma.auditLog.createMany({
      data: created.map((t) => ({
        bookId: c.ctxA.book.id, actorId: c.bId, action: "CREATE", entityType: "Transaction", entityId: t.id,
        after: { type: "EXPENSE", amount: $(10), title: "大量" },
      })),
    });

    const t0 = Date.now();
    const list = await listActivity(c.ctxA);
    const ms = Date.now() - t0;
    assert.equal(list.length, RECENT_LIMIT, "上限 50 筆");
    assert.ok(ms < 3000, `讀 50 筆動態花了 ${ms}ms`);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i - 1].at >= list[i].at, "要由新到舊");
    }
    // 每一筆都有日期分組用的 key
    assert.ok(list.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.dateKey)));
  });

  it("沒有動態時回空陣列（畫面才顯示 empty state）", async () => {
    const fresh = await setupCouple("empty");
    assert.deepEqual(await listActivity(fresh.ctxB), [], "只有自己建帳本時沒有別人的動態");
  });
});
