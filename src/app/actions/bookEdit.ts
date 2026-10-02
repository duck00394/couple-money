"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/server/context";
import { requireUser } from "@/server/auth/session";
import { deleteBook, homeRatePair, setHomeRate, updateBook } from "@/server/services/books";
import { str, toActionState, type ActionState } from "@/server/actions";

/** 編輯帳本：名稱、起訖日、備註、換回台幣的參考匯率。 */
export async function updateBookAction2(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await updateBook(ctx, {
      name: str(form, "name"),
      startOn: str(form, "startOn") || null,
      endOn: str(form, "endOn") || null,
      note: str(form, "note") || null,
      ...homeRatePair(str(form, "homeRateValue")),
    });
    return { ok: "已更新" };
  });
  revalidatePath("/", "layout");
  return state;
}

/**
 * 只改匯率。旅遊帳本首頁那張小卡直接送這個 ——
 * 不用進設定頁，也不會因為少送名稱而把別的欄位清掉。
 */
export async function setHomeRateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await setHomeRate(ctx, str(form, "homeRateValue"));
    return { ok: "已更新（只影響之後記的帳）" };
  });
  revalidatePath("/", "layout");
  return state;
}

/**
 * 永久刪除帳本。
 *
 * service 會再檢查一次「帳本名稱有沒有一字不差」與「不是原帳本」——
 * 這裡不做任何信任，表單被繞過也刪不掉。
 */
export async function deleteBookAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const user = await requireUser();
    await deleteBook(user.id, str(form, "bookId"), str(form, "confirmName"));
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect("/books?deleted=1");
}
