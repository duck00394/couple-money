/**
 * 使用者頭貼。
 *
 * 沿用既有的 Attachment + storage 那一套，不另外做一個圖片系統：
 *   - Attachment.ownerType = "AVATAR"、ownerId = userId
 *   - 檔案本身走 `src/server/storage`（本機磁碟 / Vercel Blob）
 *   - 讀取一樣經過 /api/files/[id]，所以只有同帳本的人看得到
 *
 * 規則：
 *   - 只能改自己的（這裡完全不收 userId 參數，一律用 ctx.me.userId）
 *   - JPG / PNG / WebP，最大 2MB
 *   - 換新的會把舊的一起刪掉（資料庫 soft delete + 實體檔案刪除），不留垃圾
 *   - 移除後 avatarUrl 回到 null，畫面自動退回色塊 + 名字首字
 *   - 唯讀成員（VIEWER、已解除綁定的帳本）也可以改自己的頭貼：
 *     這是使用者自己的資料，不是帳本的財務資料
 */
import { prisma } from "../db";
import { MAX_AVATAR_BYTES } from "../domain/receipt";
import { deleteUpload, prepareUpload, writeUpload, type UploadFile } from "./attachments";
import type { BookContext } from "./books";

export { MAX_AVATAR_BYTES };

export const AVATAR_OWNER_TYPE = "AVATAR";

/** 這個人目前的頭貼附件（沒有就是 null）。 */
export function currentAvatar(userId: string) {
  return prisma.attachment.findFirst({
    where: { ownerType: AVATAR_OWNER_TYPE, ownerId: userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

/** 把舊頭貼標記刪除並刪掉實體檔案。回傳刪掉幾張。 */
async function clearOld(userId: string, keepId?: string) {
  const old = await prisma.attachment.findMany({
    where: { ownerType: AVATAR_OWNER_TYPE, ownerId: userId, deletedAt: null, ...(keepId ? { id: { not: keepId } } : {}) },
  });
  if (old.length === 0) return 0;
  await prisma.attachment.updateMany({ where: { id: { in: old.map((a) => a.id) } }, data: { deletedAt: new Date() } });
  await Promise.all(old.map((a) => deleteUpload(a.storageKey)));
  return old.length;
}

/**
 * 設定（或更換）自己的頭貼。
 * 先寫檔、再建立 Attachment、最後才更新 User.avatarUrl，
 * 中間任何一步失敗都不會讓 avatarUrl 指到不存在的檔案。
 */
export async function setMyAvatar(ctx: BookContext, file: UploadFile) {
  const userId = ctx.me.userId;
  const up = await prepareUpload(ctx.book.id, file, MAX_AVATAR_BYTES);
  await writeUpload(up.storageKey, up.buf, up.mimeType);
  const att = await prisma.attachment.create({
    data: {
      bookId: ctx.book.id,
      ownerType: AVATAR_OWNER_TYPE,
      ownerId: userId,
      fileName: up.fileName,
      mimeType: up.mimeType,
      size: up.size,
      storageKey: up.storageKey,
      createdById: userId,
    },
  });
  const url = `/api/files/${att.id}`;
  await prisma.user.update({ where: { id: userId }, data: { avatarUrl: url } });
  await clearOld(userId, att.id); // 換新的之後才刪舊的
  return { attachmentId: att.id, avatarUrl: url };
}

/** 移除自己的頭貼，回到預設的色塊 + 名字首字。已經沒有頭貼時也不會出錯。 */
export async function removeMyAvatar(ctx: BookContext) {
  const userId = ctx.me.userId;
  const removed = await clearOld(userId);
  await prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } });
  return { removed };
}
