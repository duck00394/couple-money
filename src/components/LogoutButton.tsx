"use client";

import { useActionState } from "react";
import { logoutAction } from "@/app/actions/auth";

/** 登出：送出中要鎖住按鈕，避免連點兩下。 */
export function LogoutButton() {
  const [, action, pending] = useActionState(async () => {
    await logoutAction();
    return undefined;
  }, undefined);
  return (
    <form action={action} className="mt-6">
      <button className="h-12 w-full rounded-xl bg-white text-red-600 shadow-xs ring-1 ring-line/70 active:bg-red-50 disabled:text-stone-400" disabled={pending}>
        {pending ? "登出中…" : "登出"}
      </button>
    </form>
  );
}
