/**
 * 使用者頭貼。
 *
 * 使用者「只能選」，不能上傳 —— 可選的圖片是專案裡固定的 PNG
 * （`public/assets/avatars/`，由 GitHub 管理），所以沒有任何 upload API、
 * 沒有 storage、沒有外部圖片服務，也不會有使用者圖片佔用空間。
 *
 * 存法：`User.avatarUrl` 直接放那張圖的路徑（例如 `/assets/avatars/avatar-01.png`），
 * 沒有新增任何欄位，也不存 base64 或圖片本體。
 *
 * 規則：
 *   - 只能改自己的（完全不收 userId 參數，一律用 ctx.me.userId）
 *   - 不認識的 key 一律拒絕，不會把 avatarUrl 寫成壞值
 *   - 移除後 avatarUrl 回到 null，畫面自動退回色塊 + 名字首字
 *   - 唯讀成員也可以改自己的頭貼：這是使用者自己的資料，不是帳本的財務資料
 */
import { prisma } from "../db";
import { assert } from "../domain/errors";
import { avatarSrc, isAvatarKey } from "@/lib/avatars";
import { deleteUpload } from "./attachments";
import type { BookContext } from "./books";

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
 * 選一個固定頭貼。key 必須是 `src/lib/avatars.ts` 裡列出的其中一個，
 * 不認識就直接擋下來（畫面上的舊頭貼不會被動到）。
 */
export async function setMyAvatar(ctx: BookContext, key: string) {
  assert(isAvatarKey(key), "AVATAR_UNKNOWN", "找不到這個頭貼");
  const userId = ctx.me.userId;
  await prisma.user.update({ where: { id: userId }, data: { avatarUrl: avatarSrc(key) } });
  await clearOld(userId); // 以前上傳過的圖片一併清掉，不留垃圾
  return { avatarUrl: avatarSrc(key) };
}

/** 移除自己的頭貼，回到預設的色塊 + 名字首字。已經沒有頭貼時也不會出錯。 */
export async function removeMyAvatar(ctx: BookContext) {
  const userId = ctx.me.userId;
  const removed = await clearOld(userId);
  await prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } });
  return { removed };
}
