import { redirect } from "next/navigation";
import { cache } from "react";
import { requireUser } from "./auth/session";
import { getBookContext, loadContext, mainBookId } from "./services/books";
import { prisma } from "./db";

/** App 頁面共用：必須登入且已有帳本，否則導向登入／建立帳本。 */
export const getAppContext = cache(async () => {
  const user = await requireUser();
  const ctx = await getBookContext(user.id);
  if (!ctx) redirect("/onboarding");
  return { user, ctx };
});

/**
 * V15：原帳本的 context。
 *
 * 購買紀錄固定屬於原帳本（規格點 9）：就算使用者目前在「日本旅遊」，
 * 進購買紀錄看到、寫到的都是原帳本的資料，而且 **activeBookId 不會被改掉** ——
 * 離開購買紀錄之後仍然在日本旅遊（規格點 11）。
 *
 * 回傳的 `isForeignContext` 給畫面用：目前帳本不是原帳本時才顯示「此資料屬於原帳本」。
 */
export const getMainBookContext = cache(async () => {
  const user = await requireUser();
  const mainId = await mainBookId(user.id);
  if (!mainId) redirect("/onboarding");
  const ctx = await loadContext(user.id, mainId!);
  const isForeignContext = !!user.activeBookId && user.activeBookId !== mainId;
  // 目前帳本的名字（用來告訴使用者「離開這頁之後還是回到日本旅遊」）
  const active = isForeignContext
    ? await prisma.book.findFirst({ where: { id: user.activeBookId! }, select: { name: true } })
    : null;
  return { user, ctx, isForeignContext, activeBookName: active?.name ?? ctx.book.name };
});
