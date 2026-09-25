"use client";

import { ActionForm } from "./ActionForm";
import { useActionState } from "react";
import { createBookAction, joinBookAction, updateBookAction } from "@/app/actions/book";
import { Button, ErrorText, Field, Input } from "./ui";

export function CreateBookForm({ defaultNickname }: { defaultNickname: string }) {
  const [state, action, pending] = useActionState(createBookAction, undefined);
  return (
    <ActionForm action={action} className="space-y-4">
      <Field label="帳本名稱">
        <Input name="name" required maxLength={30} defaultValue="我們的帳本" />
      </Field>
      <Field label="你在帳本裡的暱稱">
        <Input name="nickname" required maxLength={20} defaultValue={defaultNickname} />
      </Field>
      <ErrorText>{state?.error}</ErrorText>
      <Button className="w-full" disabled={pending}>{pending ? "建立中…" : "建立帳本"}</Button>
    </ActionForm>
  );
}

export function JoinBookForm({ code, defaultNickname, lockCode }: { code?: string; defaultNickname: string; lockCode?: boolean }) {
  const [state, action, pending] = useActionState(joinBookAction, undefined);
  return (
    <ActionForm action={action} className="space-y-4">
      {lockCode ? (
        <input type="hidden" name="code" value={code} />
      ) : (
        <Field label="邀請碼">
          <Input name="code" required defaultValue={code} autoCapitalize="characters" autoComplete="off" placeholder="8 碼英數字" className="font-mono tracking-widest uppercase" />
        </Field>
      )}
      <Field label="你在帳本裡的暱稱">
        <Input name="nickname" required maxLength={20} defaultValue={defaultNickname} />
      </Field>
      <ErrorText>{state?.error}</ErrorText>
      <Button className="w-full" disabled={pending}>{pending ? "加入中…" : "加入帳本"}</Button>
    </ActionForm>
  );
}

export function BookSettingsForm({ name, nickname }: { name: string; nickname: string }) {
  const [state, action, pending] = useActionState(updateBookAction, undefined);
  return (
    <ActionForm action={action} className="space-y-3">
      <Field label="帳本名稱">
        <Input name="name" required maxLength={30} defaultValue={name} />
      </Field>
      <Field label="我的暱稱">
        <Input name="nickname" required maxLength={20} defaultValue={nickname} />
      </Field>
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}
      <Button variant="secondary" className="w-full" disabled={pending}>儲存</Button>
    </ActionForm>
  );
}
