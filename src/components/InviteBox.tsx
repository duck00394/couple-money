"use client";

import { useActionState, useState } from "react";
import { createInviteAction, revokeInviteAction } from "@/app/actions/book";
import { Button, ErrorText } from "./ui";

export function InviteBox({ code, expiresText }: { code: string | null; expiresText: string | null }) {
  const [state, create, creating] = useActionState(createInviteAction, undefined);
  const [, revoke, revoking] = useActionState(revokeInviteAction, undefined);
  const [copied, setCopied] = useState(false);

  if (!code) {
    return (
      <form action={create} className="space-y-2">
        <p className="text-sm text-stone-600">產生邀請碼給另一半，對方註冊後輸入就能一起記帳。</p>
        <ErrorText>{state?.error}</ErrorText>
        <Button className="w-full" disabled={creating}>{creating ? "產生中…" : "產生邀請碼"}</Button>
      </form>
    );
  }
  const link = typeof window !== "undefined" ? `${window.location.origin}/invite/${code}` : `/invite/${code}`;
  const share = async () => {
    const text = `一起用 Couple Money 記帳吧！邀請碼：${code}\n${link}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch {
      /* 使用者取消分享 */
    }
  };
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-brand-50 py-4 text-center">
        <p className="text-xs text-stone-500">邀請碼</p>
        <p className="font-mono text-3xl font-bold tracking-[0.2em] text-brand-700" data-testid="invite-code">{code}</p>
        <p className="mt-1 text-xs text-stone-500">{expiresText}前有效・只能使用一次</p>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button type="button" onClick={share}>{copied ? "已複製" : "分享邀請"}</Button>
        <form action={revoke}>
          <Button variant="ghost" disabled={revoking}>作廢</Button>
        </form>
      </div>
    </div>
  );
}
