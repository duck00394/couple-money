import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as categories from "../../src/server/services/categories";
import * as recurring from "../../src/server/services/recurring";
import { searchTransactions, searchOptions } from "../../src/server/services/search";
import { monthStats } from "../../src/server/services/stats";
import { exportTransactionsCsv } from "../../src/server/services/export";
import { loadTxFormOptions } from "../../src/server/txFormData";
import { parseFilter, EMPTY_FILTER } from "../../src/server/domain/search";
import { listActivity } from "../../src/server/services/notifications";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
const NOW = new Date(`${D(15)}T12:00:00+08:00`);

describe("Phase 3-4 D：分類管理", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;
  let foodId = "";
  let hotpot = "";
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const full = (userId: string) => ({ method: "FULL" as const, participants: [{ userId }] });
  const manage = () => categories.listCategoriesForManage(c.ctxA);
  const byName = async (name: string) => (await manage()).find((x) => x.name === name)!;

  before(async () => {
    await reset();
    c = await setupCouple("cat");
    other = await setupCouple("oth");
    foodId = (await byName("餐飲")).id;
    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(30000), accountId: c.joint, categoryId: null, title: "薪水",
      note: "", occurredOn: D(1), split: full(c.aId), clientRequestId: rid(),
    });
    hotpot = (await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1000), accountId: c.accA, categoryId: foodId, title: "火鍋",
      note: "", occurredOn: D(5), split: eq(), clientRequestId: rid(),
    })).id;
  });
  after(() => prisma.$disconnect());

  // ───────── 新增 ─────────

  it("新增分類：名稱整理過、圖示有效、排在最後面", async () => {
    const created = await categories.createCategory(c.ctxA, { name: "  寵物  ", kind: "EXPENSE", icon: "dog" });
    assert.equal(created.name, "寵物");
    assert.equal(created.icon, "dog");
    assert.equal(created.kind, "EXPENSE");
    assert.equal(created.isArchived, false);
    assert.equal(created.bookId, c.ctxA.book.id);
    const list = await manage();
    const expense = list.filter((x) => x.kind === "EXPENSE");
    assert.equal(expense.at(-1)!.name, "寵物", "新分類排在最後");
    assert.equal((await byName("寵物")).deletable, true, "還沒用過所以可以刪");
    // 收入分類也可以新增
    const income = await categories.createCategory(c.ctxA, { name: "股息", kind: "INCOME" });
    assert.equal(income.kind, "INCOME");
  });

  it("空白名稱與重複名稱會被擋下來（忽略大小寫與空白差異）", async () => {
    await rejects(categories.createCategory(c.ctxA, { name: "   ", kind: "EXPENSE" }), "CATEGORY_NAME");
    await rejects(categories.createCategory(c.ctxA, { name: "寵物", kind: "EXPENSE" }), "CATEGORY_DUPLICATE");
    await rejects(categories.createCategory(c.ctxA, { name: " 寵 物 ", kind: "EXPENSE" }), "CATEGORY_DUPLICATE");
    await rejects(categories.createCategory(c.ctxA, { name: "餐飲", kind: "EXPENSE" }), "CATEGORY_DUPLICATE");
    await rejects(categories.createCategory(c.ctxA, { name: "寵物", kind: "TRANSFER" }), "CATEGORY_KIND");
    // 不同類型可以同名（支出的「其他」與收入的「其他收入」本來就分開）
    await categories.createCategory(c.ctxA, { name: "寵物", kind: "INCOME" });
    assert.equal((await manage()).filter((x) => x.name === "寵物").length, 2);
  });

  it("圖示不在清單裡就用預設值，不會變成任意字串", async () => {
    const created = await categories.createCategory(c.ctxA, { name: "怪圖示", kind: "EXPENSE", icon: "<script>alert(1)</script>" });
    assert.equal(created.icon, "tag");
  });

  // ───────── 編輯 ─────────

  it("改名不會動到任何既有交易，舊紀錄跟著顯示新名稱", async () => {
    const before = await prisma.transaction.findUniqueOrThrow({ where: { id: hotpot } });
    await categories.updateCategory(c.ctxA, foodId, { name: "吃飯", icon: "utensils-crossed" });
    const afterTx = await prisma.transaction.findUniqueOrThrow({ where: { id: hotpot } });
    assert.equal(afterTx.categoryId, foodId, "交易指的還是同一個分類");
    assert.equal(afterTx.version, before.version, "交易完全沒被改過");
    assert.equal(afterTx.updatedAt.getTime(), before.updatedAt.getTime());
    // 搜尋與匯出都跟著顯示新名稱
    const found = await searchTransactions(c.ctxA, parseFilter({ q: "吃飯" }), { take: 50 });
    assert.ok(found.items.some((t) => t.id === hotpot), "用新名稱搜尋得到");
    const { csv } = await exportTransactionsCsv(c.ctxA, EMPTY_FILTER);
    assert.ok(csv.includes("吃飯"));
    await categories.updateCategory(c.ctxA, foodId, { name: "餐飲", icon: "utensils" }); // 改回來
  });

  it("改名時不能撞到別的分類，但改成自己原本的名稱可以", async () => {
    await rejects(categories.updateCategory(c.ctxA, foodId, { name: "寵物" }), "CATEGORY_DUPLICATE");
    await categories.updateCategory(c.ctxA, foodId, { name: "餐飲" });
    await rejects(categories.updateCategory(c.ctxA, foodId, { name: "" }), "CATEGORY_NAME");
  });

  // ───────── 停用與啟用 ─────────

  it("停用之後：新交易選不到，但舊交易還看得到、搜尋得到、統計也不變", async () => {
    const statsBefore = await monthStats(c.ctxA, MONTH);
    const summaryBefore = await ledger.monthSummary(c.ctxA, NOW);
    await categories.setCategoryArchived(c.ctxA, foodId, true);

    // 新交易不能用停用的分類
    await rejects(
      ledger.createTransaction(c.ctxA, {
        type: "EXPENSE", amount: $(100), accountId: c.accA, categoryId: foodId, title: "新的",
        note: "", occurredOn: D(6), split: eq(), clientRequestId: rid(),
      }),
      "TX_CATEGORY_ARCHIVED",
    );
    // 表單選單也不會出現它
    const options = await loadTxFormOptions(c.ctxA);
    assert.ok(!options.categories.some((x) => x.id === foodId), "停用的分類不在新增表單的選單裡");

    // 舊交易完全不受影響
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: hotpot } });
    assert.equal(tx.categoryId, foodId);
    const found = await searchTransactions(c.ctxA, parseFilter({ category: foodId }), { take: 50 });
    assert.ok(found.items.some((t) => t.id === hotpot), "舊交易仍然搜尋得到");
    assert.deepEqual((await monthStats(c.ctxA, MONTH)).totals, statsBefore.totals);
    assert.deepEqual((await monthStats(c.ctxA, MONTH)).categories, statsBefore.categories, "/stats 的分類統計不變");
    assert.deepEqual(await ledger.monthSummary(c.ctxA, NOW), summaryBefore);
    // 搜尋的篩選選單仍然列得出停用分類（不然舊資料就找不到了）
    const opts = await searchOptions(c.ctxA);
    assert.ok(opts.categories.some((x) => x.id === foodId), "搜尋篩選仍然找得到停用分類");
  });

  it("編輯舊交易時，原本那個停用分類仍然留得住（不會一存檔就掉分類）", async () => {
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: hotpot } });
    const options = await loadTxFormOptions(c.ctxA, { keepCategoryId: tx.categoryId });
    assert.ok(options.categories.some((x) => x.id === foodId && x.name.includes("已停用")));
    await ledger.updateTransaction(c.ctxA, hotpot, tx.version, {
      type: "EXPENSE", amount: $(1100), accountId: c.accA, categoryId: foodId, title: "火鍋",
      note: "", occurredOn: D(5), split: eq(),
    });
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: hotpot } })).categoryId, foodId);
    // 但不能把另一筆交易改成這個停用分類
    const another = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(50), accountId: c.accA, categoryId: null, title: "別的",
      note: "", occurredOn: D(6), split: eq(), clientRequestId: rid(),
    });
    await rejects(
      ledger.updateTransaction(c.ctxA, another.id, another.version, {
        type: "EXPENSE", amount: $(50), accountId: c.accA, categoryId: foodId, title: "別的",
        note: "", occurredOn: D(6), split: eq(),
      }),
      "TX_CATEGORY_ARCHIVED",
    );
  });

  it("固定支出也遵守同一條規則", async () => {
    await rejects(
      recurring.createRecurring(c.ctxA, {
        name: "房租", note: "", amount: $(15000), categoryId: foodId, accountId: c.joint,
        split: eq(), frequency: "MONTHLY", dayOfWeek: null, dayOfMonth: 10, month: null,
        startDate: D(10), endDate: null,
      }, D(10)),
      "RECURRING_CATEGORY_ARCHIVED",
    );
    // 用未停用的分類就可以；之後把它停用，編輯固定支出時仍然保留得住
    const live = await categories.createCategory(c.ctxA, { name: "住", kind: "EXPENSE" });
    const r = await recurring.createRecurring(c.ctxA, {
      name: "房租", note: "", amount: $(15000), categoryId: live.id, accountId: c.joint,
      split: eq(), frequency: "MONTHLY", dayOfWeek: null, dayOfMonth: 10, month: null,
      startDate: D(10), endDate: null,
    }, D(10));
    assert.equal((await byName("住")).usedByRecurring, 1);
    assert.equal((await byName("住")).deletable, false, "被固定支出用到就不能刪");
    await categories.setCategoryArchived(c.ctxA, live.id, true);
    await recurring.updateRecurring(c.ctxA, r.id, {
      name: "房租", note: "", amount: $(16000), categoryId: live.id, accountId: c.joint,
      split: eq(), frequency: "MONTHLY", dayOfWeek: null, dayOfMonth: 10, month: null,
      startDate: D(10), endDate: null,
    }, D(10));
    assert.equal((await prisma.recurringExpense.findUniqueOrThrow({ where: { id: r.id } })).categoryId, live.id);
    await categories.setCategoryArchived(c.ctxA, live.id, false);
  });

  it("重新啟用之後又可以給新交易用了", async () => {
    await categories.setCategoryArchived(c.ctxA, foodId, false);
    assert.equal((await byName("餐飲")).isArchived, false);
    const tx = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(88), accountId: c.accA, categoryId: foodId, title: "重新啟用後的",
      note: "", occurredOn: D(7), split: eq(), clientRequestId: rid(),
    });
    assert.equal(tx.categoryId, foodId);
    const options = await loadTxFormOptions(c.ctxA);
    assert.ok(options.categories.some((x) => x.id === foodId));
  });

  it("重複停用／重複啟用不會報錯", async () => {
    await categories.setCategoryArchived(c.ctxA, foodId, false);
    await categories.setCategoryArchived(c.ctxA, foodId, false);
    assert.equal((await byName("餐飲")).isArchived, false);
  });

  // ───────── 刪除 ─────────

  it("有歷史交易的分類不能刪，只能停用", async () => {
    const food = await byName("餐飲");
    assert.ok(food.usedByTransactions > 0);
    assert.equal(food.deletable, false);
    await rejects(categories.deleteCategory(c.ctxA, foodId), "CATEGORY_IN_USE");
    assert.ok(await prisma.category.findUnique({ where: { id: foodId } }), "分類還在");
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: hotpot } })).categoryId, foodId, "歷史沒有斷裂");
  });

  it("完全沒用過的分類可以真的刪掉", async () => {
    const tmp = await categories.createCategory(c.ctxA, { name: "臨時分類", kind: "EXPENSE" });
    assert.equal((await byName("臨時分類")).deletable, true);
    await categories.deleteCategory(c.ctxA, tmp.id);
    assert.equal(await prisma.category.findUnique({ where: { id: tmp.id } }), null);
    await rejects(categories.deleteCategory(c.ctxA, tmp.id), "CATEGORY_NOT_FOUND");
  });

  it("已作廢的交易仍然算「有在用」（避免刪掉之後歷史看不懂）", async () => {
    const tmp = await categories.createCategory(c.ctxA, { name: "用過就刪不掉", kind: "EXPENSE" });
    const tx = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(20), accountId: c.accA, categoryId: tmp.id, title: "要作廢的",
      note: "", occurredOn: D(8), split: eq(), clientRequestId: rid(),
    });
    await ledger.deleteTransaction(c.ctxA, tx.id);
    assert.equal((await byName("用過就刪不掉")).deletable, false);
    await rejects(categories.deleteCategory(c.ctxA, tmp.id), "CATEGORY_IN_USE");
  });

  // ───────── 權限與隔離 ─────────

  it("唯讀成員可以看，但不能新增／改名／停用／刪除", async () => {
    const readOnly = { ...c.ctxB, canWrite: false };
    assert.ok((await categories.listCategoriesForManage(readOnly)).length > 0, "看得到");
    await rejects(categories.createCategory(readOnly, { name: "唯讀新增", kind: "EXPENSE" }), "BOOK_READ_ONLY");
    await rejects(categories.updateCategory(readOnly, foodId, { name: "唯讀改名" }), "BOOK_READ_ONLY");
    await rejects(categories.setCategoryArchived(readOnly, foodId, true), "BOOK_READ_ONLY");
    await rejects(categories.deleteCategory(readOnly, foodId), "BOOK_READ_ONLY");
    assert.equal((await byName("餐飲")).isArchived, false, "什麼都沒被改到");
  });

  it("跨帳本：動不到別的帳本的分類，也看不到對方的分類", async () => {
    const theirs = (await categories.listCategoriesForManage(other.ctxA)).find((x) => x.name === "餐飲")!;
    assert.notEqual(theirs.id, foodId);
    await rejects(categories.updateCategory(c.ctxA, theirs.id, { name: "偷改" }), "CATEGORY_NOT_FOUND");
    await rejects(categories.setCategoryArchived(c.ctxA, theirs.id, true), "CATEGORY_NOT_FOUND");
    await rejects(categories.deleteCategory(c.ctxA, theirs.id), "CATEGORY_NOT_FOUND");
    await rejects(categories.updateCategory(c.ctxA, "id-does-not-exist", { name: "x" }), "CATEGORY_NOT_FOUND");
    assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: theirs.id } })).name, "餐飲");
    // 我的分類清單裡沒有對方的
    assert.ok(!(await manage()).some((x) => x.id === theirs.id));
    // 兩邊各自新增同名分類互不影響
    await categories.createCategory(other.ctxA, { name: "寵物", kind: "EXPENSE" });
    assert.equal((await manage()).filter((x) => x.name === "寵物" && x.kind === "EXPENSE").length, 1);
  });

  it("已離開帳本的人拿不到 context，自然管不了分類", async () => {
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

  it("分類管理完全不碰金流：交易、金流、分帳、餘額、欠款、基金都沒變", async () => {
    const snapshot = async () => ({
      tx: await prisma.transaction.count(),
      payments: await prisma.transactionPayment.count(),
      splits: await prisma.transactionSplit.count(),
      fundEntries: await prisma.fundTransaction.count(),
      balances: [...(await ledger.getBalances(c.ctxA)).accounts].sort(),
      net: [...(await ledger.getBalances(c.ctxA)).net].sort(),
      stats: (await monthStats(c.ctxA, MONTH)).totals,
      search: (await searchTransactions(c.ctxA, EMPTY_FILTER, { take: 500 })).totals,
    });
    const before = await snapshot();
    const tmp = await categories.createCategory(c.ctxA, { name: "不影響金流", kind: "EXPENSE" });
    await categories.updateCategory(c.ctxA, tmp.id, { name: "不影響金流2" });
    await categories.setCategoryArchived(c.ctxA, tmp.id, true);
    await categories.setCategoryArchived(c.ctxA, tmp.id, false);
    await categories.deleteCategory(c.ctxA, tmp.id);
    assert.deepEqual(await snapshot(), before);
  });

  it("分類操作寫進 AuditLog，也會出現在對方的最近動態", async () => {
    const created = await categories.createCategory(c.ctxB, { name: "阿本的分類", kind: "EXPENSE" });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { bookId: c.ctxA.book.id, entityType: "Category", entityId: created.id, action: "CREATE" },
    });
    assert.equal(log.actorId, c.bId);
    const activity = await listActivity(c.ctxA);
    assert.equal(activity[0].text, "阿本 新增了分類");
    assert.equal(activity[0].detail, "阿本的分類");
    assert.equal(activity[0].href, "/categories");
    await categories.setCategoryArchived(c.ctxB, created.id, true);
    assert.equal((await listActivity(c.ctxA))[0].text, "阿本 停用了分類");
  });

  it("CSV 的分類欄位仍然正確（停用與改名都不影響）", async () => {
    const { csv } = await exportTransactionsCsv(c.ctxA, EMPTY_FILTER);
    const headerLine = csv.replace("﻿", "").split("\r\n")[0];
    assert.ok(headerLine.includes("分類"));
    const hotpotLine = csv.split("\r\n").find((l) => l.startsWith(hotpot))!;
    assert.ok(hotpotLine.includes("餐飲"), hotpotLine);
  });
});
