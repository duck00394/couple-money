"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { endSession, startSession } from "@/server/auth/session";
import { authenticate, registerUser } from "@/server/services/users";
import { str, toActionState, type ActionState } from "@/server/actions";

/** 只允許站內相對路徑，避免開放式重新導向。 */
function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const user = await authenticate(str(form, "email"), str(form, "password"));
    await startSession(user.id, (await headers()).get("user-agent"));
  });
  if (state?.error) return state;
  redirect(safeNext(str(form, "next")));
}

export async function registerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const user = await registerUser({ email: str(form, "email"), password: str(form, "password"), name: str(form, "name") });
    await startSession(user.id, (await headers()).get("user-agent"));
  });
  if (state?.error) return state;
  redirect(safeNext(str(form, "next")));
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}
