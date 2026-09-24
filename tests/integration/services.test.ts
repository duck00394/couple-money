/**
 * 服務層整合測試：連線真實 PostgreSQL（TEST_DATABASE_URL），每次執行前清空資料。
 * 執行：npm run test:integration
 */
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import "./env";
import { prisma } from "../../src/server/db";
import * as users from "../../src/server/services/users";
import * as books from "../../src/server/services/books";
import * as ledger from "../../src/server/services/ledger";

const $ = (n: number) => n * 100;
const rid = () => randomUUID();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

import { reset, rejects } from "./helpers";

describe("Phase 1 服務層", () => {
  let aId = "";
  let bId = "";
  let ctxA: Awaited<ReturnType<typeof books.loadContext>>;
  let ctxB: Awaited<ReturnType<typeof books.loadContext>>;
  let accA = "";
  let accB = "";
  let joint = "";

  before(reset);
  after(() => prisma.$disconnect());

  it("註冊與登入", async () => {
    const a = await users.registerUser({ email: "Amy@Example.com ", password: "password123", name: "Amy" });
    const b = await users.registerUser({ email: "ben@example.com", password: "password123", name: "Ben" });
    aId = a.id;
    bId = b.id;
    assert.equal(a.email, "amy@example.com");
    assert.notEqual(a.passwordHash, "password123");
    await rejects(users.registerUser({ email: "amy@example.com", password: "password123", name: "x" }), "AUTH_EMAIL_TAKEN");
    await rejects(users.registerUser({ email: "c@example.com", password: "short", name: "x" }), "AUTH_PASSWORD_SHORT");
    assert.equal((await users.authenticate("AMY@example.com", "password123")).id, aId);
    await rejects(users.authenticate("amy@example.com", "wrong-pass"), "AUTH_INVALID");
    await rejects(users.authenticate("nobody@example.com", "password123"), "AUTH_INVALID");
  });

  it("建立帳本、邀請、綁定另一半", async () => {
    assert.equal(await books.getBookContext(aId), null);
    await books.createBook(aId, { name: "我們的帳本", nickname: "小艾" });
    ctxA = (await books.getBookContext(aId))!;
    assert.equal(ctxA.members.length, 1);
    assert.equal(ctxA.partner, null);

    const inv = await books.getOrCreateInvite(ctxA);
    assert.equal((await books.getOrCreateInvite(ctxA)).code, inv.code, "未過期的邀請碼沿用");
    assert.equal((await books.previewInvite(inv.code.toLowerCase()))?.invalidReason, null);
    await rejects(books.acceptInvite(aId, inv.code, "小艾"), "INVITE_ALREADY_MEMBER");
    await books.acceptInvite(bId, ` ${inv.code.toLowerCase()} `, "阿本");
    await rejects(books.acceptInvite(bId, inv.code, "阿本"), "INVITE_USED");

    ctxA = await books.loadContext(aId, ctxA.book.id);
    ctxB = (await books.getBookContext(bId))!;
    assert.equal(ctxB.book.id, ctxA.book.id);
    assert.equal(ctxA.partner?.nickname, "阿本");
    await rejects(books.getOrCreateInvite(ctxA), "INVITE_FULL");

    const accounts = await ledger.listAccounts(ctxA);
    accA = accounts.find((a) => a.ownerId === aId)!.id;
    accB = accounts.find((a) => a.ownerId === bId)!.id;
    joint = accounts.find((a) => a.ownerId === null)!.id;
    assert.equal((await ledger.listCategories(ctxA)).length, 13);
  });

  it("第三人無法加入已滿帳本", async () => {
    const c = await users.registerUser({ email: "c@example.com", password: "password123", name: "C" });
    const inv = await prisma.invite.create({
      data: { bookId: ctxA.book.id, code: "FULLBOOK", createdById: aId, expiresAt: new Date(Date.now() + 86400_000) },
    });
    await rejects(books.acceptInvite(c.id, inv.code, "C"), "INVITE_FULL");
    await rejects(books.loadContext(c.id, ctxA.book.id), "BOOK_FORBIDDEN");
  });

  const expense = (over: Partial<Parameters<typeof ledger.createTransaction>[1]> = {}) => ({
    type: "EXPENSE" as const,
    amount: $(1000),
    accountId: accA,
    categoryId: null,
    title: "晚餐",
    note: "",
    occurredOn: today,
    split: { method: "EQUAL" as const, participants: [{ userId: aId }, { userId: bId }] },
    clientRequestId: rid(),
    ...over,
  });

  let txId = "";
  it("四種分帳 + 即時計算誰欠誰", async () => {
    // A 付 1000 平分 → B 欠 A 500
    const t1 = await ledger.createTransaction(ctxA, expense());
    txId = t1.id;
    let bal = await ledger.getBalances(ctxA);
    assert.deepEqual(bal.debts, [{ from: bId, to: aId, amount: $(500) }]);

    // B 付 300，比例 A 70% / B 30% → A 欠 B 210 → 淨額 B 欠 A 290
    await ledger.createTransaction(ctxB, expense({
      amount: $(300), accountId: accB,
      split: { method: "RATIO", participants: [{ userId: aId, value: 70 }, { userId: bId, value: 30 }] },
    }));
    // A 付 99，自訂金額 A 33 / B 66 → B 再欠 66 → 356
    await ledger.createTransaction(ctxA, expense({
      amount: $(99),
      split: { method: "AMOUNT", participants: [{ userId: aId, value: $(33) }, { userId: bId, value: $(66) }] },
    }));
    // A 付 200，一方全付：B 負擔 → B 再欠 200 → 556
    await ledger.createTransaction(ctxA, expense({ amount: $(200), split: { method: "FULL", participants: [{ userId: bId }] } }));
    // 共同帳戶付 500：不影響欠款
    await ledger.createTransaction(ctxA, expense({ amount: $(500), accountId: joint }));
    bal = await ledger.getBalances(ctxA);
    assert.deepEqual(bal.debts, [{ from: bId, to: aId, amount: $(556) }]);
    assert.equal([...bal.net.values()].reduce((x, y) => x + y, 0), 0);
    assert.equal(bal.accounts.get(joint), -$(500));

    await rejects(ledger.createTransaction(ctxA, expense({
      split: { method: "RATIO", participants: [{ userId: aId, value: 60 }, { userId: bId, value: 30 }] },
    })), "SPLIT_RATIO_SUM");
    await rejects(ledger.createTransaction(ctxA, expense({ amount: 0 })), "TX_AMOUNT");
  });

  it("重複送出只產生一筆", async () => {
    const input = expense({ amount: $(10) });
    const [x, y] = await Promise.all([ledger.createTransaction(ctxA, input), ledger.createTransaction(ctxA, input)]);
    assert.equal(x.id, y.id);
    assert.equal(await prisma.transaction.count({ where: { clientRequestId: input.clientRequestId } }), 1);
    await ledger.deleteTransaction(ctxA, x.id);
    assert.deepEqual((await ledger.getBalances(ctxA)).debts, [{ from: bId, to: aId, amount: $(556) }]);
  });

  it("編輯與刪除會重算欠款、版本衝突會擋下", async () => {
    // 第一筆 1000 平分 → 改成 800 平分：B 欠 A 從 556 → 456
    const rest = expense({ amount: $(800) });
    await ledger.updateTransaction(ctxB, txId, 1, rest);
    assert.deepEqual((await ledger.getBalances(ctxA)).debts, [{ from: bId, to: aId, amount: $(456) }]);
    await rejects(ledger.updateTransaction(ctxA, txId, 1, rest), "TX_CONFLICT");
    const logs = await prisma.auditLog.count({ where: { entityId: txId } });
    assert.equal(logs, 2);
    await ledger.deleteTransaction(ctxA, txId); // 刪掉 → B 欠 A 56
    await ledger.deleteTransaction(ctxA, txId); // 重複刪除不報錯
    assert.deepEqual((await ledger.getBalances(ctxA)).debts, [{ from: bId, to: aId, amount: $(56) }]);
    assert.equal(await ledger.getTransaction(ctxA, txId), null);
  });

  it("部分結算、一鍵結清、防超額、取消結算", async () => {
    const base = { fromUserId: bId, toUserId: aId, fromAccountId: accB, toAccountId: accA, note: "" };
    await rejects(ledger.settle(ctxB, { ...base, amount: $(57), clientRequestId: rid() }), "SETTLE_TOO_MUCH");
    await rejects(ledger.settle(ctxB, { ...base, fromUserId: aId, toUserId: bId, amount: $(1), clientRequestId: rid() }), "SETTLE_NOTHING");
    await rejects(ledger.settle(ctxB, { ...base, fromAccountId: joint, amount: $(1), clientRequestId: rid() }), "SETTLE_FROM_ACCOUNT");

    const s1 = await ledger.settle(ctxB, { ...base, amount: $(20), clientRequestId: rid() });
    assert.deepEqual((await ledger.getBalances(ctxA)).debts, [{ from: bId, to: aId, amount: $(36) }]);

    // 兩人同時按「全部結清」：只有一筆成功
    const results = await Promise.allSettled([
      ledger.settle(ctxA, { ...base, amount: $(36), clientRequestId: rid() }),
      ledger.settle(ctxB, { ...base, amount: $(36), clientRequestId: rid() }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    let bal = await ledger.getBalances(ctxA);
    assert.deepEqual(bal.debts, []);
    // A 付過 99 + 200、收到 20 + 36；B 付過 300、付出 20 + 36
    assert.equal(bal.accounts.get(accA), -$(99 + 200) + $(56));
    assert.equal(bal.accounts.get(accB), -$(300) - $(56));

    await ledger.cancelSettlement(ctxA, s1.id);
    bal = await ledger.getBalances(ctxA);
    assert.deepEqual(bal.debts, [{ from: bId, to: aId, amount: $(20) }]);
    assert.equal(await ledger.getTransaction(ctxA, s1.transactionId), null);
    const live = results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ transactionId: string }>;
    await rejects(ledger.deleteTransaction(ctxA, live.value.transactionId), "TX_NOT_DELETABLE");
  });

  it("帳戶：期初餘額、信用卡負債", async () => {
    const card = await ledger.createAccount(ctxA, { name: "玉山卡", type: "CREDIT_CARD", shared: false, openingBalance: -$(1500) });
    const bank = await ledger.createAccount(ctxA, { name: "薪轉", type: "BANK", shared: false, openingBalance: $(50000) });
    await ledger.createTransaction(ctxA, expense({ amount: $(100), accountId: card.id }));
    const accounts = await ledger.listAccounts(ctxA);
    assert.equal(accounts.find((a) => a.id === card.id)!.balance, -$(1600));
    assert.equal(accounts.find((a) => a.id === bank.id)!.balance, $(50000));
    // 期初餘額不影響欠款：B 欠 A 20 + 50 = 70
    assert.deepEqual((await ledger.getBalances(ctxA)).debts, [{ from: bId, to: aId, amount: $(70) }]);
    const summary = await ledger.monthSummary(ctxA);
    assert.ok(summary.expense > 0);
  });
});
