import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as transfers from "../../src/server/services/transfers";
import * as receipts from "../../src/server/services/receipts";
import * as cats from "../../src/server/services/categories";
import * as batch from "../../src/server/services/batch";
import { monthStats } from "../../src/server/services/stats";
import { searchTransactions } from "../../src/server/services/search";
import { exportTransactionsCsv } from "../../src/server/services/export";
import { listActivity } from "../../src/server/services/notifications";
import { EMPTY_FILTER, parseFilter } from "../../src/server/domain/search";
import { MAX_BATCH } from "../../src/server/domain/batch";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
const NOW = new Date(`${D(15)}T12:00:00+08:00`);
const png = (name: string) =>
  new File([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56, 5)])], name, { type: "image/png" });

describe("Phase 3-4 F：批次操作", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;
  let bank = "";
  let food = "";
  let fun = "";
  let salary = "";
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const full = (userId: string) => ({ method: "FULL" as const, participants: [{ userId }] });
  const cat = async (name: string) => (await ledger.listCategories(c.ctxA)).find((x) => x.name === name)!.id;
  const expense = (title: string, amount = $(100), day = 5, categoryId: string | null = null, extra: Partial<ledger.TransactionInput> = {}) =>
    ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount, accountId: bank, categoryId, title,
      note: "", occurredOn: D(day), split: eq(), clientRequestId: rid(), ...extra,
    });
  const alive = (id: string) => prisma.transaction.count({ where: { id, deletedAt: null } });

  before(async () => {
    await reset();
    c = await setupCouple("bt");
    other = await setupCouple("oth");
    bank = (await ledger.createAccount(c.ctxA, { name: "小艾銀行", type: "BANK", shared: false, openingBalance: $(500000) })).id;
    food = await cat("餐飲");
    fun = await cat("娛樂");
    salary = (await ledger.listCategories(c.ctxA)).find((x) => x.name === "薪水")!.id;
    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(30000), accountId: c.joint, categoryId: null, title: "薪水",
      note: "", occurredOn: D(1), split: full(c.aId), clientRequestId: rid(),
    });
  });
  after(() => prisma.$disconnect());

  // ───────── 批次改分類 ─────────

  it("批次改分類：只動 categoryId，金額、金流、分帳、版本都不變", async () => {
    const list = await Promise.all([expense("早餐"), expense("午餐"), expense("晚餐")]);
    const beforeRows = await prisma.transaction.findMany({
      where: { id: { in: list.map((t) => t.id) } },
      include: { payments: true, splits: true },
      orderBy: { id: "asc" },
    });
    const r = await batch.batchSetCategory(c.ctxA, list.map((t) => t.id), food);
    assert.equal(r.done, 3);
    const afterRows = await prisma.transaction.findMany({
      where: { id: { in: list.map((t) => t.id) } },
      include: { payments: true, splits: true },
      orderBy: { id: "asc" },
    });
    for (const [i, after] of afterRows.entries()) {
      const b = beforeRows[i];
      assert.equal(after.categoryId, food, "分類改好了");
      assert.equal(after.amount, b.amount);
      assert.equal(after.version, b.version, "不動版本（金額沒變）");
      assert.deepEqual(after.payments.map((p) => [p.accountId, p.amount]), b.payments.map((p) => [p.accountId, p.amount]));
      assert.deepEqual(after.splits.map((p) => [p.userId, p.amount]), b.splits.map((p) => [p.userId, p.amount]));
    }
  });

  it("批次改成「不分類」也可以；已經是同一個分類的不會重複寫", async () => {
    const a1 = await expense("甲", $(50), 6, food);
    const a2 = await expense("乙", $(50), 6, food);
    await batch.batchSetCategory(c.ctxA, [a1.id, a2.id], null);
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: a1.id } })).categoryId, null);
    const logsBefore = await prisma.auditLog.count({ where: { entityType: "Transaction", action: "UPDATE" } });
    await batch.batchSetCategory(c.ctxA, [a1.id, a2.id], null); // 再做一次：沒有變化
    assert.equal(await prisma.auditLog.count({ where: { entityType: "Transaction", action: "UPDATE" } }), logsBefore);
  });

  it("分類規則與單筆編輯一致：類型要相符、不能用停用分類、不能用別帳本的分類", async () => {
    const tx = await expense("分類檢查");
    await rejects(batch.batchSetCategory(c.ctxA, [tx.id], salary), "TX_CATEGORY_KIND");
    const archived = await cats.createCategory(c.ctxA, { name: "已停用測試", kind: "EXPENSE" });
    await cats.setCategoryArchived(c.ctxA, archived.id, true);
    await rejects(batch.batchSetCategory(c.ctxA, [tx.id], archived.id), "TX_CATEGORY_ARCHIVED");
    const theirs = (await ledger.listCategories(other.ctxA)).find((x) => x.name === "餐飲")!.id;
    await rejects(batch.batchSetCategory(c.ctxA, [tx.id], theirs), "TX_CATEGORY");
    await rejects(batch.batchSetCategory(c.ctxA, [tx.id], "id-does-not-exist"), "TX_CATEGORY");
  });

  // ───────── 批次加標籤 ─────────

  it("批次加標籤：疊加在原有標籤上，不會蓋掉", async () => {
    const t1 = await expense("有標籤的", $(80), 7, food, { tags: ["原本"] });
    const t2 = await expense("沒標籤的", $(80), 7, food);
    await batch.batchAddTags(c.ctxA, [t1.id, t2.id], "#日本 #機票");
    const tagsOf = async (id: string) =>
      (await prisma.transactionTag.findMany({ where: { transactionId: id }, include: { tag: true } })).map((x) => x.tag.name).sort();
    assert.deepEqual(await tagsOf(t1.id), ["original".replace("original", "原本"), "日本", "機票"].sort());
    assert.deepEqual(await tagsOf(t2.id), ["日本", "機票"].sort());
    // 搜尋得到
    const found = await searchTransactions(c.ctxA, parseFilter({ tag: "日本" }), { take: 50 });
    assert.equal(found.items.length, 2);
    await rejects(batch.batchAddTags(c.ctxA, [t1.id], "   "), "BATCH_TAGS_EMPTY");
  });

  // ───────── 特殊交易保護 ─────────

  it("非支出／收入的紀錄不能批次改分類或加標籤（與單筆編輯同一條規則）", async () => {
    const original = await expense("要退的", $(1000), 8, food);
    const refund = await transfers.createRefund(c.ctxA, {
      originalId: original.id, amount: $(200), accountId: bank, occurredOn: D(8), note: "", clientRequestId: rid(),
    });
    const transfer = await transfers.createTransfer(c.ctxA, {
      fromAccountId: bank, toAccountId: c.joint, amount: $(1000), occurredOn: D(9), note: "", clientRequestId: rid(),
    });
    const adjust = await ledger.adjustAccountBalance(c.ctxA, {
      accountId: bank, targetBalance: $(400000), note: "對帳", occurredOn: D(9), clientRequestId: rid(),
    });
    const opening = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "OPENING_BALANCE" } });

    for (const id of [refund.id, transfer.id, adjust.id, opening.id]) {
      await rejects(batch.batchSetCategory(c.ctxA, [id], fun), "BATCH_NOT_EDITABLE");
      await rejects(batch.batchAddTags(c.ctxA, [id], "#測試"), "BATCH_NOT_EDITABLE");
    }
    // 混在一起也是整批擋下：合法的那筆不能被改到
    const ok = await expense("合法的", $(60), 9, food);
    await rejects(batch.batchSetCategory(c.ctxA, [ok.id, transfer.id], fun), "BATCH_NOT_EDITABLE");
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: ok.id } })).categoryId, food, "整批回滾");
  });

  it("餘額調整不能透過批次刪除；期初餘額與結算也不行", async () => {
    const adjust = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "ADJUSTMENT", deletedAt: null } });
    const opening = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "OPENING_BALANCE" } });
    await rejects(batch.batchDeleteTransactions(c.ctxA, [adjust.id]), "TX_NOT_DELETABLE");
    await rejects(batch.batchDeleteTransactions(c.ctxA, [opening.id]), "TX_NOT_DELETABLE");
    assert.equal(await alive(adjust.id), 1, "餘額調整完全沒被動到");

    const debt = (await ledger.getBalances(c.ctxA)).debts[0];
    if (debt) {
      const s = await ledger.settle(c.ctxA, {
        fromUserId: debt.from, toUserId: debt.to, amount: Math.min(debt.amount, $(50)),
        fromAccountId: debt.from === c.aId ? bank : c.accB, toAccountId: debt.to === c.aId ? bank : c.accB,
        note: "", clientRequestId: rid(),
      });
      await rejects(batch.batchDeleteTransactions(c.ctxA, [s.transactionId]), "TX_NOT_DELETABLE");
    }
  });

  it("已退款的消費不能批次刪除；任務獎金入金也不行", async () => {
    // 退款紀錄會沿用原始消費的標題，所以這裡要指定 type 才會拿到那筆消費
    const original = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, title: "要退的", type: "EXPENSE" } });
    await rejects(batch.batchDeleteTransactions(c.ctxA, [original.id]), "TX_HAS_REFUND");
    assert.equal(await alive(original.id), 1);
    // 任務獎金入金（TRANSFER + sourceType）走基金頁取消
    const fund = await funds.createFund(c.ctxA, { name: "旅遊", targetAmount: null, dueDate: null });
    await funds.addFundEntry(c.ctxA, {
      fundId: fund.id, type: "DEPOSIT", amount: $(1000), userId: c.aId, accountId: c.joint,
      note: "", occurredOn: D(10), clientRequestId: rid(),
    });
    const reward = await prisma.transaction.findFirst({ where: { bookId: c.ctxA.book.id, sourceType: "REWARD_DEPOSIT", deletedAt: null } });
    if (reward) await rejects(batch.batchDeleteTransactions(c.ctxA, [reward.id]), "TX_REWARD_DEPOSIT");
  });

  it("批次刪除不能把基金指定的錢刪掉（沿用既有的基金不變式）", async () => {
    const fund = await prisma.fund.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, name: "旅遊" } });
    const income = await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(5000), accountId: c.joint, categoryId: null, title: "共同帳戶收入",
      note: "", occurredOn: D(10), split: full(c.aId), clientRequestId: rid(),
    });
    const free = await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.joint);
    await funds.addFundEntry(c.ctxA, {
      fundId: fund.id, type: "DEPOSIT", amount: free.free, userId: c.aId, accountId: c.joint,
      note: "", occurredOn: D(10), clientRequestId: rid(),
    });
    // 刪掉那筆收入會讓共同帳戶的錢少於已指定給基金的金額 → 整批擋下
    await rejects(batch.batchDeleteTransactions(c.ctxA, [income.id]), "TRANSFER_EARMARK_BACKING");
    assert.equal(await alive(income.id), 1);
  });

  // ───────── 批次刪除：與逐筆完全一致 ─────────

  it("批次刪除的結果等同逐筆呼叫 deleteTransaction()", async () => {
    const mkSet = async (tag: string) => {
      const rows = await Promise.all([
        expense(`${tag}-1`, $(120), 11, food),
        expense(`${tag}-2`, $(240), 11, fun),
      ]);
      const r = await receipts.addReceipt(c.ctxA, rows[0].id, png(`${tag}.png`));
      return { ids: rows.map((x) => x.id), receiptId: r.id };
    };
    const one = await mkSet("逐筆");
    const many = await mkSet("批次");

    const accountsNow = async () => (await ledger.getBalances(c.ctxA)).accounts;
    const balancesBefore = await accountsNow();
    for (const id of one.ids) await ledger.deleteTransaction(c.ctxA, id);
    const afterSingle = await accountsNow();
    await batch.batchDeleteTransactions(c.ctxA, many.ids);
    const afterBatch = await accountsNow();

    // 兩組一樣的資料、一樣的刪法 → 帳戶餘額的變化量必須一樣
    const delta = (a: Map<string, number>, b: Map<string, number>) =>
      [...a].map(([k, v]) => [k, v - (b.get(k) ?? 0)] as const).sort();
    assert.deepEqual(delta(afterBatch, afterSingle), delta(afterSingle, balancesBefore));
    for (const id of [...one.ids, ...many.ids]) assert.equal(await alive(id), 0);
    // 軟刪除、刪除者、收據收回都與單筆一致
    for (const id of many.ids) {
      const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
      assert.ok(row.deletedAt);
      assert.equal(row.deletedById, c.aId);
    }
    assert.equal(await prisma.attachment.count({ where: { id: many.receiptId, deletedAt: null } }), 0, "收據一併收回");
    // 每一筆都有自己的 DELETE AuditLog（沒有被壓成一筆）
    for (const id of many.ids) {
      assert.equal(await prisma.auditLog.count({ where: { action: "DELETE", entityType: "Transaction", entityId: id } }), 1);
    }
  });

  it("已經作廢的紀錄重複刪不會報錯（與單筆行為一致）", async () => {
    const tx = await expense("刪兩次", $(30), 12, food);
    await batch.batchDeleteTransactions(c.ctxA, [tx.id]);
    await batch.batchDeleteTransactions(c.ctxA, [tx.id]);
    assert.equal(await alive(tx.id), 0);
  });

  // ───────── 選取本身的驗證 ─────────

  it("空選取、超量、格式錯誤、重複 id 都在 server 端擋下", async () => {
    await rejects(batch.batchDeleteTransactions(c.ctxA, []), "BATCH_EMPTY");
    await rejects(batch.batchDeleteTransactions(c.ctxA, Array.from({ length: MAX_BATCH + 1 }, () => rid())), "BATCH_TOO_MANY");
    await rejects(batch.batchDeleteTransactions(c.ctxA, ["' OR 1=1 --"]), "BATCH_ID");
    // 重複 id 只算一次
    const tx = await expense("重複選取", $(20), 12, food);
    const r = await batch.batchDeleteTransactions(c.ctxA, [tx.id, tx.id, tx.id]);
    assert.equal(r.done, 1);
  });

  it("不存在的 id 與跨帳本的 id 回同一個錯誤，而且整批不動", async () => {
    const mine = await expense("我的", $(40), 12, food);
    const theirs = await ledger.createTransaction(other.ctxA, {
      type: "EXPENSE", amount: $(999), accountId: other.accA, categoryId: null, title: "別人的",
      note: "", occurredOn: D(5), split: full(other.aId), clientRequestId: rid(),
    });
    await rejects(batch.batchDeleteTransactions(c.ctxA, [mine.id, "id-does-not-exist"]), "BATCH_NOT_FOUND");
    await rejects(batch.batchDeleteTransactions(c.ctxA, [mine.id, theirs.id]), "BATCH_NOT_FOUND");
    await rejects(batch.batchSetCategory(c.ctxA, [mine.id, theirs.id], fun), "BATCH_NOT_FOUND");
    await rejects(batch.batchAddTags(c.ctxA, [mine.id, theirs.id], "#x"), "BATCH_NOT_FOUND");
    assert.equal(await alive(mine.id), 1, "我的那筆沒被刪");
    assert.equal(await alive(theirs.id), 1, "別人的那筆更不會被動到");
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: theirs.id } })).categoryId, null);
  });

  // ───────── 權限 ─────────

  it("唯讀成員不能執行任何批次操作", async () => {
    const tx = await expense("唯讀", $(10), 13, food);
    const readOnly = { ...c.ctxB, canWrite: false };
    await rejects(batch.batchDeleteTransactions(readOnly, [tx.id]), "BOOK_READ_ONLY");
    await rejects(batch.batchSetCategory(readOnly, [tx.id], fun), "BOOK_READ_ONLY");
    await rejects(batch.batchAddTags(readOnly, [tx.id], "#x"), "BOOK_READ_ONLY");
    assert.equal(await alive(tx.id), 1);
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).categoryId, food);
  });

  it("另一半（同帳本、有編輯權）可以批次操作", async () => {
    const tx = await expense("阿本也能刪", $(10), 13, food);
    await batch.batchDeleteTransactions(c.ctxB, [tx.id]);
    assert.equal(await alive(tx.id), 0);
    assert.equal(
      (await prisma.auditLog.findFirstOrThrow({ where: { action: "DELETE", entityType: "Transaction", entityId: tx.id } })).actorId,
      c.bId,
    );
  });

  // ───────── AuditLog 與動態 ─────────

  it("批次會為每一筆留下既有語意的 AuditLog，另外多一筆摘要；動態不會被灌爆", async () => {
    const rows = await Promise.all([expense("動態1", $(11), 14, food), expense("動態2", $(12), 14, food)]);
    const before = (await listActivity(c.ctxB)).length;
    const summariesBefore = await prisma.auditLog.count({ where: { action: "BATCH_CATEGORY", entityId: c.ctxA.book.id } });
    await batch.batchSetCategory(c.ctxA, rows.map((r) => r.id), fun);
    // 每筆一個 UPDATE + 一筆 BATCH_CATEGORY 摘要
    for (const r of rows) {
      assert.equal(await prisma.auditLog.count({ where: { action: "UPDATE", entityType: "Transaction", entityId: r.id } }), 1);
    }
    assert.equal(await prisma.auditLog.count({ where: { action: "BATCH_CATEGORY", entityId: c.ctxA.book.id } }), summariesBefore + 1);
    // 動態：摘要不在白名單，所以只多兩則「修改了一筆」
    const after = await listActivity(c.ctxB);
    assert.equal(after.length, before + 2);
    assert.ok(after.every((x) => !x.text.includes("BATCH")));
    const json = JSON.stringify(after);
    for (const bad of ["clientRequestId", "storageKey", "payments", "splits", "accountId"]) {
      assert.ok(!json.includes(bad), `不該外洩 ${bad}`);
    }
  });

  // ───────── 財務不變式 ─────────

  it("批次改分類／加標籤：餘額、欠款、基金、stats totals、搜尋 totals、CSV 都不變", async () => {
    const rows = await Promise.all([expense("不變1", $(300), 15, food), expense("不變2", $(400), 15, food)]);
    const snapshot = async () => ({
      accounts: [...(await ledger.getBalances(c.ctxA)).accounts].sort(),
      net: [...(await ledger.getBalances(c.ctxA)).net].sort(),
      funds: [...(await funds.fundBalances(prisma, c.ctxA.book.id))].sort(),
      stats: (await monthStats(c.ctxA, MONTH)).totals,
      summary: await ledger.monthSummary(c.ctxA, NOW),
      search: (await searchTransactions(c.ctxA, EMPTY_FILTER, { take: 500 })).totals,
      csvLines: (await exportTransactionsCsv(c.ctxA, EMPTY_FILTER)).csv.split("\r\n").length,
    });
    const before = await snapshot();
    await batch.batchSetCategory(c.ctxA, rows.map((r) => r.id), fun);
    await batch.batchAddTags(c.ctxA, rows.map((r) => r.id), "#不變測試");
    assert.deepEqual(await snapshot(), before);
    // 分類統計會照實反映（這是預期的：分類本來就是使用者改的）
    const stats = await monthStats(c.ctxA, MONTH);
    assert.ok(stats.categories.some((x) => x.categoryId === fun));
  });

  it("批次刪除：只產生刪除本身應有的變化，沒有額外的金流變動", async () => {
    const rows = await Promise.all([expense("刪1", $(500), 16, food), expense("刪2", $(700), 16, food)]);
    const beforeBalance = (await ledger.getBalances(c.ctxA)).accounts.get(bank) ?? 0;
    const beforePayments = await prisma.transactionPayment.count();
    const beforeSplits = await prisma.transactionSplit.count();
    await batch.batchDeleteTransactions(c.ctxA, rows.map((r) => r.id));
    assert.equal((await ledger.getBalances(c.ctxA)).accounts.get(bank), beforeBalance + $(1200), "只恢復這兩筆的金額");
    assert.equal(await prisma.transactionPayment.count(), beforePayments, "軟刪除，不會刪掉金流列");
    assert.equal(await prisma.transactionSplit.count(), beforeSplits);
    assert.equal((await searchTransactions(c.ctxA, parseFilter({ q: "刪1" }), { take: 10 })).items.length, 0);
  });

  it("50 筆批次刪除在合理時間內完成，且每一筆都有走既有規則", async () => {
    const rows = await Promise.all(
      Array.from({ length: MAX_BATCH }, (_, i) => expense(`大量${i}`, $(10), 17, food)),
    );
    const t0 = Date.now();
    const r = await batch.batchDeleteTransactions(c.ctxA, rows.map((x) => x.id));
    const ms = Date.now() - t0;
    assert.equal(r.done, MAX_BATCH);
    assert.ok(ms < 20000, `50 筆花了 ${ms}ms`);
    assert.equal(await prisma.transaction.count({ where: { id: { in: rows.map((x) => x.id) }, deletedAt: null } }), 0);
    assert.equal(
      await prisma.auditLog.count({ where: { action: "DELETE", entityType: "Transaction", entityId: { in: rows.map((x) => x.id) } } }),
      MAX_BATCH,
      "每一筆都有自己的稽核紀錄",
    );
  });
});
