"use client";

import { ActionForm } from "./ActionForm";
import { useActionState, useState } from "react";
import { cancelSettlementAction, settleAction } from "@/app/actions/settle";
import { formatMoney, toInputString } from "@/lib/money";
import { Button, cx, ErrorText, Field, Input, Select } from "./ui";

type Acc = { id: string; name: string; icon: string };

export function SettleForm(props: {
  fromUserId: string;
  toUserId: string;
  fromName: string;
  toName: string;
  max: number;
  fromAccounts: Acc[];
  toAccounts: Acc[];
}) {
  const { max } = props;
  // 欠款金額改變時父層會用新的 key 重建此元件，因此每次結算都有新的 requestId
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<"all" | "part">("all");
  const [amount, setAmount] = useState(toInputString(max));
  const [state, action, pending] = useActionState(settleAction, undefined);

  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="clientRequestId" value={clientRequestId} />
      <input type="hidden" name="fromUserId" value={props.fromUserId} />
      <input type="hidden" name="toUserId" value={props.toUserId} />
      <input type="hidden" name="amount" value={mode === "all" ? toInputString(max) : amount} />

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
        {(["all", "part"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={cx("h-10 rounded-lg text-sm", mode === m ? "bg-white font-semibold shadow-sm" : "text-stone-500")}>
            {m === "all" ? `全部結清 ${formatMoney(max)}` : "部分結算"}
          </button>
        ))}
      </div>

      {mode === "part" && (
        <Field label="這次還多少" hint={`最多 ${formatMoney(max)}`}>
          <Input aria-label="結算金額" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={`${props.fromName} 從`}>
          <Select name="fromAccountId" aria-label="付款帳戶">
            {props.fromAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label={`${props.toName} 存入`}>
          <Select name="toAccountId" aria-label="收款帳戶">
            {props.toAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="備註（選填）">
        <Input name="note" maxLength={200} placeholder="例如：LINE Pay 轉帳" />
      </Field>

      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}
      <Button className="w-full" disabled={pending || props.fromAccounts.length === 0 || props.toAccounts.length === 0}>
        {pending ? "處理中…" : `確認：${props.fromName} 已付給 ${props.toName}`}
      </Button>
    </ActionForm>
  );
}

export function CancelSettlementButton({ id, label }: { id: string; label?: string }) {
  const [state, action, pending] = useActionState(cancelSettlementAction, undefined);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("取消這筆結算？欠款會恢復。")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="text-xs text-stone-400 underline" disabled={pending} aria-label={`取消結算 ${label ?? ""}`.trim()}>{pending ? "取消中…" : "取消"}</button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
