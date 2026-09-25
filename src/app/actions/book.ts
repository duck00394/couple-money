"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getAppContext } from "@/server/context";
import { acceptInvite, createBook, getOrCreateInvite, revokeInvites, updateBookSettings } from "@/server/services/books";
import { str, toActionState, type ActionState } from "@/server/actions";

export async function createBookAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const state = await toActionState(async () => {
    await createBook(user.id, { name: str(form, "name"), nickname: str(form, "nickname") });
  });
  if (state?.error) return state;
  redirect("/more?invite=1");
}

export async function joinBookAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const state = await toActionState(async () => {
    await acceptInvite(user.id, str(form, "code"), str(form, "nickname"));
  });
  if (state?.error) return state;
  redirect("/");
}

export async function createInviteAction(): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await getOrCreateInvite(ctx);
  });
  revalidatePath("/more");
  return state;
}

export async function revokeInviteAction(): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await revokeInvites(ctx);
  });
  revalidatePath("/more");
  return state;
}

export async function updateBookAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await updateBookSettings(ctx, { name: str(form, "name"), nickname: str(form, "nickname") });
    return { ok: "已儲存" };
  });
  revalidatePath("/", "layout");
  return state;
}
