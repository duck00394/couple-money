import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as rates from "../../src/server/services/rates";
import * as budgets from "../../src/server/services/budgets";
import * as transfers from "../../src/server/services/transfers";
import * as search from "../../src/server/services/search";
import { accountBalances, netPositions } from "../../src/server/domain/balance";
import { EMPTY_FILTER } from "../../src/server/domain/search";

const D = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;

/**
 * V14：多幣別＋自訂匯率。
 *
 * 貫穿全部的那一條規則：
 *
 *   **匯率是交易發生時的資料。改匯率設定只影響之後的新交易，歷史交易一毛都不能變。**
 *
 * 規格點 23 列的 Case 1～9 都在這裡（Case 10 的「Demo 不寫 DB」在 V13 那支）。
 */
describe("V14：多幣別與自訂匯率", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;

  /** 記一筆外幣消費（兩人平分） */
  const spend = (opts: { amount?: number; currency?: string; foreign?: number; day?: number; title?: string; rule?: "EQUAL" | "A" | "B" }) =>
    ledger.createTransaction(c.ctxA, {
      type: "EXPENSE",
      amount: opts.amount ?? 0,
      currency: opts.currency ?? null,
      foreignAmount: opts.foreign ?? null,
      accountId: c.accA,
      categoryId: null,
      title: opts.title ?? "測試",
      note: "",
      occurredOn: D(opts.day ?? 10),
      split:
        opts.rule === "A"
          ? { method: "FULL", participants: [{ userId: c.aId }] }
          : opts.rule === "B"
            ? { method: "FULL", participants: [{ userId: c.bId }] }
            : { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
      clientRequestId: rid(),
    });

  before(async () => {
    await reset();
    c = await setupCouple();
    // 100 JPY = 21.5 TWD
    await rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 100, baseMinor: $(21.5) });
    // 1 USD = 31.2 TWD
    await rates.setRate(c.ctxA, { currency: "USD", foreignUnits: 1, baseMinor: $(31.2) });
  });
  after(() => prisma.$disconnect());

  /* ───────────────────────── 基本換算 ───────────────────────── */

  it("Case 1：TWD 500 就是 500 TWD，不留任何外幣欄位", async () => {
    const tx = await spend({ amount: $(500), title: "台幣消費" });
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(row.amount, $(500));
    assert.equal(row.currency, "TWD");
    assert.equal(row.foreignAmount, null, "本位幣不該留原幣金額");
    assert.equal(row.rateForeignUnits, null);
    assert.equal(row.rateBaseMinor, null);
  });

  it("Case 2：2,500 JPY ＠ 100 JPY = 21.5 TWD → 537.50 TWD，匯率一起鎖起來", async () => {
    const tx = await spend({ currency: "JPY", foreign: 2500, title: "日本晚餐" });
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(row.amount, 53750, "本位幣金額應為 NT$537.50");
    assert.equal(row.currency, "JPY");
    assert.equal(row.foreignAmount, 2500);
    assert.equal(row.rateForeignUnits, 100);
    assert.equal(row.rateBaseMinor, 2150);
  });

  it("精度保留到分（不是只存四捨五入後的 538）", async () => {
    const tx = await spend({ currency: "JPY", foreign: 2500, title: "精度" });
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(row.amount % 100, 50, `NT$537.50 的 0.5 被吃掉了（amount = ${row.amount}）`);
  });

  it("前端送來的 amount 完全不算數：外幣一律由原幣 × 匯率重算", async () => {
    // 故意送一個亂七八糟的 amount
    const tx = await spend({ amount: $(999999), currency: "JPY", foreign: 2500, title: "亂送" });
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(row.amount, 53750, "server 採信了前端送來的金額");
  });

  it("沒設定匯率的幣別會被擋下來（而不是偷偷用 1:1）", async () => {
    await rejects(spend({ currency: "EUR", foreign: 1000 }), "RATE_MISSING");
  });

  it("不支援的幣別代碼會被擋下來", async () => {
    await rejects(spend({ currency: "XXX", foreign: 1000 }), "RATE_CURRENCY");
  });

  it("外幣金額必須大於 0", async () => {
    await rejects(spend({ currency: "JPY", foreign: 0 }), "TX_AMOUNT");
    await rejects(spend({ currency: "JPY", foreign: -500 }), "TX_AMOUNT");
  });

  /* ───────────────────────── 最重要的一條 ───────────────────────── */

  it("Case 3 + 4：改匯率只影響新交易，舊交易一毛都不變", async () => {
    const before = await spend({ currency: "JPY", foreign: 2500, title: "改匯率前" });
    const beforeRow = await prisma.transaction.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(beforeRow.amount, 53750);

    // 把 JPY 改成 100 JPY = 22 TWD
    await rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 100, baseMinor: $(22) });

    // 舊的那筆：金額與匯率都不能動
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(after.amount, 53750, "歷史交易的金額被改匯率影響了");
    assert.equal(after.rateBaseMinor, 2150, "歷史交易的匯率被覆蓋了");

    // 新的那筆：用新匯率 → 2500 × 22 ÷ 100 = 550
    const fresh = await spend({ currency: "JPY", foreign: 2500, title: "改匯率後" });
    const freshRow = await prisma.transaction.findUniqueOrThrow({ where: { id: fresh.id } });
    assert.equal(freshRow.amount, 55000);
    assert.equal(freshRow.rateBaseMinor, 2200);

    // 改回去，後面的測試繼續用 21.5
    await rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 100, baseMinor: $(21.5) });
    const stillOld = await prisma.transaction.findUniqueOrThrow({ where: { id: fresh.id } });
    assert.equal(stillOld.amount, 55000, "改回去又把那筆 550 改掉了");
  });

  it("刪掉匯率設定也不會動到已經記過的交易", async () => {
    await rates.setRate(c.ctxA, { currency: "THB", foreignUnits: 1, baseMinor: $(0.92) });
    const tx = await spend({ currency: "THB", foreign: $(100), title: "泰國" });
    const amount = (await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).amount;
    await rates.removeRate(c.ctxA, "THB");
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(after.amount, amount);
    assert.equal(after.rateBaseMinor, 92);
    // 但新的就記不了了
    await rejects(spend({ currency: "THB", foreign: $(100) }), "RATE_MISSING");
  });

  /* ───────────────────────── 分帳與欠款 ───────────────────────── */

  it("Case 5：JPY 共同分帳 —— 分錄是本位幣，加總對得上", async () => {
    const tx = await spend({ currency: "JPY", foreign: 10000, title: "共同日本消費" });
    const row = await prisma.transaction.findUniqueOrThrow({
      where: { id: tx.id },
      include: { payments: true, splits: true },
    });
    // ¥10,000 ＠ 21.5/100 = NT$2,150
    assert.equal(row.amount, $(2150));
    assert.equal(row.splits.length, 2);
    assert.equal(
      row.splits.reduce((a, s) => a + s.amount, 0),
      row.payments.reduce((a, p) => a + p.amount, 0),
      "Σpayment !== Σsplit",
    );
    for (const s of row.splits) assert.equal(s.amount, $(1075), "沒有平分");
  });

  it("Case 6：JPY A 付款、B 全額負擔 → 欠款是換算後的本位幣", async () => {
    await reset();
    c = await setupCouple();
    await rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 100, baseMinor: $(21.5) });
    await spend({ currency: "JPY", foreign: 10000, title: "幫 B 買的", rule: "B" });

    const txs = await prisma.transaction.findMany({
      where: { bookId: c.ctxA.book.id, deletedAt: null },
      include: { payments: true, splits: true },
    });
    const net = netPositions(
      txs.map((t) => ({ type: t.type, payments: t.payments, splits: t.splits })),
      [c.aId, c.bId],
    );
    assert.equal(net.get(c.aId), $(2150), "A 應該被欠 NT$2,150");
    assert.equal(net.get(c.bId), -$(2150));
    assert.equal([...net.values()].reduce((a, b) => a + b, 0), 0, "欠款不是零和");
  });

  it("帳戶餘額用的是換算後的本位幣（沒有混到日圓數字）", async () => {
    const txs = await prisma.transaction.findMany({
      where: { bookId: c.ctxA.book.id, deletedAt: null },
      include: { payments: true, splits: true },
    });
    const bal = accountBalances(txs.map((t) => ({ type: t.type, payments: t.payments, splits: t.splits })));
    // A 付了 ¥10,000 = NT$2,150，所以餘額是 −2150（期初為 0）
    assert.equal(bal.get(c.accA), -$(2150));
  });

  /* ───────────────────────── 編輯與退款 ───────────────────────── */

  it("編輯外幣交易會用現在的匯率重新鎖一次（使用者正在重新輸入這筆）", async () => {
    await reset();
    c = await setupCouple();
    await rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 100, baseMinor: $(21.5) });
    const tx = await spend({ currency: "JPY", foreign: 2500, title: "原本" });

    await rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 100, baseMinor: $(22) });
    await ledger.updateTransaction(c.ctxA, tx.id, 1, {
      type: "EXPENSE", amount: 0, currency: "JPY", foreignAmount: 2500,
      accountId: c.accA, categoryId: null, title: "編輯後", note: "", occurredOn: D(10),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
    });
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(row.amount, 55000, "編輯後應該用新匯率");
    assert.equal(row.rateBaseMinor, 2200);
  });

  it("外幣交易改成台幣後，外幣欄位會被清掉（不留下對不起來的殘留）", async () => {
    const tx = await spend({ currency: "JPY", foreign: 2500, title: "要改成台幣" });
    await ledger.updateTransaction(c.ctxA, tx.id, 1, {
      type: "EXPENSE", amount: $(300), currency: "TWD", foreignAmount: null,
      accountId: c.accA, categoryId: null, title: "改成台幣", note: "", occurredOn: D(10),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
    });
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(row.amount, $(300));
    assert.equal(row.foreignAmount, null);
    assert.equal(row.rateForeignUnits, null);
    assert.equal(row.rateBaseMinor, null);
  });

  it("Case 7：JPY 退款 —— 退款用自己當下的匯率，沖銷的是本位幣", async () => {
    await reset();
    c = await setupCouple();
    await rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 100, baseMinor: $(21.5) });
    const original = await spend({ currency: "JPY", foreign: 5000, title: "買了又退" });
    const originalAmount = (await prisma.transaction.findUniqueOrThrow({ where: { id: original.id } })).amount;
    assert.equal(originalAmount, $(1075)); // ¥5,000 = NT$1,075

    // 退 ¥2,000 的部分。退款金額走既有 domain，單位是**本位幣**：
    // ¥2,000 ＠ 100 JPY = 21.5 TWD → NT$430
    const refundBase = (2000 * 2150) / 100; // = 43000 = NT$430
    const refund = await transfers.createRefund(c.ctxA, {
      originalId: original.id, amount: refundBase, accountId: c.accA,
      occurredOn: D(12), occurredTime: null, note: "", clientRequestId: rid(),
    });
    const r = await prisma.transaction.findUniqueOrThrow({ where: { id: refund.id } });
    assert.equal(r.amount, refundBase);
    // 原交易的金額完全沒被動到
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(after.amount, originalAmount);
    assert.equal(after.foreignAmount, 5000);
  });

  /* ───────────────────────── 統計與預算 ───────────────────────── */

  it("Case 9：統計同時包含 TWD + JPY + USD，全部用各自鎖定的匯率加總", async () => {
    await reset();
    c = await setupCouple();
    await rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 100, baseMinor: $(21.5) });
    await rates.setRate(c.ctxA, { currency: "USD", foreignUnits: 1, baseMinor: $(31.2) });

    await spend({ amount: $(8000), title: "台幣" });                       // 8,000
    await spend({ currency: "JPY", foreign: 12000, title: "日圓" });        // ¥12,000 = 2,580
    await spend({ currency: "USD", foreign: $(50), title: "美金" });        // $50 = 1,560

    const { totals } = await search.searchTransactions(c.ctxA, EMPTY_FILTER, { take: 100 });
    assert.equal(totals.netExpense, $(8000) + $(2580) + $(1560), "多幣別統計加總不對");

    // 明細裡看得到各自的原幣（規格點 12）
    const rows = await prisma.transaction.findMany({
      where: { bookId: c.ctxA.book.id, deletedAt: null, type: "EXPENSE" },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(rows.map((r) => r.currency), ["TWD", "JPY", "USD"]);
    assert.deepEqual(rows.map((r) => r.foreignAmount), [null, 12000, 5000]);
  });

  it("預算吃的是交易當下換算好的金額（不會用現在的匯率重算）", async () => {
    const cat = (await ledger.listCategories(c.ctxA)).find((x) => x.kind === "EXPENSE")!;
    await spend({ currency: "JPY", foreign: 10000, title: "有分類的日圓", day: 5 });
    await prisma.transaction.updateMany({ where: { title: "有分類的日圓" }, data: { categoryId: cat.id } });
    await budgets.createBudget(c.ctxA, { categoryId: cat.id, month: "2026-10", amount: $(10000) });

    const spentOf = async () => {
      const o = await budgets.budgetOverview(c.ctxA, "2026-10");
      return o.groups.find((g) => g.categoryId === cat.id)!.spent;
    };
    const spent = await spentOf();
    assert.equal(spent, $(2150), "預算的已支出應該是換算後的台幣");

    // 改匯率之後，預算的已支出不該變
    await rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 100, baseMinor: $(30) });
    assert.equal(await spentOf(), spent, "預算的已支出被改匯率影響了");
    await rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 100, baseMinor: $(21.5) });
  });

  /* ───────────────────────── 匯率設定本身 ───────────────────────── */

  it("本位幣不能設定匯率", async () => {
    await rejects(rates.setRate(c.ctxA, { currency: "TWD", foreignUnits: 1, baseMinor: 100 }), "RATE_BASE");
  });

  it("不合法的匯率會被擋下來", async () => {
    await rejects(rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 0, baseMinor: 100 }), "RATE_UNITS");
    await rejects(rates.setRate(c.ctxA, { currency: "JPY", foreignUnits: 100, baseMinor: 0 }), "RATE_VALUE");
  });

  it("同一個幣別重複設定是更新而不是新增一列", async () => {
    await rates.setRate(c.ctxA, { currency: "KRW", foreignUnits: 1000, baseMinor: $(23.4) });
    await rates.setRate(c.ctxA, { currency: "KRW", foreignUnits: 1000, baseMinor: $(24) });
    const rows = await prisma.exchangeRate.findMany({ where: { bookId: c.ctxA.book.id, currency: "KRW" } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].baseMinor, $(24));
  });

  it("另一半看得到同一份匯率設定", async () => {
    const mine = await rates.listRates(c.ctxA);
    const theirs = await rates.listRates(c.ctxB);
    assert.deepEqual(theirs, mine);
  });

  /* ───────────────────────── Case 8：舊資料相容 ───────────────────────── */

  it("Case 8：沒有外幣欄位的舊資料照常運作，視為本位幣、匯率 1", async () => {
    await reset();
    c = await setupCouple();
    const tx = await spend({ amount: $(500), title: "舊資料" });

    // 模擬 migration 之前就存在的列：外幣欄位全部是 NULL
    await prisma.$executeRawUnsafe(
      `UPDATE "Transaction" SET "foreignAmount" = NULL, "rateForeignUnits" = NULL, "rateBaseMinor" = NULL WHERE id = $1`,
      tx.id,
    );

    const row = await prisma.transaction.findUniqueOrThrow({
      where: { id: tx.id },
      include: { payments: true, splits: true },
    });
    assert.equal(row.amount, $(500), "舊資料的金額變了");
    assert.equal(row.foreignAmount, null);

    // 餘額、欠款、統計都還是正常的
    const bal = accountBalances([{ type: row.type, payments: row.payments, splits: row.splits }]);
    assert.equal(bal.get(c.accA), -$(500));
    const { totals } = await search.searchTransactions(c.ctxA, EMPTY_FILTER, { take: 100 });
    assert.equal(totals.netExpense, $(500));

    // 而且還可以正常編輯（不會因為缺欄位炸掉）
    await ledger.updateTransaction(c.ctxA, tx.id, 1, {
      type: "EXPENSE", amount: $(600), accountId: c.accA, categoryId: null,
      title: "舊資料編輯後", note: "", occurredOn: D(10),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
    });
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).amount, $(600));
  });

  it("本位幣預設是 TWD，既有帳本不受影響", async () => {
    assert.equal(c.ctxA.book.baseCurrency, "TWD");
  });
});
