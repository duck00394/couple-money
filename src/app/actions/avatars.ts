"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/server/context";
import { removeMyAvatar, setMyAvatar } from "@/server/services/avatars";
import { toActionState, type ActionState } from "@/server/actions";

/**
 * 換自己的頭貼：只收一個固定頭貼的 key，不收檔案。
 * 這裡不收 userId：一律用登入者本人的 ctx.me，所以沒有辦法改到另一半的頭貼。
 */
export async function setAvatarAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await setMyAvatar(ctx, String(form.get("key") ?? ""));
    return { ok: "頭貼換好了" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function removeAvatarAction(): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await removeMyAvatar(ctx);
    return { ok: "已移除頭貼" };
  });
  revalidatePath("/", "layout");
  return state;
}
