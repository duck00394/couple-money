"use client";

import { useActionState } from "react";
import { duplicateTaskAction } from "@/app/actions/tasks";
import { Button, ErrorText } from "./ui";

/**
 * 複製任務：只帶設定（名稱、說明、獎勵、懲罰、週期、對象、基金、里程碑），
 * 不帶任何打卡、獎勵、懲罰紀錄。成功後會直接跳到新任務的頁面。
 */
export function DuplicateTaskButton({ id, title }: { id: string; title: string }) {
  const [state, action, pending] = useActionState(duplicateTaskAction, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button variant="secondary" className="w-full" disabled={pending} aria-label={`複製任務 ${title}`} data-testid="duplicate-task">
        {pending ? "複製中…" : "複製這個任務"}
      </Button>
      <p className="mt-1.5 text-center text-xs text-stone-500">會建立一個設定一模一樣的新任務，打卡與獎勵紀錄不會跟著過去</p>
      <ErrorText>{state?.error}</ErrorText>
    </form>
  );
}
