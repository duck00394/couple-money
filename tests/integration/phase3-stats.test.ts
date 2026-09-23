import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as tasks from "../../src/server/services/tasks";
import * as transfers from "../../src/server/services/transfers";
import * as recurring from "../../src/server/services/recurring";
import { searchTransactions } from "../../src/server/services/search";
import { monthStats, statsTrend } from "../../src/server/services/stats";
import { parseFilter } from "../../src/server/domain/search";
import { clampMonth, monthKeyRange, recentMonths } from "../../src/server/domain/stats";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
/** monthSummary 用「現在」決定月份，測試固定成同一個月才能對帳 */
const NOW = new Date(`${D(15)}T12:00:00+08:00`);

describe("Phase 3-4 A：統計與報表", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;
  let hotpot = "";
  let trip = "";
  let bBank = "";
  let foodCat = "";
  let funCat = "";
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const full = (userId: string) => ({ method: "FULL" as const, participants: [{ userId }] });
  const cat = async (name: string) => (await ledger.listCategories(c.ctxA)).find((x) => x.name === name)!.id;
  const stats = (ctx = c.ctxA, month = MONTH) => monthStats(ctx, month);

  before(async () => {
    await reset();
    c = await setupCouple("st");
    other = await setupCouple("ot");
    foodCat = await cat("餐飲");
    funCat = await cat("娛樂");

    // 收入 $30,000 進共同帳戶（受益人記在小艾身上）
    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(30000), accountId: c.joint, categoryId: null, title: "薪水",
      note: "", occurredOn: D(1), split: full(c.aId), clientRequestId: rid(),
    });
    // 小艾自己的帳戶付 $1,000，平分 → 我付 1000 / 我負擔 500
    hotpot = (await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1000), accountId: c.accA, categoryId: foodCat, title: "火鍋",
      note: "", occurredOn: D(5), split: eq(), clientRequestId: rid(),
    })).id;
    // 共同帳戶付 $600，平分 → 共同付 600 / 兩人各負擔 300
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(600), accountId: c.joint, categoryId: funCat, title: "電影",
      note: "", occurredOn: D(6), split: eq(), clientRequestId: rid(),
    });
    // 阿本付 $400，全部由阿本負擔
    await ledger.createTransaction(c.ctxB, {
      type: "EXPENSE", amount: $(400), accountId: c.accB, categoryId: funCat, title: "遊戲",
      note: "", occurredOn: D(7), split: full(c.bId), clientRequestId: rid(),
    });
    // 阿本的銀行帳戶（期初餘額，之後獎金入金要從這裡轉出；期初餘額不算收支）
    bBank = (await ledger.createAccount(c.ctxB, { name: "阿本銀行", type: "BANK", shared: false, openingBalance: $(20000) })).id;
    // 火鍋退款 $200 回小艾帳戶
    await transfers.createRefund(c.ctxA, {
      originalId: hotpot, amount: $(200), accountId: c.accA, occurredOn: D(8), note: "", clientRequestId: rid(),
    });
    // 轉帳：共同帳戶 → 小艾（不算收支、不產生負擔）
    await transfers.createTransfer(c.ctxA, {
      fromAccountId: c.joint, toAccountId: c.accA, amount: $(3000), occurredOn: D(9), note: "", clientRequestId: rid(),
    });
    // 結算：阿本還小艾 $100
    await ledger.settle(c.ctxB, {
      fromUserId: c.bId, toUserId: c.aId, amount: $(100),
      fromAccountId: c.accB, toAccountId: c.accA, note: "", clientRequestId: rid(),
    });
    // 基金：投入（不是 Transaction）＋ 基金支出（是真實支出）
    trip = (await funds.createFund(c.ctxA, { name: "日本旅遊", targetAmount: null, dueDate: null })).id;
    await funds.addFundEntry(c.ctxA, {
      fundId: trip, type: "DEPOSIT", amount: $(5000), userId: c.aId, accountId: c.joint,
      note: "", occurredOn: D(10), clientRequestId: rid(),
    });
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1200), accountId: c.joint, categoryId: await cat("旅行"), title: "機票訂金",
      note: "", occurredOn: D(11), split: eq(), clientRequestId: rid(), fundId: trip, fundAccountId: c.joint,
    });
    // 任務獎金：尚未入金（不是交易）→ 入金後是轉帳
    const t = await tasks.createTask(c.ctxA, {
      title: "英文", description: "", emoji: "📚", scope: "PERSONAL", assigneeId: c.aId,
      frequency: "DAILY", daysOfWeek: 127, requiresApproval: false, requiresPhoto: false,
      rewardAmount: $(50), fundId: trip, penaltyAmount: 0, penaltyText: "", isActive: true, milestones: [],
    }, D(12));
    await tasks.checkIn(c.ctxA, t.id, { today: D(12) });
    // 固定支出產生的交易（算一般支出）
    const r = await recurring.createRecurring(c.ctxA, {
      name: "房租", note: "", amount: $(15000), categoryId: await cat("居家"), accountId: c.joint,
      split: eq(), frequency: "MONTHLY", dayOfWeek: null, dayOfMonth: 13, month: null,
      startDate: D(13), endDate: null,
    }, D(13));
    await recurring.generateRecurring(c.ctxA, r.id, { today: D(13) });
    // 上個月與另一個帳本的資料（不該出現在本月統計）
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(777), accountId: c.accA, categoryId: foodCat, title: "上個月的早餐",
      note: "", occurredOn: "2026-08-20", split: eq(), clientRequestId: rid(),
    });
    await ledger.createTransaction(other.ctxA, {
      type: "EXPENSE", amount: $(9999), accountId: other.accA, categoryId: null, title: "別人的帳",
      note: "", occurredOn: D(5), split: full(other.aId), clientRequestId: rid(),
    });
  });
  after(() => prisma.$disconnect());

  // ───────── 與既有邏輯對帳（最重要：防止出現第二套財務規則）─────────

  it("對帳①：borne.me 與既有 monthSummary().myShare 完全相等", async () => {
    const s = await stats();
    const legacy = await ledger.monthSummary(c.ctxA, NOW);
    assert.equal(s.borne.me, legacy.myShare, "我的負擔必須與首頁同一個數字");
    assert.equal(s.totals.netExpense, legacy.expense, "淨支出必須與首頁同一個數字");
    assert.equal(s.totals.income, legacy.income);
    // 阿本那一邊也要對得起來
    const sb = await stats(c.ctxB);
    assert.equal(sb.borne.me, (await ledger.monthSummary(c.ctxB, NOW)).myShare);
  });

  it("對帳②：totals 與同期間 searchTransactions().totals 完全相等", async () => {
    const { from, to } = monthKeyRange(MONTH);
    const search = await searchTransactions(c.ctxA, parseFilter({ from, to }), { take: 500 });
    assert.deepEqual((await stats()).totals, search.totals);
  });

  // ───────── 規則 1／2／3 ─────────

  it("我的支出用 Split（負擔）、我的付款用 Payment（實際掏錢），兩者不同", async () => {
    const s = await stats();
    // 火鍋 $1,000 由小艾的帳戶付、平分
    const paidMinusBorne = s.paid.me - s.borne.me;
    assert.notEqual(paidMinusBorne, 0, "這份測試資料裡兩者本來就不該相同");
    // 阿本：付 400（遊戲）+ 100（結算不算收支，不進來）；負擔 400 + 300（電影）+ 600（房租一半）…
    assert.ok(s.paid.partner > 0 && s.borne.partner > 0);
  });

  it("共同帳戶支付獨立呈現，不會被硬分給任何一個人", async () => {
    const s = await stats();
    // 電影 600 + 機票 1200 + 房租 15000 = 16800 都由共同帳戶支付
    assert.equal(s.paid.joint, $(16800));
    // 但負擔側沒有「共同」，這些錢仍然分給兩個人
    assert.ok(s.borne.me > 0 && s.borne.partner > 0);
  });

  it("不變式：我付 + 另一半付 + 共同付 = 淨支出", async () => {
    const s = await stats();
    assert.equal(s.paid.me + s.paid.partner + s.paid.joint, s.totals.netExpense);
  });

  it("不變式：我負擔 + 另一半負擔 = 淨支出", async () => {
    const s = await stats();
    assert.equal(s.borne.me + s.borne.partner, s.totals.netExpense);
  });

  // ───────── 規則 4：各類型分開、沿用既有邏輯 ─────────

  it("轉帳不算收支、不進付款與負擔，只出現在轉帳統計", async () => {
    const s = await stats();
    assert.equal(s.totals.transferCount, 1, "只有那一筆帳戶間轉帳；結算是 SETTLEMENT，不算轉帳");
    assert.ok(s.totals.transferAmount >= $(3000));
    // 轉帳金額沒有混進淨支出
    assert.equal(s.paid.me + s.paid.partner + s.paid.joint, s.totals.netExpense);
  });

  it("結算不影響任何統計數字", async () => {
    const before = await stats();
    await ledger.settle(c.ctxB, {
      fromUserId: c.bId, toUserId: c.aId, amount: $(50),
      fromAccountId: c.accB, toAccountId: c.accA, note: "", clientRequestId: rid(),
    });
    const after = await stats();
    assert.deepEqual(
      { e: after.totals.netExpense, i: after.totals.income, p: after.paid, b: after.borne },
      { e: before.totals.netExpense, i: before.totals.income, p: before.paid, b: before.borne },
    );
  });

  it("期初餘額不算收支", async () => {
    const before = await stats();
    await ledger.createAccount(c.ctxA, { name: "小豬撲滿", type: "CASH", shared: false, openingBalance: $(8000) });
    const after = await stats();
    assert.equal(after.totals.netExpense, before.totals.netExpense);
    assert.equal(after.totals.income, before.totals.income);
    assert.equal(after.paid.me, before.paid.me);
  });

  it("退款同時沖銷淨支出、我的負擔與該分類金額；退款不算收入", async () => {
    const s = await stats();
    const food = s.categories.find((x) => x.categoryId === foodCat)!;
    assert.equal(food.amount, $(800), "火鍋 1000 − 退款 200");
    assert.equal(s.totals.refund, $(200));
    assert.ok(s.totals.income === $(30000), "退款沒有被算成收入");
    // 退款回到小艾帳戶 → 我的付款被沖銷
    assert.equal(s.paid.me, $(1000) - $(200));
  });

  it("基金投入不是交易，不會出現在統計；基金支出算一般支出且分類正確", async () => {
    const s = await stats();
    const travel = s.categories.find((x) => x.name === "旅行")!;
    assert.equal(travel.amount, $(1200), "基金支出就是真實支出");
    // 投入基金的 $5,000 沒有被算成支出
    assert.ok(!s.categories.some((x) => x.amount === $(5000)));
  });

  it("尚未入金的任務獎金不出現在統計；入金後算轉帳不算收支", async () => {
    const before = await stats();
    await funds.depositRewards(c.ctxB, {
      fundId: trip, targetAccountId: c.joint, sourceAccountId: bBank,
      note: "", occurredOn: D(14), clientRequestId: rid(),
    });
    const after = await stats();
    assert.equal(after.totals.netExpense, before.totals.netExpense, "入金不是支出");
    assert.equal(after.totals.income, before.totals.income, "入金不是收入");
    assert.equal(after.totals.transferCount, before.totals.transferCount + 1, "入金是轉帳");
  });

  it("固定支出產生的交易算一般支出", async () => {
    const s = await stats();
    const rent = s.categories.find((x) => x.name === "居家")!;
    assert.equal(rent.amount, $(15000));
  });

  // ───────── 邊界與隔離 ─────────

  it("月份邊界以帳本時區（台灣）為準", async () => {
    const late = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(11), accountId: c.accA, categoryId: null, title: "月底最後一筆",
      note: "", occurredOn: D(30), split: full(c.aId), clientRequestId: rid(),
    });
    // 直接把時間改成台灣 9/30 23:59（UTC 仍是 9/30 15:59）
    await prisma.transaction.update({ where: { id: late.id }, data: { occurredAt: new Date("2026-09-30T15:59:00Z") } });
    const sep = await stats();
    assert.ok(sep.categories.some((x) => x.categoryId === null), "9/30 23:59 算 9 月");

    // 台灣 10/1 00:00（UTC 9/30 16:00）→ 算 10 月
    await prisma.transaction.update({ where: { id: late.id }, data: { occurredAt: new Date("2026-09-30T16:00:00Z") } });
    const sep2 = await stats();
    assert.ok(!sep2.categories.some((x) => x.categoryId === null), "10/1 00:00 不算 9 月");
    const oct = await stats(c.ctxA, "2026-10");
    assert.equal(oct.totals.netExpense, $(11));
    await prisma.transaction.update({ where: { id: late.id }, data: { deletedAt: new Date(), deletedById: c.aId } });
  });

  it("已刪除與未過帳的交易不計入", async () => {
    const before = await stats();
    const tx = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(999), accountId: c.accA, categoryId: foodCat, title: "要刪掉的",
      note: "", occurredOn: D(5), split: eq(), clientRequestId: rid(),
    });
    assert.notEqual((await stats()).totals.netExpense, before.totals.netExpense);
    await ledger.deleteTransaction(c.ctxA, tx.id);
    assert.equal((await stats()).totals.netExpense, before.totals.netExpense, "軟刪除後要回復");
  });

  it("跨帳本隔離：別的帳本的交易與分類都進不來", async () => {
    const mine = await stats();
    const theirs = await monthStats(other.ctxA, MONTH);
    assert.equal(theirs.totals.netExpense, $(9999));
    assert.notEqual(mine.totals.netExpense, theirs.totals.netExpense);
    // 用別的帳本的 ctx 看不到我的分類
    assert.ok(!theirs.categories.some((x) => x.categoryId === foodCat));
    // 我的統計裡沒有對方的任何金額
    assert.ok(!mine.categories.some((x) => x.amount === $(9999)));
  });

  it("趨勢：中間沒有交易的月份是 0，不是缺列", async () => {
    const months = recentMonths(`${MONTH}-01`, 6);
    const trend = await statsTrend(c.ctxA, months);
    assert.deepEqual(trend.map((p) => p.month), months);
    assert.equal(trend.find((p) => p.month === "2026-07")!.netExpense, 0);
    assert.equal(trend.find((p) => p.month === "2026-08")!.netExpense, $(777));
    assert.equal(trend.find((p) => p.month === MONTH)!.netExpense, (await stats()).totals.netExpense);
  });

  it("無效的月份參數會回到本月，不會丟例外", async () => {
    const todayKey = "2026-09-17";
    for (const bad of ["", "2026-13", "abc", "2027-01", "2020-01", null, undefined]) {
      assert.equal(clampMonth(bad, todayKey), "2026-09");
    }
    await assert.doesNotReject(monthStats(c.ctxA, clampMonth("nonsense", todayKey)));
  });

  it("唯讀：讀統計不會寫入任何資料", async () => {
    const before = await Promise.all([prisma.auditLog.count(), prisma.transaction.count(), prisma.fundTransaction.count()]);
    await monthStats(c.ctxA, MONTH);
    await statsTrend(c.ctxA, recentMonths(`${MONTH}-01`, 6));
    await monthStats(c.ctxB, MONTH);
    const after = await Promise.all([prisma.auditLog.count(), prisma.transaction.count(), prisma.fundTransaction.count()]);
    assert.deepEqual(after, before, "統計不可以產生任何紀錄");
  });
});
