import "./env";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma, reset, setupCouple, rejects } from "./helpers";
import { importTravel, previewTravel, type TravelPayload } from "../../src/server/services/travelImport";
import * as books from "../../src/server/services/books";

process.env.TRAVEL_DIARY_URL = "http://travel.test";
const TICKET = "abc_DEF-123.sig_456-xyz";

/** 模擬旅行 App 的 /api/couple-export（只在測試裡換掉 fetch）。 */
let reply: { status: number; body: unknown } = { status: 200, body: null };
let calls: Array<{ url: string; body: string }> = [];
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  calls.push({ url: String(url), body: String(init?.body ?? "") });
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const A = "tA", B = "tB";
function payload(over: Partial<TravelPayload> = {}): TravelPayload {
  return {
    version: 1,
    source: "trip-diary",
    trip: { id: "trip1", title: "日本旅行", startDate: "2026-11-01", endDate: "2026-11-05" },
    exporterId: A,
    members: [{ id: A, name: "Amy" }, { id: B, name: "Ben" }],
    expenses: [
      // A 付、全部算 B 的（JPY 5,000 × 0.21 = NT$1,050）
      { id: "e1-aaaaaa", date: "2026-11-01", title: "B 的藥妝", category: "購物", note: null, currency: "JPY", amount: 500000, rate: 0.21, twd: 105000, payers: [{ userId: A, twd: 105000 }], shares: [{ userId: B, twd: 105000 }] },
      // A 付 1,000，A 300 / B 700
      { id: "e2-aaaaaa", date: "2026-11-02", title: "晚餐", category: "晚餐", note: "燒肉", currency: "TWD", amount: 100000, rate: 1, twd: 100000, payers: [{ userId: A, twd: 100000 }], shares: [{ userId: A, twd: 30000 }, { userId: B, twd: 70000 }] },
      // B 付 1,000，A 300 / B 700
      { id: "e3-aaaaaa", date: "2026-11-03", title: null, category: "交通", note: null, currency: "TWD", amount: 100000, rate: 1, twd: 100000, payers: [{ userId: B, twd: 100000 }], shares: [{ userId: A, twd: 30000 }, { userId: B, twd: 70000 }] },
      // 兩人一起付（A 333.33 / B 666.67），平分 1,000.01
      { id: "e4-aaaaaa", date: "2026-11-04", title: "住宿", category: "住宿", note: null, currency: "TWD", amount: 100001, rate: 1, twd: 100001, payers: [{ userId: A, twd: 33333 }, { userId: B, twd: 66668 }], shares: [{ userId: A, twd: 50001 }, { userId: B, twd: 50000 }] },
    ],
    ...over,
  };
}

const splitsOf = async (bookId: string) => {
  const txs = await prisma.transaction.findMany({ where: { bookId, deletedAt: null }, include: { splits: true, payments: { include: { account: true } } } });
  const owe: Record<string, number> = {}, paid: Record<string, number> = {};
  for (const t of txs) {
    for (const s of t.splits) owe[s.userId] = (owe[s.userId] ?? 0) + s.amount;
    for (const p of t.payments) paid[p.account.ownerId!] = (paid[p.account.ownerId!] ?? 0) + p.amount;
  }
  return { txs, owe, paid, total: txs.reduce((s, t) => s + t.amount, 0) };
};

beforeEach(async () => {
  await reset();
  calls = [];
  reply = { status: 200, body: payload() };
});

test("預覽：筆數、台幣總額、建議帳本名稱；票只放在 POST body", async () => {
  const c = await setupCouple();
  const p = await previewTravel(c.aId, TICKET);
  assert.equal(p.count, 4);
  assert.equal(p.total, 105000 + 100000 + 100000 + 100001);
  assert.equal(p.suggestedName, "2026 日本旅行");
  assert.equal(calls[0].url, "http://travel.test/api/couple-export");
  assert.ok(!calls[0].url.includes(TICKET));
  assert.equal(JSON.parse(calls[0].body).ticket, TICKET);
});

test("建立新帳本：金額、付款人、分攤完全對得上；重複匯入不會重複", async () => {
  const c = await setupCouple();
  const r = await importTravel(c.aId, TICKET, { mode: "new" });
  assert.equal(r.created, 4);
  assert.equal(r.skipped, 0);
  assert.equal(r.bookName, "2026 日本旅行");
  const book = await prisma.book.findUniqueOrThrow({ where: { id: r.bookId } });
  assert.equal(book.type, "TRIP");
  assert.equal(book.baseCurrency, "TWD");

  const s = await splitsOf(r.bookId);
  assert.equal(s.txs.length, 5); // e4 兩位付款人 → 兩筆
  assert.equal(s.total, 405001);
  // A 付：1050 + 1000 + 333.33；B 付：1000 + 666.68
  assert.equal(s.paid[c.aId], 105000 + 100000 + 33333);
  assert.equal(s.paid[c.bId], 100000 + 66668);
  // A 負擔：300 + 300 + 500.01（四捨五入差最多 1 分）
  assert.ok(Math.abs(s.owe[c.aId] - (30000 + 30000 + 50001)) <= 1);
  assert.equal(s.owe[c.aId] + s.owe[c.bId], 405001);
  const e1 = s.txs.find((t) => t.clientRequestId === "travel:e1-aaaaaa:0")!;
  assert.equal(e1.splits.length, 1);
  assert.equal(e1.splits[0].userId, c.bId);
  assert.match(e1.note ?? "", /JPY 5,000（匯率 0.21）/);
  assert.equal(e1.sourceType, "TRAVEL_DIARY");
  assert.equal(e1.occurredAt.toISOString().slice(0, 10), "2026-11-01");
  const cat = await prisma.category.findUnique({ where: { id: s.txs.find((t) => t.clientRequestId === "travel:e2-aaaaaa:0")!.categoryId! } });
  assert.equal(cat?.name, "餐飲");

  // 再按一次「建立新帳本」：沿用同一本，一筆都不會多
  const again = await importTravel(c.aId, TICKET, { mode: "new" });
  assert.equal(again.bookId, r.bookId);
  assert.equal(again.created, 0);
  assert.equal(again.skipped, 4);
  assert.equal((await splitsOf(r.bookId)).txs.length, 5);
  assert.equal((await prisma.book.count({ where: { type: "TRIP" } })), 1);
});

