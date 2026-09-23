/**
 * 檔案上傳（打卡照片、記帳收據）。
 * 開發環境：存在 UPLOAD_DIR（預設專案下的 .uploads/，不會被公開）。
 * 讀取一律經過 /api/files/[id]，會檢查是不是同一個帳本的成員。
 * 上線時可把 writeFile/readFile 換成 Supabase Storage 或 Cloudflare R2。
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PHOTOS_ENABLED } from "../../config/app";
import { prisma, type Tx } from "../db";
import { assert } from "../domain/errors";
import { assertImage, MAX_UPLOAD_BYTES } from "../domain/receipt";
import { assertCanWrite, type BookContext } from "./books";

export { MAX_UPLOAD_BYTES };

const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), ".uploads"));

export interface UploadFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** 驗證圖片並算出要存到哪裡（還沒寫檔、也還沒寫資料庫）。 */
export async function prepareUpload(bookId: string, file: UploadFile) {
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = assertImage(file, buf);
  return {
    buf,
    storageKey: `${bookId}/${randomUUID()}.${ext}`,
    fileName: file.name.slice(0, 100) || `photo.${ext}`,
    mimeType: file.type,
    size: file.size,
  };
}

/** 寫檔（呼叫端負責先驗證）。照片功能關閉時一律拒絕，避免寫進會消失的暫存區。 */
export async function writeUpload(storageKey: string, buf: Buffer) {
  assert(PHOTOS_ENABLED, "PHOTOS_DISABLED", "這個版本暫時不支援照片上傳");
  const full = path.join(uploadRoot(), storageKey);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf);
}

/**
 * 上傳一張圖片並建立 Attachment。
 * ownerId 先留空（打卡流程會在打卡成功後才綁定），收據流程則直接帶入交易 id。
 */
export async function saveUpload(ctx: BookContext, file: UploadFile, ownerType = "CHECKIN", ownerId?: string, client: Tx | typeof prisma = prisma) {
  assertCanWrite(ctx);
  const up = await prepareUpload(ctx.book.id, file);
  await writeUpload(up.storageKey, up.buf);
  return client.attachment.create({
    data: {
      bookId: ctx.book.id,
      ownerType,
      ownerId: ownerId ?? null,
      fileName: up.fileName,
      mimeType: up.mimeType,
      size: up.size,
      storageKey: up.storageKey,
      createdById: ctx.me.userId,
    },
  });
}

/**
 * 讀取檔案（呼叫前需確認 userId 已登入）。不是同帳本成員回傳 null。
 * 收據另外檢查所屬的記帳還在（交易作廢後，照片就不該再被讀到）。
 */
export async function readAttachment(userId: string, attachmentId: string) {
  const att = await prisma.attachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
  if (!att) return null;
  const member = await prisma.bookMember.findUnique({ where: { bookId_userId: { bookId: att.bookId, userId } } });
  if (!member || member.status !== "ACTIVE") return null; // 已離開帳本的人看不到
  if (att.ownerType === "TRANSACTION") {
    if (!att.ownerId) return null; // 還沒綁定到任何一筆記帳的孤兒檔案
    const tx = await prisma.transaction.findFirst({ where: { id: att.ownerId, bookId: att.bookId, deletedAt: null }, select: { id: true } });
    if (!tx) return null;
  }
  const full = path.join(uploadRoot(), att.storageKey);
  if (!full.startsWith(uploadRoot() + path.sep)) return null;
  return { attachment: att, data: await readFile(full) };
}
