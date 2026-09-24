import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as receipts from "../../src/server/services/receipts";
import { readAttachment } from "../../src/server/services/attachments";
import { searchTransactions } from "../../src/server/services/search";
import { monthStats } from "../../src/server/services/stats";
import { parseFilter } from "../../src/server/domain/search";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
const NOW = new Date(`${D(15)}T12:00:00+08:00`);

/** 一張最小但合法的 PNG。 */
function png(name = "receipt.png", bytes = 64): File {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const buf = Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 7)]);
  return new File([buf], name, { type: "image/png" });
}
const notImage = (name = "fake.png") => new File([Buffer.from("%PDF-1.7 not an image")], name, { type: "image/png" });

describe("Phase 3-4 E：記帳收據照片", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;
  let hotpot = "";
  let theirTx = "";
  const eq = () => ({ method: "EQUAL" as const, participants: [{ userId: c.aId }, { userId: c.bId }] });
  const full = (userId: string) => ({ method: "FULL" as const, participants: [{ userId }] });
  const expense = (title: string, day = 5) =>
    ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1000), accountId: c.accA, categoryId: null, title,
      note: "", occurredOn: D(day), split: eq(), clientRequestId: rid(),
    });

  before(async () => {
    await reset();
    c = await setupCouple("rc");
    other = await setupCouple("ot");
    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(30000), accountId: c.joint, categoryId: null, title: "薪水",
      note: "", occurredOn: D(1), split: full(c.aId), clientRequestId: rid(),
    });
    hotpot = (await expense("火鍋")).id;
    theirTx = (await ledger.createTransaction(other.ctxA, {
      type: "EXPENSE", amount: $(999), accountId: other.accA, categoryId: null, title: "別人的帳",
      note: "", occurredOn: D(5), split: full(other.aId), clientRequestId: rid(),
    })).id;
  });
  after(() => prisma.$disconnect());

  // ───────── 正常流程 ─────────

  it("上傳、查看、刪除一張收據", async () => {
    const att = await receipts.addReceipt(c.ctxA, hotpot, png("hotpot.png"));
    assert.equal(att.ownerType, "TRANSACTION");
    assert.equal(att.ownerId, hotpot);
    assert.equal(att.bookId, c.ctxA.book.id);
    assert.ok(att.storageKey.startsWith(`${c.ctxA.book.id}/`), "檔案路徑要帶帳本 id");

    const list = await receipts.listReceipts(c.ctxA, hotpot);
    assert.deepEqual(list.map((r) => r.id), [att.id]);
    assert.equal(list[0].fileName, "hotpot.png");

    // 檔案真的寫出去了，而且讀得到
    const stored = await readAttachment(c.aId, att.id);
    assert.ok(stored, "同帳本成員讀得到");
    assert.equal(stored.attachment.mimeType, "image/png");
    const onDisk = await readFile(path.join(process.env.UPLOAD_DIR!, att.storageKey));
    assert.equal(onDisk.length, 64);

    await receipts.removeReceipt(c.ctxA, att.id);
    assert.deepEqual(await receipts.listReceipts(c.ctxA, hotpot), []);
    assert.equal(await readAttachment(c.aId, att.id), null, "刪掉之後讀不到");
    // 記帳本身完全沒事
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: hotpot } });
    assert.equal(tx.deletedAt, null);
    assert.equal(tx.version, 1, "刪收據不會動到記帳");
  });

  it("多張收據：最多 3 張，第 4 張會被擋", async () => {
    const tx = (await expense("多張收據", 6)).id;
    for (const n of [1, 2, 3]) await receipts.addReceipt(c.ctxA, tx, png(`r${n}.png`));
    assert.equal((await receipts.listReceipts(c.ctxA, tx)).length, 3);
    await rejects(receipts.addReceipt(c.ctxA, tx, png("r4.png")), "RECEIPT_LIMIT");
    // 刪掉一張之後又可以加
    const list = await receipts.listReceipts(c.ctxA, tx);
    await receipts.removeReceipt(c.ctxA, list[0].id);
    await receipts.addReceipt(c.ctxA, tx, png("r4.png"));
    assert.equal((await receipts.listReceipts(c.ctxA, tx)).length, 3);
  });

  it("收據依上傳時間排序，並記得是誰上傳的", async () => {
    const tx = (await expense("誰上傳的", 7)).id;
    await receipts.addReceipt(c.ctxA, tx, png("a.png"));
    await receipts.addReceipt(c.ctxB, tx, png("b.png"));
    const list = await receipts.listReceipts(c.ctxA, tx);
    assert.deepEqual(list.map((r) => r.fileName), ["a.png", "b.png"]);
    assert.deepEqual(list.map((r) => r.createdById), [c.aId, c.bId]);
  });

  // ───────── 檔案驗證（client 端繞不過去）─────────

  it("格式限制：只收 JPG／PNG／WebP", async () => {
    const tx = (await expense("格式", 8)).id;
    await rejects(receipts.addReceipt(c.ctxA, tx, new File([Buffer.from("hi")], "a.txt", { type: "text/plain" })), "UPLOAD_TYPE");
    await rejects(receipts.addReceipt(c.ctxA, tx, new File([Buffer.from("%PDF")], "a.pdf", { type: "application/pdf" })), "UPLOAD_TYPE");
    // 副檔名與 MIME 都偽裝成 PNG，但內容不是
    await rejects(receipts.addReceipt(c.ctxA, tx, notImage()), "UPLOAD_TYPE");
    assert.deepEqual(await receipts.listReceipts(c.ctxA, tx), [], "被擋下來就不會留下任何紀錄");
  });

  it("大小限制：空檔與超過 4MB 都不行", async () => {
    const tx = (await expense("大小", 9)).id;
    await rejects(receipts.addReceipt(c.ctxA, tx, new File([], "empty.png", { type: "image/png" })), "UPLOAD_SIZE");
    await rejects(receipts.addReceipt(c.ctxA, tx, png("huge.png", 4 * 1024 * 1024 + 1)), "UPLOAD_SIZE");
    assert.deepEqual(await receipts.listReceipts(c.ctxA, tx), []);
  });

  it("重複送出：同一張照片連點兩下只會留一張", async () => {
    const tx = (await expense("防重送", 10)).id;
    await receipts.addReceipt(c.ctxA, tx, png("same.png"));
    await rejects(receipts.addReceipt(c.ctxA, tx, png("same.png")), "RECEIPT_DUPLICATE");
    assert.equal((await receipts.listReceipts(c.ctxA, tx)).length, 1);
    // 不同內容（大小不同）仍然可以加
    await receipts.addReceipt(c.ctxA, tx, png("same.png", 128));
    assert.equal((await receipts.listReceipts(c.ctxA, tx)).length, 2);
  });

  // ───────── 權限與帳本隔離 ─────────

  it("唯讀成員不能新增或刪除收據，但看得到", async () => {
    const tx = (await expense("唯讀", 11)).id;
    const att = await receipts.addReceipt(c.ctxA, tx, png("ro.png"));
    const readOnly = { ...c.ctxB, canWrite: false };
    await rejects(receipts.addReceipt(readOnly, tx, png("ro2.png")), "BOOK_READ_ONLY");
    await rejects(receipts.removeReceipt(readOnly, att.id), "BOOK_READ_ONLY");
    assert.equal((await receipts.listReceipts(readOnly, tx)).length, 1, "唯讀成員仍然看得到");
    assert.ok(await readAttachment(c.bId, att.id));
  });

  it("跨帳本：加不到別人的記帳上，也刪不掉別人的收據、讀不到別人的檔案", async () => {
    // 用別的帳本的交易 id → 與不存在的 id 回同一個錯誤，不洩漏是否存在
    await rejects(receipts.addReceipt(c.ctxA, theirTx, png("x.png")), "TX_NOT_FOUND");
    await rejects(receipts.addReceipt(c.ctxA, "id-does-not-exist", png("x.png")), "TX_NOT_FOUND");
    assert.deepEqual(await receipts.listReceipts(c.ctxA, theirTx), [], "看不到別的帳本那筆的收據");

    const mine = await receipts.addReceipt(c.ctxA, hotpot, png("mine.png"));
    await rejects(receipts.removeReceipt(other.ctxA, mine.id), "RECEIPT_NOT_FOUND");
    await rejects(receipts.removeReceipt(other.ctxA, "id-does-not-exist"), "RECEIPT_NOT_FOUND");
    assert.equal(await readAttachment(other.aId, mine.id), null, "別的帳本的人下載不到檔案");
    assert.ok(await readAttachment(c.bId, mine.id), "同帳本的另一半可以");
    await receipts.removeReceipt(c.ctxA, mine.id);
  });

  it("沒登入／已離開帳本的人讀不到檔案", async () => {
    const att = await receipts.addReceipt(c.ctxA, hotpot, png("member.png"));
    assert.equal(await readAttachment("not-a-user", att.id), null);
    await prisma.bookMember.update({
      where: { bookId_userId: { bookId: c.ctxA.book.id, userId: c.bId } },
      data: { status: "LEFT" },
    });
    assert.equal(await readAttachment(c.bId, att.id), null, "已離開帳本就讀不到");
    await prisma.bookMember.update({
      where: { bookId_userId: { bookId: c.ctxA.book.id, userId: c.bId } },
      data: { status: "ACTIVE" },
    });
    assert.ok(await readAttachment(c.bId, att.id));
    await receipts.removeReceipt(c.ctxA, att.id);
  });

  // ───────── soft delete ─────────

  it("記帳作廢後：收據不再出現、也讀不到，但資料還在（soft delete）", async () => {
    const tx = (await expense("要作廢的", 12)).id;
    const att = await receipts.addReceipt(c.ctxA, tx, png("gone.png"));
    assert.ok(await readAttachment(c.aId, att.id));

    await ledger.deleteTransaction(c.ctxA, tx);
    assert.deepEqual(await receipts.listReceipts(c.ctxA, tx), [], "作廢的記帳不會回傳收據");
    assert.equal(await readAttachment(c.aId, att.id), null, "作廢後檔案讀不到");
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: att.id } });
    assert.ok(row.deletedAt, "是 soft delete，資料還在可追溯");
    // 也不能再往作廢的記帳加收據
    await rejects(receipts.addReceipt(c.ctxA, tx, png("late.png")), "TX_NOT_FOUND");
  });

  it("即使附件沒有被標記刪除，作廢記帳的收據一樣讀不到（雙重保險）", async () => {
    const tx = (await expense("雙重保險", 13)).id;
    const att = await receipts.addReceipt(c.ctxA, tx, png("guard.png"));
    await ledger.deleteTransaction(c.ctxA, tx);
    // 手動把附件的 deletedAt 清掉，模擬其他路徑漏掉收回
    await prisma.attachment.update({ where: { id: att.id }, data: { deletedAt: null } });
    assert.equal(await readAttachment(c.aId, att.id), null, "讀取端會再確認記帳還在");
    assert.deepEqual(await receipts.listReceipts(c.ctxA, tx), []);
  });

  it("刪除收據不會刪掉記帳；刪掉記帳也不會留下看得到的孤兒收據", async () => {
    const tx = (await expense("孤兒檢查", 14)).id;
    const a1 = await receipts.addReceipt(c.ctxA, tx, png("k1.png"));
    await receipts.addReceipt(c.ctxA, tx, png("k2.png"));
    await receipts.removeReceipt(c.ctxA, a1.id);
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: tx } })).deletedAt, null);
    assert.equal((await receipts.listReceipts(c.ctxA, tx)).length, 1);

    await ledger.deleteTransaction(c.ctxA, tx);
    const alive = await prisma.attachment.count({
      where: { bookId: c.ctxA.book.id, ownerType: "TRANSACTION", ownerId: tx, deletedAt: null },
    });
    assert.equal(alive, 0, "作廢記帳後不該留下任何有效的收據");
  });

  // ───────── 不影響財務 ─────────

  it("收據完全不影響餘額、欠款、搜尋 totals 與 /stats", async () => {
    const tx = (await expense("財務不受影響", 15)).id;
    const beforeBalances = await ledger.getBalances(c.ctxA);
    const beforeSummary = await ledger.monthSummary(c.ctxA, NOW);
    const beforeStats = await monthStats(c.ctxA, MONTH);
    const beforeSearch = await searchTransactions(c.ctxA, parseFilter({ from: D(1), to: D(30) }), { take: 500 });

    const att = await receipts.addReceipt(c.ctxA, tx, png("money.png"));
    await receipts.addReceipt(c.ctxA, tx, png("money2.png"));

    const afterBalances = await ledger.getBalances(c.ctxA);
    assert.deepEqual([...afterBalances.accounts], [...beforeBalances.accounts]);
    assert.deepEqual([...afterBalances.net], [...beforeBalances.net]);
    assert.deepEqual(await ledger.monthSummary(c.ctxA, NOW), beforeSummary);
    const afterStats = await monthStats(c.ctxA, MONTH);
    assert.deepEqual(afterStats.totals, beforeStats.totals);
    assert.deepEqual(afterStats.paid, beforeStats.paid);
    assert.deepEqual(afterStats.borne, beforeStats.borne);
    assert.deepEqual(afterStats.categories, beforeStats.categories);
    const afterSearch = await searchTransactions(c.ctxA, parseFilter({ from: D(1), to: D(30) }), { take: 500 });
    assert.deepEqual(afterSearch.totals, beforeSearch.totals, "收據不是交易，筆數也不會變");

    await receipts.removeReceipt(c.ctxA, att.id);
    assert.deepEqual((await monthStats(c.ctxA, MONTH)).totals, beforeStats.totals);
  });

  it("收據沒有 Payment 也沒有 Split，不會被當成交易", async () => {
    const rows = await prisma.attachment.findMany({ where: { ownerType: "TRANSACTION" }, select: { id: true } });
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.equal(await prisma.transaction.count({ where: { id: r.id } }), 0, "附件 id 不會是交易 id");
    }
  });

  // ───────── 稽核 ─────────

  it("新增與刪除收據都有稽核紀錄（沿用既有 AuditLog）", async () => {
    const tx = (await expense("稽核", 16)).id;
    const att = await receipts.addReceipt(c.ctxA, tx, png("audit.png"));
    const created = await prisma.auditLog.findFirstOrThrow({
      where: { bookId: c.ctxA.book.id, action: "CREATE", entityType: "Attachment", entityId: att.id },
    });
    assert.equal(created.actorId, c.aId);
    assert.deepEqual(created.after, { transactionId: tx, fileName: "audit.png", size: 64 });

    await receipts.removeReceipt(c.ctxB, att.id);
    const deleted = await prisma.auditLog.findFirstOrThrow({
      where: { bookId: c.ctxA.book.id, action: "DELETE", entityType: "Attachment", entityId: att.id },
    });
    assert.equal(deleted.actorId, c.bId, "另一半刪的也記得住");
    assert.deepEqual(deleted.before, { transactionId: tx, fileName: "audit.png" });
  });

  // ───────── 打卡照片不受影響 ─────────

  it("打卡照片（ownerType = CHECKIN）不會被收據流程動到", async () => {
    const checkin = await prisma.attachment.create({
      data: {
        bookId: c.ctxA.book.id, ownerType: "CHECKIN", ownerId: null,
        fileName: "checkin.png", mimeType: "image/png", size: 64,
        storageKey: `${c.ctxA.book.id}/${rid()}.png`, createdById: c.aId,
      },
    });
    await rejects(receipts.removeReceipt(c.ctxA, checkin.id), "RECEIPT_NOT_FOUND");
    assert.equal((await prisma.attachment.findUniqueOrThrow({ where: { id: checkin.id } })).deletedAt, null);
  });
});