test("匯入現有帳本；之後旅行多記一筆，再匯入只會多那一筆", async () => {
  const c = await setupCouple();
  const r = await importTravel(c.aId, TICKET, { mode: "existing", bookId: c.ctxA.book.id });
  assert.equal(r.created, 4);
  const p = payload();
  p.expenses.push({ id: "e5-aaaaaa", date: "2026-11-05", title: "伴手禮", category: "購物", note: null, currency: "KRW", amount: 1000000, rate: 0.024, twd: 24000, payers: [{ userId: B, twd: 24000 }], shares: [{ userId: A, twd: 12000 }, { userId: B, twd: 12000 }] });
  reply = { status: 200, body: p };
  const r2 = await importTravel(c.aId, TICKET, { mode: "existing", bookId: c.ctxA.book.id });
  assert.equal(r2.created, 1);
  assert.equal(r2.skipped, 4);
  assert.equal((await splitsOf(c.ctxA.book.id)).txs.length, 6);
});

test("另一半匯入：按匯出的人對應到自己", async () => {
  const c = await setupCouple();
  reply = { status: 200, body: payload({ exporterId: B }) };
  const r = await importTravel(c.bId, TICKET, { mode: "existing", bookId: c.ctxA.book.id });
  const s = await splitsOf(r.bookId);
  const e1 = s.txs.find((t) => t.clientRequestId === "travel:e1-aaaaaa:0")!;
  // Ben 匯入、旅行裡的匯出者是 tB → tB = Ben、tA = Amy（另一半）
  assert.equal(e1.payments[0].account.ownerId, c.aId);
  assert.equal(e1.splits[0].userId, c.bId);
  // 反過來：Amy 匯入一份「匯出者是 tB」的資料 → tB = Amy，tA = Ben
  const other = await setupCouple();
  const r2 = await importTravel(other.aId, TICKET, { mode: "existing", bookId: other.ctxA.book.id });
  const e1b = (await splitsOf(r2.bookId)).txs.find((t) => t.clientRequestId === "travel:e1-aaaaaa:0")!;
  assert.equal(e1b.payments[0].account.ownerId, other.bId);
  assert.equal(e1b.splits[0].userId, other.aId);
});

test("兩個人同時匯入：不會重複", async () => {
  const c = await setupCouple();
  const [x, y] = await Promise.all([
    importTravel(c.aId, TICKET, { mode: "existing", bookId: c.ctxA.book.id }),
    importTravel(c.bId, TICKET, { mode: "existing", bookId: c.ctxA.book.id }),
  ]);
  assert.equal(x.created + y.created, 4);
  assert.equal((await splitsOf(c.ctxA.book.id)).txs.length, 5);
});

test("失敗時一筆都不寫：過期票、資料格式錯、超過兩人、別人的帳本", async () => {
  const c = await setupCouple();
  reply = { status: 401, body: { error: "x" } };
  await rejects(importTravel(c.aId, TICKET, { mode: "new" }), "TRAVEL_TICKET");
  reply = { status: 200, body: { hello: 1 } };
  await assert.rejects(importTravel(c.aId, TICKET, { mode: "new" }), /匯出失敗，旅行資料沒有被刪除。/);
  reply = { status: 200, body: payload({ members: [{ id: A, name: "a" }, { id: B, name: "b" }, { id: "tC", name: "c" }] }) };
  await rejects(importTravel(c.aId, TICKET, { mode: "existing", bookId: c.ctxA.book.id }), "TRAVEL_MEMBERS");
  reply = { status: 500, body: null };
  await assert.rejects(importTravel(c.aId, TICKET, { mode: "new" }), /匯出失敗，旅行資料沒有被刪除。/);
  await rejects(importTravel(c.aId, "not a ticket", { mode: "new" }), "TRAVEL_TICKET");
  // 不是成員的帳本
  const other = await setupCouple();
  reply = { status: 200, body: payload() };
  await rejects(importTravel(c.aId, TICKET, { mode: "existing", bookId: other.ctxA.book.id }), "BOOK_FORBIDDEN");
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(await prisma.book.count({ where: { type: "TRIP" } }), 0);
});

test("中途有一筆寫不進去：整批還原（不會只匯一半）", async () => {
  const c = await setupCouple();
  const p = payload();
  p.expenses[2] = { ...p.expenses[2], date: "2026-13-45" }; // 日期不合法 → 第 3 筆失敗
  reply = { status: 200, body: p };
  await assert.rejects(importTravel(c.aId, TICKET, { mode: "existing", bookId: c.ctxA.book.id }));
  assert.equal(await prisma.transaction.count(), 0);
});

test("已結案的帳本不能匯入", async () => {
  const c = await setupCouple();
  const trip = await books.createSecondaryBook(c.ctxA, c.aId, { name: "舊旅行", type: "TRIP" });
  await books.closeBook(await books.loadContext(c.aId, trip.id), c.aId);
  await rejects(importTravel(c.aId, TICKET, { mode: "existing", bookId: trip.id }), "BOOK_READ_ONLY");
  const p = await previewTravel(c.aId, TICKET);
  assert.ok(!p.books.some((b) => b.id === trip.id));
});
