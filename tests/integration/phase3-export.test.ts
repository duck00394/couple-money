import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as transfers from "../../src/server/services/transfers";
import * as receipts from "../../src/server/services/receipts";
import { searchTransactions } from "../../src/server/services/search";
import { monthStats } from "../../src/server/services/stats";
import { exportTransactionsCsv, recordExport, EXPORT_LIMIT } from "../../src/server/services/export";
import { EMPTY_FILTER, parseFilter } from "../../src/server/domain/search";
import { CSV_BOM } from "../../src/server/domain/csv";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
const NOW = new Date(`${D(15)}T12:00:00+08:00`);

/** 很小的 CSV 解析（夠用來驗欄位；引號內的逗號與換行都要正確處理）。 */
function parseCsv(csv: string): string[][] {
  const text = csv.startsWith(CSV_BOM) ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const png = (name: string) =>
  new File([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56, 3)])], name, { type: "image/png" });

describe("Phase 3-4 G：CSV 匯出", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;
  let bank = "";
  let hotpot = "";
  let adjustmentId = "";
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const full = (userId: string) => ({ method: "FULL" as const, participants: [{ userId }] });
  const cat = async (name: string) => (await ledger.listCategories(c.ctxA)).find((x) => x.name === name)!.id;

  /** 匯出並解析成「標題 → 值」的物件陣列。 */
  async function rows(ctx = c.ctxA, params: Record<string, string> = {}) {
    const { csv } = await exportTransactionsCsv(ctx, parseFilter(params));
    const [headers, ...body] = parseCsv(csv);
    return body.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])) as Record<string, string>);
  }
  const byTitle = (list: Record<string, string>[], title: string) => list.find((r) => r["名稱"] === title)!;
  const byId = (list: Record<string, string>[], id: string) => list.find((r) => r["交易ID"] === id)!;
  /** /stats 的「誰掏錢／誰負擔」只看支出與退款，CSV 要用同樣的範圍比較 */
  const isFlow = (r: Record<string, string>) => r["類型"].startsWith("支出") || r["類型"] === "退款";

  before(async () => {
    await reset();
    c = await setupCouple("ex");
    other = await setupCouple("ot");
    bank = (await ledger.createAccount(c.ctxA, { name: "小艾銀行", type: "BANK", shared: false, openingBalance: $(20000) })).id;

    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(30000), accountId: c.joint, categoryId: null, title: "薪水",
      note: "九月", occurredOn: D(1), split: full(c.aId), clientRequestId: rid(),
    });
    hotpot = (await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1000), accountId: bank, categoryId: await cat("餐飲"), title: "火鍋",
      note: "王品, 台北\n二樓", occurredOn: D(5), split: eq(), clientRequestId: rid(), tags: ["約會", "晚餐"],
    })).id;
    await ledger.createTransaction(c.ctxB, {
      type: "EXPENSE", amount: $(400), accountId: c.accB, categoryId: await cat("娛樂"), title: "遊戲",
      note: "", occurredOn: D(7), split: full(c.bId), clientRequestId: rid(),
    });
    await transfers.createRefund(c.ctxA, {
      originalId: hotpot, amount: $(200), accountId: bank, occurredOn: D(8), note: "少送一份", clientRequestId: rid(),
    });
    await transfers.createTransfer(c.ctxA, {
      fromAccountId: bank, toAccountId: c.joint, amount: $(3000), occurredOn: D(9), note: "補共同帳戶", clientRequestId: rid(),
    });
    await ledger.settle(c.ctxB, {
      fromUserId: c.bId, toUserId: c.aId, amount: $(100),
      fromAccountId: c.accB, toAccountId: bank, note: "", clientRequestId: rid(),
    });
    const fund = await funds.createFund(c.ctxA, { name: "日本旅遊", targetAmount: null, dueDate: null });
    await funds.addFundEntry(c.ctxA, {
      fundId: fund.id, type: "DEPOSIT", amount: $(5000), userId: c.aId, accountId: c.joint,
      note: "", occurredOn: D(10), clientRequestId: rid(),
    });
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1200), accountId: c.joint, categoryId: await cat("旅行"), title: "機票訂金",
      note: "", occurredOn: D(11), split: eq(), clientRequestId: rid(), fundId: fund.id, fundAccountId: c.joint,
    });
    adjustmentId = (await ledger.adjustAccountBalance(c.ctxA, {
      accountId: bank, targetBalance: $(12345), note: "對帳", occurredOn: D(12), clientRequestId: rid(),
    })).id;
    // 上個月與另一個帳本
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(777), accountId: bank, categoryId: await cat("餐飲"), title: "上個月早餐",
      note: "", occurredOn: "2026-08-20", split: eq(), clientRequestId: rid(),
    });
    await ledger.createTransaction(other.ctxA, {
      type: "EXPENSE", amount: $(9999), accountId: other.accA, categoryId: null, title: "別人的帳",
      note: "", occurredOn: D(5), split: full(other.aId), clientRequestId: rid(),
    });
  });
  after(() => prisma.$disconnect());

  // ───────── 欄位正確 ─────────

  it("標題含必要欄位，兩個人的付款與負擔各有一欄", async () => {
    const { csv } = await exportTransactionsCsv(c.ctxA, EMPTY_FILTER);
    const [headers] = parseCsv(csv);
    for (const h of ["交易ID", "日期", "時間", "類型", "算收支", "金額", "收支金額", "分類", "名稱", "備註", "標籤", "付款帳戶", "對方帳戶", "付款人", "基金", "固定支出", "關聯交易ID", "收據張數", "狀態", "建立時間", "更新時間"]) {
      assert.ok(headers.includes(h), `缺少欄位 ${h}`);
    }
    assert.ok(headers.includes("小艾付款") && headers.includes("阿本付款") && headers.includes("共同帳戶付款"));
    assert.ok(headers.includes("小艾負擔") && headers.includes("阿本負擔"));
    // 不可以外洩系統欄位
    for (const bad of ["storageKey", "passwordHash", "clientRequestId", "token", "session"]) {
      assert.ok(!csv.includes(bad), `不該出現 ${bad}`);
    }
  });

  it("支出：金額為正、收支金額為負，付款與負擔都正確", async () => {
    const r = byId(await rows(), hotpot); // 退款沿用原名稱，所以用 id 取
    assert.equal(r["交易ID"], hotpot);
    assert.equal(r["日期"], D(5));
    assert.equal(r["類型"], "支出");
    assert.equal(r["算收支"], "是");
    assert.equal(r["金額"], "1000.00");
    assert.equal(r["收支金額"], "-1000.00", "支出要是負的，SUM 這欄才等於淨收支");
    assert.equal(r["分類"], "餐飲");
    assert.equal(r["備註"], "王品, 台北\n二樓", "逗號與換行都要還原得回來");
    assert.equal(r["標籤"], "約會 晚餐");
    assert.equal(r["付款帳戶"], "小艾・小艾銀行");
    assert.equal(r["付款人"], "小艾");
    assert.equal(r["小艾付款"], "1000.00");
    assert.equal(r["阿本付款"], "0.00");
    assert.equal(r["小艾負擔"], "500.00");
    assert.equal(r["阿本負擔"], "500.00");
    assert.equal(r["狀態"], "POSTED");
    assert.equal(r["對方帳戶"], "");
  });

  it("收入：收支金額為正、付款欄位是負的（錢流進來）", async () => {
    const r = byTitle(await rows(), "薪水");
    assert.equal(r["類型"], "收入");
    assert.equal(r["收支金額"], "30000.00");
    assert.equal(r["共同帳戶付款"], "-30000.00");
    assert.equal(r["小艾負擔"], "-30000.00", "收入的負擔是負的（受益）");
  });

  it("退款：算收支、收支金額為正，並指回原始消費", async () => {
    const list = await rows();
    const r = list.find((x) => x["類型"] === "退款")!;
    assert.equal(r["算收支"], "是");
    assert.equal(r["收支金額"], "200.00");
    assert.equal(r["關聯交易ID"], hotpot);
    assert.equal(r["小艾負擔"], "-100.00");
  });

  it("轉帳與結算：不算收支、收支金額 0，且看得到對方帳戶", async () => {
    const list = await rows();
    const transfer = list.find((x) => x["類型"] === "轉帳")!;
    assert.equal(transfer["算收支"], "否");
    assert.equal(transfer["收支金額"], "0.00");
    assert.equal(transfer["付款帳戶"], "小艾・小艾銀行");
    assert.ok(transfer["對方帳戶"].includes("共同帳戶"), transfer["對方帳戶"]);
    assert.equal(transfer["小艾負擔"], "0.00", "轉帳沒有分帳");

    const settle = list.find((x) => x["類型"] === "結算")!;
    assert.equal(settle["算收支"], "否");
    assert.equal(settle["收支金額"], "0.00");
    assert.ok(settle["對方帳戶"].length > 0);
  });

  it("餘額調整看得出來，而且不會被當成一般消費", async () => {
    const list = await rows();
    const r = list.find((x) => x["交易ID"] === adjustmentId)!;
    assert.equal(r["類型"], "餘額調整");
    assert.equal(r["算收支"], "否");
    assert.equal(r["收支金額"], "0.00");
    assert.equal(r["分類"], "", "餘額調整沒有分類，不會混進消費分類");
    assert.equal(r["備註"], "對帳");
    // 期初餘額同樣不算收支
    const opening = list.find((x) => x["類型"] === "期初餘額")!;
    assert.equal(opening["算收支"], "否");
    assert.equal(opening["收支金額"], "0.00");
  });

  it("基金支出與固定支出在類型或欄位上看得出來", async () => {
    const r = byTitle(await rows(), "機票訂金");
    assert.equal(r["類型"], "支出（基金支出）");
    assert.equal(r["基金"], "日本旅遊");
    assert.equal(r["算收支"], "是", "基金支出仍然是真實支出");
  });

  it("收據張數是數字，不會塞入圖片或路徑", async () => {
    await receipts.addReceipt(c.ctxA, hotpot, png("r1.png"));
    await receipts.addReceipt(c.ctxA, hotpot, png("r2.png"));
    const r = byId(await rows(), hotpot);
    assert.equal(r["收據張數"], "2");
    const { csv } = await exportTransactionsCsv(c.ctxA, EMPTY_FILTER);
    assert.ok(!csv.includes(".png"), "不該出現檔名或路徑");
    assert.ok(!csv.includes("/api/files/"));
  });

  // ───────── 口徑一致 ─────────

  it("收支金額加總 = /stats 的淨收支，也 = 搜尋的 totals", async () => {
    const list = await rows(c.ctxA, { from: D(1), to: D(30) });
    const sum = list.reduce((a, r) => a + Math.round(Number(r["收支金額"]) * 100), 0);
    const stats = await monthStats(c.ctxA, MONTH);
    assert.equal(sum, stats.totals.income - stats.totals.netExpense, "SUM(收支金額) = 收入 − 淨支出");
    const search = await searchTransactions(c.ctxA, parseFilter({ from: D(1), to: D(30) }), { take: 500 });
    assert.equal(list.length, search.totals.count, "筆數與搜尋頁一致");
    // 付款與負擔也要對得起來（/stats 的這兩組只看支出與退款，收入不算「負擔」）
    const flows = list.filter(isFlow);
    const col = (name: string) => flows.reduce((a, r) => a + Math.round(Number(r[name]) * 100), 0);
    assert.equal(col("小艾負擔"), stats.borne.me);
    assert.equal(col("阿本負擔"), stats.borne.partner);
    assert.equal(col("小艾付款"), stats.paid.me);
    assert.equal(col("共同帳戶付款"), stats.paid.joint);
  });

  // ───────── 篩選 ─────────

  it("日期篩選：只匯出區間內的紀錄", async () => {
    const september = await rows(c.ctxA, { from: D(1), to: D(30) });
    assert.ok(!september.some((r) => r["名稱"] === "上個月早餐"));
    const august = await rows(c.ctxA, { from: "2026-08-01", to: "2026-08-31" });
    assert.deepEqual(august.map((r) => r["名稱"]), ["上個月早餐"]);
  });

  it("搜尋篩選：沿用記帳頁的條件（關鍵字、類型、分類、帳戶、標籤）", async () => {
    assert.deepEqual((await rows(c.ctxA, { q: "火鍋" })).map((r) => r["名稱"]).sort(), ["火鍋", "火鍋"], "退款沿用原名稱");
    assert.deepEqual((await rows(c.ctxA, { kind: "ADJUSTMENT" })).map((r) => r["交易ID"]), [adjustmentId]);
    assert.deepEqual((await rows(c.ctxA, { tag: "約會" })).map((r) => r["名稱"]), ["火鍋"]);
    const byCat = await rows(c.ctxA, { category: await cat("娛樂") });
    assert.deepEqual(byCat.map((r) => r["名稱"]), ["遊戲"]);
    // 匯出的筆數與搜尋頁顯示的筆數一致
    const cases: Record<string, string>[] = [{ q: "火鍋" }, { kind: "EXPENSE" }, { from: D(1), to: D(9) }];
    for (const params of cases) {
      const exported = await rows(c.ctxA, params);
      const searched = await searchTransactions(c.ctxA, parseFilter(params), { take: 500 });
      assert.equal(exported.length, searched.totals.count, JSON.stringify(params));
    }
  });

  it("空結果只會有標題列，不會壞掉", async () => {
    const { csv, count } = await exportTransactionsCsv(c.ctxA, parseFilter({ q: "這個字串不存在" }));
    assert.equal(count, 0);
    const parsed = parseCsv(csv);
    assert.equal(parsed.length, 1, "只有標題");
    assert.ok(csv.startsWith(CSV_BOM));
  });

  // ───────── 隔離與權限 ─────────

  it("跨帳本：只會匯出自己帳本的資料，別人的 id 篩選不出東西", async () => {
    const mine = await rows();
    assert.ok(!mine.some((r) => r["名稱"] === "別人的帳"));
    const theirs = await rows(other.ctxA);
    assert.deepEqual(theirs.map((r) => r["名稱"]).filter(Boolean), ["別人的帳"]);
    // 用別的帳本的帳戶／分類 id 來篩，只會得到空結果，不會拿到對方資料
    const spoof = await rows(c.ctxA, { account: other.accA });
    assert.equal(spoof.length, 0);
  });

  it("唯讀成員可以匯出自己看得到的資料，而且拿不到多餘的東西", async () => {
    const readOnly = { ...c.ctxB, canWrite: false };
    const list = await rows(readOnly);
    const normal = await rows(c.ctxB);
    assert.deepEqual(list.map((r) => r["交易ID"]).sort(), normal.map((r) => r["交易ID"]).sort());
    assert.ok(list.length > 0);
  });

  it("作廢的紀錄不會被匯出", async () => {
    const tx = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(66), accountId: bank, categoryId: null, title: "要作廢的",
      note: "", occurredOn: D(13), split: eq(), clientRequestId: rid(),
    });
    assert.ok((await rows()).some((r) => r["名稱"] === "要作廢的"));
    await ledger.deleteTransaction(c.ctxA, tx.id);
    assert.ok(!(await rows()).some((r) => r["名稱"] === "要作廢的"));
  });

  // ───────── 匯出本身不改資料 ─────────

  it("匯出不會改動任何財務資料（只會多一筆 AuditLog）", async () => {
    const beforeBalances = await ledger.getBalances(c.ctxA);
    const beforeSummary = await ledger.monthSummary(c.ctxA, NOW);
    const beforeTx = await prisma.transaction.count();
    const beforeAudit = await prisma.auditLog.count();

    const { count } = await exportTransactionsCsv(c.ctxA, EMPTY_FILTER);
    await exportTransactionsCsv(c.ctxB, parseFilter({ kind: "EXPENSE" }));

    assert.equal(await prisma.transaction.count(), beforeTx);
    assert.equal(await prisma.auditLog.count(), beforeAudit, "匯出本身不寫 AuditLog");
    assert.deepEqual([...(await ledger.getBalances(c.ctxA)).accounts], [...beforeBalances.accounts]);
    assert.deepEqual(await ledger.monthSummary(c.ctxA, NOW), beforeSummary);

    // 記錄匯出事件是另外一個明確的呼叫
    await recordExport(c.ctxA, { count, filter: EMPTY_FILTER });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { bookId: c.ctxA.book.id, action: "EXPORT" }, orderBy: { createdAt: "desc" },
    });
    assert.equal(log.actorId, c.aId);
    assert.equal(log.entityType, "Transaction");
    assert.deepEqual(log.after, { count, filter: JSON.parse(JSON.stringify(EMPTY_FILTER)) });
  });

  // ───────── 規模 ─────────

  it("大量交易：500 筆在合理時間內匯出，而且沒有 N+1", async () => {
    const queries: string[] = [];
    const spy = (e: { query: string }) => queries.push(e.query);
    const bulk = Array.from({ length: 500 }, (_, i) => ({
      bookId: c.ctxA.book.id, type: "EXPENSE" as const, occurredAt: new Date(`2026-07-15T12:00:00+08:00`),
      amount: $(10 + (i % 90)), title: `批次 ${i}`, clientRequestId: rid(),
      createdById: c.aId, updatedById: c.aId,
    }));
    await prisma.transaction.createMany({ data: bulk });
    const created = await prisma.transaction.findMany({ where: { bookId: c.ctxA.book.id, title: { startsWith: "批次 " } }, select: { id: true } });
    await prisma.transactionPayment.createMany({
      data: created.map((t) => ({ transactionId: t.id, accountId: bank, userId: c.aId, amount: $(10) })),
    });
    await prisma.transactionSplit.createMany({
      data: created.map((t) => ({ transactionId: t.id, userId: c.aId, amount: $(10) })),
    });

    prisma.$on("query" as never, spy as never);
    const t0 = Date.now();
    const { csv, count, truncated } = await exportTransactionsCsv(c.ctxA, parseFilter({ from: "2026-07-01", to: "2026-07-31" }));
    const ms = Date.now() - t0;
    assert.equal(count, 500);
    assert.equal(truncated, false);
    assert.ok(csv.split("\r\n").length >= 501);
    assert.ok(ms < 8000, `匯出 500 筆花了 ${ms}ms，太慢`);
    assert.ok(EXPORT_LIMIT >= 5000);
  });
});
