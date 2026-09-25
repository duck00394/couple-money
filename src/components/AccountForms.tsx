"use client";

import { ActionForm } from "./ActionForm";
import { useActionState, useState } from "react";
import { adjustBalanceAction, cancelAdjustmentAction, createAccountAction, toggleAccountAction } from "@/app/actions/accounts";
import { Button, ErrorText, Field, Input, Select } from "./ui";
import { toInputString } from "@/lib/money";

const TYPES = [
  ["CASH", "現金"],
  ["BANK", "銀行帳戶"],
  ["CREDIT_CARD", "信用卡"],
  ["E_WALLET", "電子支付"],
  ["JOINT", "共同帳戶"],
  ["OTHER", "其他"],
] as const;

export function NewAccountForm() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("BANK");
  const [owner, setOwner] = useState("me");
  // 同一次填寫共用一組 requestId：連點兩下不會建立兩個帳戶（期初餘額也不會記兩次）
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof createAccountAction>>, fd: FormData) => {
    const result = await createAccountAction(prev, fd);
    if (result?.ok) {
      setOpen(false);
      setRequestId(crypto.randomUUID());
    }
    return result;
  }, undefined);

  if (!open) {
    return (
      <>
        {state?.ok && <p className="mb-2 text-center text-sm text-emerald-600">{state.ok}</p>}
        <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>＋ 新增帳戶</Button>
      </>
    );
  }
  return (
    <ActionForm action={action} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <input type="hidden" name="clientRequestId" value={requestId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="類型">
          <Select
            name="type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              if (e.target.value === "JOINT") setOwner("shared");
            }}
          >
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="屬於">
          <Select name="owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="me">我的</option>
            <option value="shared">共同</option>
          </Select>
        </Field>
      </div>
      <Field label="名稱">
        <Input name="name" required maxLength={20} placeholder={type === "CREDIT_CARD" ? "例如：玉山 Pi 卡" : "例如：薪轉戶"} />
      </Field>
      <Field
        label={type === "CREDIT_CARD" ? "目前未繳金額（選填）" : "目前餘額（選填）"}
        hint="會建立一筆「期初餘額」，不影響誰欠誰"
      >
        <Input name="balance" inputMode="decimal" placeholder="0" />
      </Field>
      <ErrorText>{state?.error}</ErrorText>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>取消</Button>
        <Button disabled={pending}>{pending ? "新增中…" : "新增"}</Button>
      </div>
    </ActionForm>
  );
}

export function ToggleAccountButton({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  const [state, action, pending] = useActionState(toggleAccountAction, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={String(!isActive)} />
      <button className="text-xs text-stone-400 underline" disabled={pending} aria-label={`${isActive ? "停用" : "啟用"} ${name}`}>{isActive ? "停用" : "啟用"}</button>
      {state?.error && <span className="ml-1 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** 餘額調整：輸入「實際的餘額」，系統算出差額並建立一筆「餘額調整」紀錄（不改任何舊紀錄）。 */
export function AdjustBalanceForm({
  id, name, balance, isCard,
}: { id: string; name: string; balance: number; isCard: boolean }) {
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof adjustBalanceAction>>, fd: FormData) => {
    const result = await adjustBalanceAction(prev, fd);
    if (result?.ok) {
      setOpen(false);
      setRequestId(crypto.randomUUID());
    }
    return result;
  }, undefined);
  // 信用卡顯示的是「未繳金額」（總帳裡是負餘額）
  const shown = isCard ? -balance : balance;

  if (!open) {
    return (
      <p className="mt-0.5 text-xs">
        <button className="text-stone-400 underline" onClick={() => setOpen(true)} aria-label={`調整 ${name} 的餘額`}>調整餘額</button>
        {state?.ok && <span className="ml-1 text-emerald-600">{state.ok}</span>}
      </p>
    );
  }
  return (
    <ActionForm action={action} className="mt-2 space-y-2 rounded-xl bg-stone-50 p-3" data-testid="adjust-form">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isCard" value={String(isCard)} />
      <input type="hidden" name="clientRequestId" value={requestId} />
      <Field
        label={isCard ? `${name} 實際未繳金額` : `${name} 實際餘額`}
        hint={`App 目前算出 ${toInputString(shown)}；填對的數字就好，差額會自動記成一筆「餘額調整」`}
      >
        <Input name="balance" inputMode="decimal" defaultValue={toInputString(shown)} aria-label="實際餘額" />
      </Field>
      <Field label="原因（選填）">
        <Input name="note" maxLength={200} placeholder="例如：對帳發現少記了一筆早餐" aria-label="調整原因" />
      </Field>
      <ErrorText>{state?.error}</ErrorText>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>取消</Button>
        <Button disabled={pending}>{pending ? "調整中…" : "建立調整"}</Button>
      </div>
      <p className="text-[11px] text-stone-400">
        不會修改任何舊紀錄，也不算收入或支出、不影響誰欠誰。
        <a href={`/transactions?kind=ADJUSTMENT&account=${id}`} className="ml-1 text-brand-600 underline">看調整紀錄</a>
      </p>
    </ActionForm>
  );
}

/** 作廢一筆餘額調整（帳戶餘額回到調整前）。 */
export function CancelAdjustmentButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelAdjustmentAction, undefined);
  return (
    <form
      action={action}
      className="mt-4"
      onSubmit={(e) => {
        if (!confirm("作廢這筆餘額調整？帳戶餘額會回到調整前。")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <ErrorText>{state?.error}</ErrorText>
      <Button type="submit" variant="danger" className="mt-2 w-full" disabled={pending}>
        {pending ? "處理中…" : "作廢這筆調整"}
      </Button>
    </form>
  );
}
