"use client";

import { useActionState } from "react";
import { deleteTransactionAction } from "@/app/actions/transactions";
import { Button, ErrorText } from "./ui";

/** 作廢一筆轉帳或退款（餘額、欠款都會跟著恢復）。 */
export function DeleteTxButton({ id, label, confirmText }: { id: string; label: string; confirmText: string }) {
  const [state, action, pending] = useActionState(deleteTransactionAction, undefined);
  return (
    <form
      action={action}
      className="mt-4"
      onSubmit={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <ErrorText>{state?.error}</ErrorText>
      <Button type="submit" variant="danger" className="mt-2 w-full" disabled={pending}>
        {pending ? "處理中…" : label}
      </Button>
    </form>
  );
}
