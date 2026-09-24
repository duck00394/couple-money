"use client";

import { ActionForm } from "./ActionForm";
import Link from "next/link";
import { useActionState } from "react";
import { loginAction, registerAction } from "@/app/actions/auth";
import { Button, ErrorText, Field, Input } from "./ui";

export function AuthForm({ mode, next }: { mode: "login" | "register"; next: string }) {
  const [state, action, pending] = useActionState(mode === "login" ? loginAction : registerAction, undefined);
  const q = next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {mode === "register" && (
        <Field label="暱稱">
          <Input name="name" required maxLength={30} autoComplete="nickname" placeholder="例如：小艾" />
        </Field>
      )}
      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" />
      </Field>
      <Field label="密碼" hint={mode === "register" ? "至少 8 個字元" : undefined}>
        <Input
          name="password"
          type="password"
          required
          minLength={mode === "register" ? 8 : undefined}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </Field>
      <ErrorText>{state?.error}</ErrorText>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "處理中…" : mode === "login" ? "登入" : "建立帳號"}
      </Button>
      <p className="text-center text-sm text-stone-500">
        {mode === "login" ? (
          <>還沒有帳號？<Link className="font-semibold text-brand-600" href={`/register${q}`}>註冊</Link></>
        ) : (
          <>已經有帳號？<Link className="font-semibold text-brand-600" href={`/login${q}`}>登入</Link></>
        )}
      </p>
    </ActionForm>
  );
}
