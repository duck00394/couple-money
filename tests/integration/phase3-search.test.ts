import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as tasks from "../../src/server/services/tasks";
import { searchTransactions, searchOptions } from "../../src/server/services/search";
import { parseFilter } from "../../src/server/domain/search";
import { buildFlowLines, buildTransferLines } from "../../src/server/domain/ledger";

const D = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;

describe("Phase 3-1：搜尋與篩選", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;
  let bBank = "";
  let trip = "";
  let hotpot = "";
  const cat = async (ctx: typeof c.ctxA, name: string) => (await ledger.listCategories(ctx)).find((x) => x.name === name)!.id;
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const search = (ctx: typeof c.ctxA, params: Record<string, string>) => searchTransactions(ctx, parseFilter(params), { take: 100 });
  const titles = async (ctx: typeof c.ctxA, params: Record<string, string>) => (await search(ctx, params)).items.map((t) => t.title).sort();

  before(async () => {
    await reset();
    c = await setupCouple("s");
    other = await setupCouple("o");
    const ex = (ctx: typeof c.ctxA, amount: number, title: string, accountId: string, day: number, category: string | null, extra: Partial<ledger.TransactionInput> = {}) =>
      ledger.createTransaction(ctx, { type: "EXPENSE", amount: $(amount), accountId, categoryId: category, title, note: "", occurredOn: D(day), split: eq(), clientRequestId: rid(), ...extra });

    await ledger.createTransaction(c.ctxA, { type: "INCOME", amount: $(30000), accountId: c.joint, categoryId: null, title: "存入共同帳戶", note: "", occurredOn: D(1), split: { method: "FULL", participants: [{ userId: c.aId }] }, clientRequestId: rid() });
    bBank = (await ledger.createAccount(c.ctxB, { name: "阿本銀行", type: "BANK", shared: false, openingBalance: $(20000) })).id;
    hotpot = (await ex(c.ctxA, 1280, "火鍋", c.accA, 5, await cat(c.ctxA, "餐飲"), { tags: ["#約會", "晚餐"], note: "麻辣鍋" })).id;
    await ex(c.ctxB, 420, "電影", c.accB, 10, await cat(c.ctxA, "娛樂"), { tags: ["約會"] });
    await ex(c.ctxA, 2350, "全聯", c.joint, 12, await cat(c.ctxA, "日用品"));

    trip = (await funds.createFund(c.ctxA, { name: "日本旅遊基金", targetAmount: null, dueDate: null })).id;
    await funds.addFundEntry(c.ctxA, { fundId: trip, type: "DEPOSIT", amount: $(5000), userId: c.aId, accountId: c.joint, note: "", occurredOn: D(13), clientRequestId: rid() });
    await ex(c.ctxA, 1200, "機票訂金", c.accA, 15, await cat(c.ctxA, "旅行"), { fundId: trip, fundAccountId: c.joint });

    // 退款（Phase 3-2 才有畫面；這裡直接用分錄建立一筆與原消費關聯的退款）
    const refundLines = buildFlowLines("REFUND", $(300), [{ account: { id: c.accA, ownerId: c.aId }, amount: $(300) }], eq());
    await prisma.transaction.create({
      data: { bookId: c.ctxA.book.id, type: "REFUND", occurredAt: new Date(`${D(6)}T12:00:00+08:00`), amount: $(300), title: "火鍋退款", relatedId: hotpot, categoryId: await cat(c.ctxA, "餐飲"), clientRequestId: rid(), createdById: c.aId, updatedById: c.aId, payments: { create: refundLines.payments }, splits: { create: refundLines.splits } },
    });
    // 一般轉帳
    const tl = buildTransferLines($(5000), { id: bBank, ownerId: c.bId }, { id: c.joint, ownerId: null });
    await prisma.transaction.create({
      data: { bookId: c.ctxA.book.id, type: "TRANSFER", occurredAt: new Date(`${D(16)}T12:00:00+08:00`), amount: $(5000), title: "阿本銀行轉共同帳戶", clientRequestId: rid(), createdById: c.bId, updatedById: c.bId, payments: { create: tl.payments } },
    });
    // 任務獎金入金（從阿本銀行轉入共同帳戶）
    const t = await tasks.createTask(c.ctxA, { title: "英文", description: "", emoji: "book", scope: "PERSONAL", assigneeId: c.aId, frequency: "DAILY", daysOfWeek: 127, requiresApproval: false, requiresPhoto: false, rewardAmount: $(50), fundId: trip, penaltyAmount: 0, penaltyText: "", isActive: true, milestones: [] }, D(16));
    await tasks.checkIn(c.ctxA, t.id, { today: D(16) });
    await funds.depositRewards(c.ctxB, { fundId: trip, targetAccountId: c.joint, sourceAccountId: bBank, note: "", occurredOn: D(17), clientRequestId: rid() });

    // 另一個帳本也有「火鍋」
    await ledger.createTransaction(other.ctxA, { type: "EXPENSE", amount: $(999), accountId: other.accA, categoryId: null, title: "火鍋", note: "", occurredOn: D(5), split: { method: "FULL", participants: [{ userId: other.aId }] }, clientRequestId: rid() });
  });
  after(() => prisma.$disconnect());

  it("沒有條件：列出所有實際紀錄；統計只算支出／退款／收入，轉帳不算支出、退款降低實際支出", async () => {
    const r = await search(c.ctxA, {});
    const types = r.items.map((t) => t.type).sort();
    assert.deepEqual(types, ["EXPENSE", "EXPENSE", "EXPENSE", "EXPENSE", "INCOME", "OPENING_BALANCE", "REFUND", "TRANSFER", "TRANSFER"].sort());
    assert.equal(r.totals.expense, $(1280 + 420 + 2350 + 1200));
    assert.equal(r.totals.refund, $(300));
    assert.equal(r.totals.netExpense, $(1280 + 420 + 2350 + 1200 - 300));
    assert.equal(r.totals.income, $(30000), "期初餘額、轉帳、獎金入金都不算收入");
    assert.equal(r.totals.transferCount, 2);
    assert.equal(await prisma.fundTransaction.count({ where: { type: "DEPOSIT" } }), 1);
    assert.ok(!r.items.some((t) => t.amount === $(5000) && t.type === "EXPENSE"), "基金投入（指定用途）不是交易、不會出現在支出");
  });

  it("關鍵字：名稱、備註、分類、標籤、帳戶名稱都搜得到；只會找到自己帳本", async () => {
    assert.deepEqual(await titles(c.ctxA, { q: "火鍋" }), ["火鍋", "火鍋退款"]);
    assert.deepEqual(await titles(c.ctxA, { q: "麻辣" }), ["火鍋"]);
    assert.deepEqual(await titles(c.ctxA, { q: "約會" }), ["火鍋", "電影"]);
    assert.deepEqual(await titles(c.ctxA, { q: "日用" }), ["全聯"]);
    assert.ok((await titles(c.ctxA, { q: "阿本銀行" })).includes("阿本銀行轉共同帳戶"));
    assert.deepEqual((await search(other.ctxA, { q: "火鍋" })).items.map((t) => t.amount), [$(999)]);
  });

  it("類型：支出、收入、退款、轉帳、基金支出、任務獎金入金、期初餘額", async () => {
    assert.deepEqual(await titles(c.ctxA, { kind: "EXPENSE" }), ["全聯", "機票訂金", "火鍋", "電影"].sort());
    assert.deepEqual(await titles(c.ctxA, { kind: "INCOME" }), ["存入共同帳戶"]);
    assert.deepEqual(await titles(c.ctxA, { kind: "REFUND" }), ["火鍋退款"]);
    assert.equal((await search(c.ctxA, { kind: "TRANSFER" })).items.length, 2);
    assert.deepEqual(await titles(c.ctxA, { kind: "FUND_EXPENSE" }), ["機票訂金"]);
    const reward = await search(c.ctxA, { kind: "REWARD_DEPOSIT" });
    assert.equal(reward.items.length, 1);
    assert.equal(reward.items[0].sourceType, "REWARD_DEPOSIT");
    assert.equal(reward.totals.expense + reward.totals.income, 0, "任務獎金入金是轉帳，不算收入或支出");
    assert.equal((await search(c.ctxA, { kind: "OPENING_BALANCE" })).items.length, 1);
  });

  it("日期、分類、付款人、帳戶、基金、標籤、金額區間與組合條件", async () => {
    assert.deepEqual(await titles(c.ctxA, { from: D(5), to: D(10) }), ["火鍋", "火鍋退款", "電影"].sort());
    assert.deepEqual(await titles(c.ctxA, { to: D(1) }), ["存入共同帳戶"]);
    assert.deepEqual(await titles(c.ctxA, { category: await cat(c.ctxA, "餐飲") }), ["火鍋", "火鍋退款"]);
    const byBen = await titles(c.ctxA, { person: c.bId });
    assert.deepEqual(byBen, ["任務獎金入金：日本旅遊基金", "期初餘額", "阿本銀行轉共同帳戶", "電影"].sort());
    assert.deepEqual(await titles(c.ctxA, { person: "JOINT", kind: "EXPENSE" }), ["全聯"]);
    assert.deepEqual(await titles(c.ctxA, { account: c.accA }), ["機票訂金", "火鍋", "火鍋退款"].sort());
    assert.deepEqual(await titles(c.ctxA, { fund: trip }), ["任務獎金入金：日本旅遊基金", "機票訂金"].sort());
    assert.deepEqual(await titles(c.ctxA, { tag: "晚餐" }), ["火鍋"]);
    assert.deepEqual(await titles(c.ctxA, { min: "400", max: "1300", kind: "EXPENSE" }), ["機票訂金", "火鍋", "電影"].sort());
    assert.deepEqual(await titles(c.ctxA, { min: "1300", max: "400", kind: "EXPENSE" }), ["機票訂金", "火鍋", "電影"].sort(), "區間顛倒自動對調");
    const combo = await search(c.ctxA, { q: "火鍋", kind: "EXPENSE", tag: "約會", from: D(1), to: D(30) });
    assert.deepEqual(combo.items.map((t) => t.title), ["火鍋"]);
    assert.equal(combo.totals.netExpense, $(1280));
  });

  it("編輯標籤、刪除後的結果立即反映；選項清單不含其他帳本", async () => {
    const tx = (await ledger.getTransaction(c.ctxA, hotpot))!;
    await ledger.updateTransaction(c.ctxA, hotpot, tx.version, {
      type: "EXPENSE", amount: tx.amount, accountId: c.accA, categoryId: tx.categoryId, title: "火鍋", note: "麻辣鍋", occurredOn: D(5), split: eq(), tags: ["生日"],
    });
    assert.deepEqual(await titles(c.ctxA, { tag: "約會" }), ["電影"]);
    assert.deepEqual(await titles(c.ctxA, { tag: "生日" }), ["火鍋"]);
    const opts = await searchOptions(c.ctxA);
    assert.deepEqual(opts.tags, ["生日", "約會"], "沒有被使用的標籤（晚餐）不列出");
    // Phase 3-2 起：有退款的消費要先刪掉退款才能刪
    await rejects(ledger.deleteTransaction(c.ctxA, hotpot), "TX_HAS_REFUND");
    assert.deepEqual(await titles(c.ctxA, { q: "火鍋" }), ["火鍋", "火鍋退款"]);
    const refund = await prisma.transaction.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, type: "REFUND", relatedId: hotpot } });
    await ledger.deleteTransaction(c.ctxA, refund.id);
    await ledger.deleteTransaction(c.ctxA, hotpot);
    assert.deepEqual(await titles(c.ctxA, { q: "火鍋" }), []);
    assert.ok(!opts.accounts.some((a) => a.id === other.accA));
  });

  it("別的帳本：用我們的帳戶、基金、分類 id 篩選都查不到", async () => {
    const cases: Array<Record<string, string>> = [{ account: c.accA }, { fund: trip }, { category: await cat(c.ctxA, "娛樂") }, { person: c.aId }, { tag: "約會" }];
    for (const params of cases) {
      assert.equal((await search(other.ctxA, params)).items.length, 0, JSON.stringify(params));
    }
    assert.equal((await search(other.ctxB, {})).totals.expense, $(999));
  });
});
