"use client";

import { useActionState } from "react";
import { deleteRecurringAction, generateRecurringAction, setRecurringActiveAction } from "@/app/actions/recurring";
import { Button, cx, ErrorText } from "./ui";

/** 產生記帳：送出時會帶上畫面顯示的應付日，同一個應付日只會產生一筆。 */
export function GenerateButton({ id, dueDate, className }: { id: string; dueDate: string; className?: string }) {
  const [state, action, pending] = useActionState(generateRecurringAction, undefined);
  return (
    <form action={action} className={cx("mt-2", className)}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="dueDate" value={dueDate} />
      <Button type="submit" className="h-11 w-full text-sm" disabled={pending} data-testid="generate-recurring">
        {pending ? "產生中…" : "產生記帳"}
      </Button>
      {state?.error && <p role="alert" className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{state.error}</p>}
      {state?.ok && <p className="mt-1 text-center text-xs text-emerald-600">{state.ok}</p>}
    </form>
  );
}

export function ToggleRecurringButton({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState(setRecurringActiveAction, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
        {pending ? "處理中…" : active ? "停用" : "重新啟用"}
      </Button>
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="mt-1 text-center text-xs text-emerald-600">{state.ok}</p>}
    </form>
  );
}

export function DeleteRecurringButton({ id, generated }: { id: string; generated: number }) {
  const [state, action, pending] = useActionState(deleteRecurringAction, undefined);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(generated > 0 ? `刪除這筆固定支出的設定？已經產生的 ${generated} 筆記帳會保留。` : "刪除這筆固定支出的設定？")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="danger" className="w-full" disabled={pending}>
        {pending ? "刪除中…" : "刪除設定"}
      </Button>
      <ErrorText>{state?.error}</ErrorText>
    </form>
  );
}
