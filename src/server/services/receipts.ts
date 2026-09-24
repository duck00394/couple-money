/**
 * 記帳收據照片（Phase 3-4 E）。
 *
 * 沿用既有的 Attachment（多型關聯：ownerType + ownerId），**沒有新增 schema 或 migration**：
 *   ownerType = "TRANSACTION"、ownerId = 那筆記帳的 id。
 *
 * 收據完全不參與任何財務計算：不是 Transaction、不是 Payment、不是 Split，
 * 也不會進搜尋的 totals、/stats、帳戶餘額或欠款。
 */
import { prisma, lockBook, type Tx } from "../db";
import { assert } from "../domain/errors";
import { MAX_RECEIPTS } from "../domain/receipt";
import { assertCanWrite, type BookContext } from "./books";
import { prepareUpload, writeUpload, type UploadFile } from "./attachments";
import { auditIn } from "./funds";

export { MAX_RECEIPTS };

const OWNER = "TRANSACTION";

/** 這筆記帳存不存在（而且屬於這個帳本、還沒作廢）。跨帳本與不存在回同一個錯誤。 */
async function loadTransaction(client: Tx | typeof prisma, ctx: BookContext, transactionId: string) {
  const tx = await client.transaction.findFirst({
    where: { id: transactionId, bookId: ctx.book.id, deletedAt: null },
    select: { id: true },
  });
  assert(tx, "TX_NOT_FOUND", "找不到這筆紀錄");
  return tx;
}

export interface ReceiptView {
  id: string;
  fileName: string;
  size: number;
  createdAt: Date;
  createdById: string;
}

/** 某筆記帳的收據（作廢的記帳一律回空陣列）。 */
export async function listReceipts(ctx: BookContext, transactionId: string): Promise<ReceiptView[]> {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, bookId: ctx.book.id, deletedAt: null },
    select: { id: true },
  });
  if (!tx) return [];
  return prisma.attachment.findMany({
    where: { bookId: ctx.book.id, ownerType: OWNER, ownerId: transactionId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, size: true, createdAt: true, createdById: true },
  });
}

/** 上傳一張收據並綁到這筆記帳。 */
export async function addReceipt(ctx: BookContext, transactionId: string, file: UploadFile) {
  assertCanWrite(ctx);
  await loadTransaction(prisma, ctx, transactionId);
  // 先驗證圖片（格式、大小、檔頭），不合法就不會碰資料庫也不會寫檔
  const up = await prepareUpload(ctx.book.id, file);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    await loadTransaction(tx, ctx, transactionId); // 鎖定後重讀：剛剛被作廢就不該再附照片
    const existing = await tx.attachment.findMany({
      where: { bookId: ctx.book.id, ownerType: OWNER, ownerId: transactionId, deletedAt: null },
      select: { fileName: true, size: true },
    });
    assert(existing.length < MAX_RECEIPTS, "RECEIPT_LIMIT", `每筆紀錄最多 ${MAX_RECEIPTS} 張收據，請先刪掉一張`);
    // 連點兩下／重複送出：同一個檔名又同樣大小，視為同一張
    assert(
      !existing.some((e) => e.fileName === up.fileName && e.size === up.size),
      "RECEIPT_DUPLICATE",
      "這張照片已經加過了",
    );
    const row = await tx.attachment.create({
      data: {
        bookId: ctx.book.id,
        ownerType: OWNER,
        ownerId: transactionId,
        fileName: up.fileName,
        mimeType: up.mimeType,
        size: up.size,
        storageKey: up.storageKey,
        createdById: ctx.me.userId,
      },
    });
    // 寫檔失敗 → 整個資料庫交易回滾，不會留下讀不到的紀錄
    await writeUpload(up.storageKey, up.buf);
    await auditIn(tx, ctx, "CREATE", "Attachment", row.id, null, { transactionId, fileName: up.fileName, size: up.size });
    return row;
  });
}

/** 刪除一張收據（soft delete；記帳本身完全不受影響）。 */
export async function removeReceipt(ctx: BookContext, attachmentId: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const att = await tx.attachment.findFirst({
      where: { id: attachmentId, bookId: ctx.book.id, ownerType: OWNER, deletedAt: null },
    });
    assert(att, "RECEIPT_NOT_FOUND", "找不到這張收據");
    await tx.attachment.update({ where: { id: att.id }, data: { deletedAt: new Date() } });
    await auditIn(tx, ctx, "DELETE", "Attachment", att.id, { transactionId: att.ownerId, fileName: att.fileName }, null);
    return att.ownerId;
  });
}

/** 記帳被作廢時一併收回它的收據（在同一個資料庫交易內呼叫）。 */
export async function detachReceipts(tx: Tx, bookId: string, transactionId: string) {
  await tx.attachment.updateMany({
    where: { bookId, ownerType: OWNER, ownerId: transactionId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}
