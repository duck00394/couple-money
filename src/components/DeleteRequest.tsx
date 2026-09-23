"use client";

import { useActionState } from "react";
import { decideDeleteAction, requestDeleteAction } from "@/app/actions/deletes";
import { Button, ErrorText } from "./ui";

export interface PendingDelete {
  id: string;
  requestedById: string;
}

/** 刪除共同目標／共同基金：需要另一半確認。 */
export function DeleteRequestPanel({ entityType, entityId, label, pending, meId, partnerName, fromDetail = true }: {
  entityType: "GOAL" | "FUND";
  entityId: string;
  label: string;
  pending: PendingDelete | null;
  meId: string;
  partnerName: string | null;
  fromDetail?: boolean;
}) {
  const [reqState, request, requesting] = useActionState(requestDeleteAction, undefined);
  const [decState, decide, deciding] = useActionState(decideDeleteAction, undefined);
  const error = reqState?.error ?? decState?.error;
  const ok = reqState?.ok ?? decState?.ok;

  if (pending && pending.requestedById === meId) {
    return (
      <div className="space-y-2 rounded-2xl bg-amber-50 p-4 text-sm" data-testid="delete-request">
        <p className="text-amber-800">已申請刪除這個{label}，等 {partnerName ?? "另一半"} 確認。</p>
        <form action={decide}>
          <input type="hidden" name="id" value={pending.id} />
          <input type="hidden" name="decision" value="CANCEL" />
          <Button variant="secondary" className="w-full" disabled={deciding}>取消申請</Button>
        </form>
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }
  if (pending) {
    return (
      <div className="space-y-2 rounded-2xl bg-red-50 p-4 text-sm" data-testid="delete-request">
        <p className="font-semibold text-red-700">{partnerName ?? "另一半"} 想刪除這個{label}</p>
        <p className="text-xs text-red-600">同意後就會刪除（原本的金額紀錄會保留）。</p>
        <div className="grid grid-cols-2 gap-2">
          <form action={decide}>
            <input type="hidden" name="id" value={pending.id} />
            <input type="hidden" name="decision" value="REJECT" />
            <Button variant="secondary" className="w-full" disabled={deciding}>不要刪除</Button>
          </form>
          <form action={decide}>
            <input type="hidden" name="id" value={pending.id} />
            <input type="hidden" name="decision" value="APPROVE" />
            <input type="hidden" name="fromDetail" value={fromDetail ? "1" : "0"} />
            <Button variant="danger" className="w-full" disabled={deciding}>同意刪除</Button>
          </form>
        </div>
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }
  return (
    <form
      action={request}
      onSubmit={(e) => {
        if (!confirm(partnerName ? `送出刪除申請？要等 ${partnerName} 同意才會刪除。` : `確定刪除這個${label}？`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <ErrorText>{error}</ErrorText>
      {ok && <p className="mb-2 text-sm text-emerald-600">{ok}</p>}
      <Button variant="danger" className="mt-2 w-full" disabled={requesting}>
        {partnerName ? `申請刪除${label}（需要 ${partnerName} 確認）` : `刪除${label}`}
      </Button>
    </form>
  );
}
