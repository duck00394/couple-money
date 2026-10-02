import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rid, reset, setupCouple, prisma } from "./helpers";
import * as books from "../../src/server/services/books";
import * as ledger from "../../src/server/services/ledger";
import * as transfers from "../../src/server/services/transfers";
import * as stats from "../../src/server/services/stats";
import { formatMoney } from "../../src/lib/money";

/**
 * V16：每筆交易鎖定當下的「本位幣 → 台幣」參考匯率。
 *
 * 要守住的那一條：
 *
 *   **在首頁把匯率改掉，只有之後新增的交易用新匯率；已經記過的那幾筆的台幣參考值不變。**
 *
 * 另一半同樣重要：這個參考值**不能滲進任何財務計算**。
 * 日圓帳本裡 ¥5,000 永遠是 ¥5,000 —— 分帳、欠款、結算、統計全部照既有的 domain 走，
 * 不會因為多了一個台幣參考值就變成一筆 NT$1,050 的交易。
 */
describe("V16：每筆交易鎖定當下匯率", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let jp: string;
  /** 日圓帳本裡小艾的錢包 */
  let acc: string;
  let tx1: string;
  let tx2: string;

  /** ¥5,000（金額一律是本位幣的 1/100） */
  const Y5000 = $(5000);

  const ctxJp = () => books.loadContext(c.aId, jp);

  const spend = async (title: string, amount = Y5000, day = "2026-11-02") => {
    const ctx = await ctxJp();
    return ledger.createTransaction(ctx, {
      type: "EXPENSE", amount, accountId: acc, categoryId: null, title, note: "", occurredOn: day,
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
      clientRequestId: rid(),
    });
  };

  const rateOf = async (id: string) => {
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    return { units: row.homeRateUnits, minor: row.homeRateMinor, amount: row.amount, currency: row.currency };
  };

  before(async () => {
    await reset();
    c = await setupCouple();
    // 日本旅遊：本位幣日圓，建立時的匯率 1 JPY = 0.21 TWD
    jp = (await books.createSecondaryBook(c.ctxA, c.aId, {
      name: "日本旅遊", type: "TRIP", baseCurrency: "JPY",
      homeRateUnits: 1, homeRateMinor: $(0.21),
    })).id;
    acc = (await ledger.listAccounts(await ctxJp())).find((a) => a.ownerId === c.aId)!.id;
  });
  after(() => prisma.$disconnect());

  /* ─────────── 1～2：記一筆，匯率跟著鎖上去 ─────────── */

  it("1、2：匯率 0.21 時記 ¥5,000 → 鎖住 0.21，台幣參考值 NT$1,050", async () => {
    tx1 = (await spend("居酒屋")).id;
    const r = await rateOf(tx1);
    assert.deepEqual({ units: r.units, minor: r.minor }, { units: 1, minor: 21 }, "沒有把匯率鎖在交易上");
    assert.equal(r.amount, Y5000, "正式金額必須是日圓的 ¥5,000");
    const ctx = await ctxJp();
    const sum = await ledger.monthSummary(ctx, new Date("2026-11-15T00:00:00Z"));
    assert.equal(sum.expense, Y5000);
    assert.equal(formatMoney(sum.homeExpense!, { symbol: "NT$" }), "NT$1,050");
  });

  /* ─────────── 3～4：改匯率，舊的不動 ─────────── */

  it("★ 3、4：把帳本匯率改成 0.22，舊那筆仍然鎖著 0.21 / NT$1,050", async () => {
    await books.setHomeRate(await ctxJp(), "0.22");
    const r = await rateOf(tx1);
    assert.deepEqual({ units: r.units, minor: r.minor }, { units: 1, minor: 21 }, "★ 舊交易的匯率被改掉了");
    assert.equal(r.amount, Y5000, "★ 舊交易的日圓金額被動到了");
    // 帳本上的設定確實已經變成 0.22
    assert.deepEqual((await ctxJp()).book.homeRate, { units: 1, minor: 22 });
  });

  /* ─────────── 5～7：新交易用新匯率，兩筆各自保留 ─────────── */

  it("★ 5、6、7：改完之後新記的 ¥5,000 用 0.22（NT$1,100），兩筆正式金額都是 ¥5,000", async () => {
    tx2 = (await spend("拉麵")).id;
    const [a, b] = [await rateOf(tx1), await rateOf(tx2)];
    assert.deepEqual({ units: a.units, minor: a.minor }, { units: 1, minor: 21 });
    assert.deepEqual({ units: b.units, minor: b.minor }, { units: 1, minor: 22 });
    assert.equal(a.amount, Y5000);
    assert.equal(b.amount, Y5000);
    assert.equal(a.currency, "JPY");
    assert.equal(b.currency, "JPY");
  });

  /* ─────────── 10：總額是兩筆各自換算再加總 ─────────── */

  it("★ 10：匯率再改成 0.23，台幣參考總額仍然是 NT$2,150（不是 NT$2,300）", async () => {
    await books.setHomeRate(await ctxJp(), "0.23");
    const ctx = await ctxJp();

    const sum = await ledger.monthSummary(ctx, new Date("2026-11-15T00:00:00Z"));
    assert.equal(sum.expense, Y5000 * 2, "正式金額應該是 ¥10,000");
    assert.equal(formatMoney(sum.homeExpense!, { symbol: "NT$" }), "NT$2,150", "★ 首頁本月花費被現在的匯率重算了");

    const ms = await stats.monthStats(ctx, "2026-11");
    assert.equal(ms.totals.netExpense, Y5000 * 2);
    assert.equal(formatMoney(ms.homeNetExpense!, { symbol: "NT$" }), "NT$2,150", "★ 統計頁被現在的匯率重算了");

    const bt = await stats.bookTotals(jp, ctx.book.homeRate);
    assert.equal(bt.expense, Y5000 * 2);
    assert.equal(formatMoney(bt.homeExpense!, { symbol: "NT$" }), "NT$2,150", "★ 帳本管理頁被現在的匯率重算了");
  });

  /* ─────────── 8、9：參考值不准滲進財務計算 ─────────── */

  it("★ 8：欠款與分帳一律用日圓，匯率改幾次都一樣", async () => {
    const ctx = await ctxJp();
    const bal = await ledger.getBalances(ctx);
    // 兩筆各 ¥5,000 平分，都是小艾付的 → 阿本欠小艾 ¥5,000
    assert.equal(bal.debts[0].amount, $(5000));
    assert.equal(bal.debts[0].from, c.bId);
    const before = bal.debts[0].amount;
    await books.setHomeRate(ctx, "0.9");
    const after = await ledger.getBalances(await ctxJp());
    assert.equal(after.debts[0].amount, before, "★ 改匯率把欠款改掉了");
    await books.setHomeRate(await ctxJp(), "0.23");
  });

  it("★ 8：結算也是日圓，結算完互不相欠", async () => {
    const ctx = await ctxJp();
    const accB = (await ledger.listAccounts(ctx)).find((a) => a.ownerId === c.bId)!.id;
    const ctxB = await books.loadContext(c.bId, jp);
    await ledger.settle(ctxB, {
      fromUserId: c.bId, toUserId: c.aId, amount: $(5000),
      fromAccountId: accB, toAccountId: acc, note: "", clientRequestId: rid(),
    });
    const bal = await ledger.getBalances(await ctxJp());
    assert.equal(bal.debts.length, 0, "結算完應該互不相欠");
  });

  it("★ 9：統計裡的正式日圓金額完全不受匯率影響", async () => {
    const before = (await stats.monthStats(await ctxJp(), "2026-11")).totals;
    await books.setHomeRate(await ctxJp(), "0.5");
    const after = (await stats.monthStats(await ctxJp(), "2026-11")).totals;
    assert.deepEqual(after, before, "★ 改匯率把統計的日圓金額改掉了");
    // 但台幣參考值仍然是用每一筆自己的匯率加總的，所以也沒變
    assert.equal(
      formatMoney((await stats.monthStats(await ctxJp(), "2026-11")).homeNetExpense!, { symbol: "NT$" }),
      "NT$2,150",
    );
    await books.setHomeRate(await ctxJp(), "0.23");
  });

  it("分帳的每一分錢都是日圓，沒有任何台幣混進 TransactionSplit", async () => {
    const splits = await prisma.transactionSplit.findMany({
      where: { transaction: { bookId: jp, deletedAt: null, type: "EXPENSE" } },
    });
    assert.equal(splits.length, 4, "兩筆消費各兩個人");
    // ¥5,000 平分 → 每人 ¥2,500。如果台幣參考值不小心滲進來，這裡會變成 105000 之類的數字
    for (const s of splits) assert.equal(s.amount, $(2500), "分帳金額應該是 ¥2,500（¥5,000 平分）");
    // 付款側同理：小艾付了兩筆 ¥5,000
    const pays = await prisma.transactionPayment.findMany({
      where: { transaction: { bookId: jp, deletedAt: null, type: "EXPENSE" } },
    });
    for (const p of pays) assert.equal(p.amount, Y5000);
  });

  /* ─────────── 退款 ─────────── */

  it("退款也鎖住當下的匯率，而且是從總額裡扣掉", async () => {
    await books.setHomeRate(await ctxJp(), "0.3");
    const ctx = await ctxJp();
    await transfers.createRefund(ctx, {
      originalId: tx2, amount: $(1000), accountId: acc,
      occurredOn: "2026-11-10", note: "", clientRequestId: rid(),
    });
    const row = await prisma.transaction.findFirstOrThrow({ where: { bookId: jp, type: "REFUND" } });
    assert.deepEqual({ units: row.homeRateUnits, minor: row.homeRateMinor }, { units: 1, minor: 30 });
    // NT$1,050 + NT$1,100 − (¥1,000 × 0.3 = NT$300) = NT$1,850
    const sum = await ledger.monthSummary(ctx, new Date("2026-11-15T00:00:00Z"));
    assert.equal(formatMoney(sum.homeExpense!, { symbol: "NT$" }), "NT$1,850");
    assert.equal(sum.expense, $(9000), "正式淨支出是 ¥9,000");
    await books.setHomeRate(await ctxJp(), "0.23");
  });

  /* ─────────── 9：匯率一路改，交易自己的東西都不動 ─────────── */

  it("★ 9：匯率 0.21 → 0.22 → 0.20 → 0.25，split 永遠是 ¥2,500／¥2,500、舊換算不變", async () => {
    const splitsOf = async (id: string) =>
      (await prisma.transactionSplit.findMany({ where: { transactionId: id }, orderBy: { userId: "asc" } })).map((x) => x.amount);
    const before1 = await rateOf(tx1);
    const before2 = await rateOf(tx2);
    assert.deepEqual(await splitsOf(tx1), [$(2500), $(2500)]);

    for (const r of ["0.21", "0.22", "0.20", "0.25"]) {
      await books.setHomeRate(await ctxJp(), r);
      // 正式金額與分帳：一分錢都不能動
      assert.deepEqual(await splitsOf(tx1), [$(2500), $(2500)], `匯率改成 ${r} 之後分帳變了`);
      assert.deepEqual(await splitsOf(tx2), [$(2500), $(2500)], `匯率改成 ${r} 之後分帳變了`);
      // 鎖住的匯率與金額：一樣不能動
      assert.deepEqual(await rateOf(tx1), before1, `★ 匯率改成 ${r} 之後舊交易的歷史換算變了`);
      assert.deepEqual(await rateOf(tx2), before2, `★ 匯率改成 ${r} 之後舊交易的歷史換算變了`);
    }

    // 這時候帳本的匯率是 0.25，新記的才用 0.25
    const fresh = await spend("匯率改完之後才記的", Y5000, "2026-11-20");
    const r = await rateOf(fresh.id);
    assert.deepEqual({ units: r.units, minor: r.minor }, { units: 1, minor: 25 });
    await prisma.transaction.update({ where: { id: fresh.id }, data: { deletedAt: new Date(), deletedById: c.aId } });
    await books.setHomeRate(await ctxJp(), "0.23");
  });

  /* ─────────── 10：編輯／作廢等其他路徑 ─────────── */

  it("★ 編輯交易不會把鎖住的匯率換成現在的（只有建立那一條路徑會寫這兩欄）", async () => {
    await books.setHomeRate(await ctxJp(), "0.99");
    const ctx = await ctxJp();
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx1 } });
    await ledger.updateTransaction(ctx, tx1, row.version, {
      type: "EXPENSE", amount: Y5000, accountId: acc, categoryId: null,
      title: "居酒屋（改過標題）", note: "", occurredOn: "2026-11-02",
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
    });
    const after = await rateOf(tx1);
    assert.deepEqual({ units: after.units, minor: after.minor }, { units: 1, minor: 21 }, "★ 編輯之後匯率被重鎖成現在的");
    assert.equal(after.amount, Y5000);
    await books.setHomeRate(await ctxJp(), "0.23");
  });

  it("編輯也不會幫舊資料補一個假的歷史匯率", async () => {
    const legacy = await spend("另一筆舊資料", $(2000), "2026-12-05");
    await prisma.transaction.update({ where: { id: legacy.id }, data: { homeRateUnits: null, homeRateMinor: null } });
    const ctx = await ctxJp();
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: legacy.id } });
    await ledger.updateTransaction(ctx, legacy.id, row.version, {
      type: "EXPENSE", amount: $(2000), accountId: acc, categoryId: null,
      title: "另一筆舊資料（改過）", note: "", occurredOn: "2026-12-05",
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
    });
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.equal(after.homeRateUnits, null, "編輯把舊資料補上了一個假的歷史匯率");
    assert.equal(after.homeRateMinor, null);
    await prisma.transaction.update({ where: { id: legacy.id }, data: { deletedAt: new Date(), deletedById: c.aId } });
  });

  it("作廢之後鎖住的匯率仍然留在那一列（之後要查稽核也還原得回來）", async () => {
    const t = await spend("等一下要作廢的", $(3000), "2026-12-06");
    await ledger.deleteTransaction(await ctxJp(), t.id);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } });
    assert.ok(row.deletedAt, "應該是作廢狀態");
    assert.deepEqual({ units: row.homeRateUnits, minor: row.homeRateMinor }, { units: 1, minor: 23 });
    // 而且作廢的那一筆不會算進台幣參考總額
    const sum = await ledger.monthSummary(await ctxJp(), new Date("2026-12-15T00:00:00Z"));
    assert.equal(sum.homeExpense, null, "作廢的交易不該被算進去");
  });

  it("結算、轉帳、調整這些不算收支的紀錄不帶也不需要台幣參考匯率", async () => {
    const rows = await prisma.transaction.findMany({
      where: { bookId: jp, type: { in: ["SETTLEMENT", "TRANSFER", "ADJUSTMENT", "OPENING_BALANCE"] } },
    });
    assert.ok(rows.length > 0, "前面應該已經結算過一次");
    for (const r of rows) {
      assert.equal(r.homeRateUnits, null);
      // 它們本來就不在「本月花費」的範圍裡（monthSummary 只收 EXPENSE / INCOME / REFUND）
      assert.ok(["SETTLEMENT", "TRANSFER", "ADJUSTMENT", "OPENING_BALANCE"].includes(r.type));
    }
  });

  /* ─────────── 11：台幣原帳本 ─────────── */

  it("11：台幣原帳本完全不受影響，沒有任何台幣參考值", async () => {
    const tx = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(500), accountId: c.accA, categoryId: null,
      title: "台幣消費", note: "", occurredOn: "2026-11-02",
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
      clientRequestId: rid(),
    });
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(row.homeRateUnits, null, "台幣帳本不該留下匯率");
    assert.equal(row.homeRateMinor, null);
    const sum = await ledger.monthSummary(c.ctxA, new Date("2026-11-15T00:00:00Z"));
    assert.equal(sum.expense, $(500));
    assert.equal(sum.homeExpense, null, "台幣帳本不該顯示「約 NT$」那一行");
    assert.equal((await stats.monthStats(c.ctxA, "2026-11")).homeNetExpense, null);
  });

  /* ─────────── 舊資料 ─────────── */

  it("舊資料（沒有鎖匯率）不會壞掉：退回帳本目前的匯率，不會被回填", async () => {
    const legacy = await spend("沒有鎖匯率的舊資料", $(1000), "2026-12-01");
    // 模擬 migration 之前就存在的那些交易
    await prisma.transaction.update({ where: { id: legacy.id }, data: { homeRateUnits: null, homeRateMinor: null } });
    const sum = await ledger.monthSummary(await ctxJp(), new Date("2026-12-15T00:00:00Z"));
    // ¥1,000 ＠ 目前的 0.23 → NT$230
    assert.equal(formatMoney(sum.homeExpense!, { symbol: "NT$" }), "NT$230");
    // 而且沒有被寫回資料庫（不偽造歷史匯率）
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.equal(row.homeRateUnits, null, "舊資料被回填了一個假的歷史匯率");
  });
});
