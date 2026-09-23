"use client";

import { useActionState, useState } from "react";
import { createTransferAction } from "@/app/actions/transfers";
import { formatMoney, parseAmount } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { Button, Card, ErrorText, Field, Input, Select, cx, inputClass } from "./ui";

export interface TransferAccountOption {
  id: string;
  /** 顯示名稱（含擁有者與圖示） */
  label: string;
  /** 純帳戶名稱 */
  name: string;
  isCard: boolean;
  balance: number;
  earmarked: number;
  free: number;
}

/** 帳戶間轉帳：來源 −金額、目的 +金額，不算收支、不影響誰欠誰。 */
export function TransferForm({ accounts, today, now }: { accounts: TransferAccountOption[]; today: string; now: string }) {
  const sources = accounts.filter((a) => !a.isCard);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [fromId, setFromId] = useState(sources[0]?.id ?? "");
  const [toId, setToId] = useState(accounts.find((a) => a.id !== sources[0]?.id)?.id ?? "");
  const [amount, setAmount] = useState("");
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof createTransferAction>>, fd: FormData) => {
    const r = await createTransferAction(prev, fd);
    if (r?.error) setRequestId(crypto.randomUUID()); // 失敗後換一組，修正後可以重送
    return r;
  }, undefined);

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const parsed = parseAmount(amount) ?? 0;
  const sameAccount = !!fromId && fromId === toId;
  const overFree = !!from && parsed > 0 && parsed > from.free;

  return (
    <ActionForm action={action} className="pb-submit-bar space-y-4 px-4">
      <input type="hidden" name="clientRequestId" value={requestId} />

      <Card className="space-y-3">
        <Field label="從哪個帳戶轉出" hint={from ? `餘額 ${formatMoney(from.balance)}${from.earmarked > 0 ? `・已指定給基金 ${formatMoney(from.earmarked)}` : ""}・可自由使用 ${formatMoney(from.free)}` : "還沒有可以轉出的帳戶"}>
          <Select name="fromAccountId" aria-label="轉出帳戶" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {sources.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
        </Field>
        <p className="text-center text-xl text-stone-400">↓</p>
        <Field label="轉入哪個帳戶" hint={to?.isCard ? "轉入信用卡＝繳卡費，未繳金額會減少" : undefined}>
          <Select name="toAccountId" aria-label="轉入帳戶" value={toId} onChange={(e) => setToId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
        </Field>
        {sameAccount && <p className="text-sm text-red-600">轉出與轉入帳戶不能相同</p>}
      </Card>

      <Card className="space-y-3">
        <Field label="金額">
          <Input
            name="amount"
            aria-label="金額"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="0"
            className="h-14 text-2xl font-bold"
          />
        </Field>
        {overFree && from && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            「{from.name}」可自由使用只剩 {formatMoney(Math.max(0, from.free))}
            {from.earmarked > 0 && `（餘額 ${formatMoney(from.balance)} 之中有 ${formatMoney(from.earmarked)} 已指定給基金）`}，不夠轉出。
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="日期"><Input name="occurredOn" type="date" aria-label="日期" defaultValue={today} required /></Field>
          <Field label="時間"><Input name="occurredTime" type="time" aria-label="時間" defaultValue={now} /></Field>
        </div>
        <Field label="備註（選填）">
          <textarea name="note" maxLength={200} rows={2} aria-label="備註" placeholder="例如：把薪水轉到共同帳戶" className={cx(inputClass, "h-auto py-2.5")} />
        </Field>
      </Card>

      <p className="rounded-xl bg-sky-50 px-3.5 py-2.5 text-xs text-sky-800" data-testid="transfer-hint">
        轉帳只是把錢換個地方放：不算收入、不算支出、不影響誰欠誰，也不會影響分帳。
        基金已經指定的錢不能被轉走，所以最多只能轉出「可自由使用」的金額。
      </p>

      <ErrorText>{state?.error}</ErrorText>
      <div className="sticky-submit-bar">
        <Button type="submit" className="w-full" disabled={pending || sameAccount || parsed <= 0 || accounts.length < 2}>
          {pending ? "建立中…" : "建立轉帳"}
        </Button>
      </div>
    </ActionForm>
  );
}
