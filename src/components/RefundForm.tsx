"use client";

import { useActionState, useState } from "react";
import { createRefundAction } from "@/app/actions/transfers";
import { formatMoney, parseAmount, toInputString } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { Button, Card, ErrorText, Field, Input, Select, cx, inputClass } from "./ui";

export interface RefundSourceOption {
  id: string;
  title: string;
  date: string;
  amount: number;
  refunded: number;
  refundable: number;
  accountId: string;
  accountName: string;
  fundName: string | null;
}

type AccountOpt = { id: string; label: string };

/** 退款：獨立的一筆紀錄，關聯原始消費，不會去改原始消費的金額與分帳。 */
export function RefundForm({ sources, accounts, today, now, defaultSourceId }: {
  sources: RefundSourceOption[];
  accounts: AccountOpt[];
  today: string;
  now: string;
  defaultSourceId?: string | null;
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [q, setQ] = useState("");
  const first = sources.find((s) => s.id === defaultSourceId) ?? sources[0];
  const [sourceId, setSourceId] = useState(first?.id ?? "");
  const source = sources.find((s) => s.id === sourceId);
  const [amount, setAmount] = useState(first ? toInputString(first.refundable) : "");
  const [accountId, setAccountId] = useState(first?.accountId ?? accounts[0]?.id ?? "");
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof createRefundAction>>, fd: FormData) => {
    const r = await createRefundAction(prev, fd);
    if (r?.error) setRequestId(crypto.randomUUID());
    return r;
  }, undefined);

  const pick = (s: RefundSourceOption) => {
    setSourceId(s.id);
    setAmount(toInputString(s.refundable));
    if (s.accountId && accounts.some((a) => a.id === s.accountId)) setAccountId(s.accountId);
  };
  const parsed = parseAmount(amount) ?? 0;
  const over = !!source && parsed > source.refundable;
  const list = q ? sources.filter((s) => s.title.includes(q)) : sources;

  if (sources.length === 0) {
    return (
      <div className="px-4">
        <Card className="text-center text-sm text-stone-500">目前沒有可以退款的消費。<br />（已經全額退款的消費不會出現在這裡）</Card>
      </div>
    );
  }

  return (
    <ActionForm action={action} className="pb-submit-bar space-y-4 px-4">
      <input type="hidden" name="clientRequestId" value={requestId} />
      <input type="hidden" name="originalId" value={sourceId} />

      <div>
        <p className="mb-1.5 text-sm font-medium text-stone-600">選擇原始消費</p>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋消費名稱" aria-label="搜尋原始消費" className="mb-2 h-11" />
        <div className="max-h-72 space-y-2 overflow-y-auto" role="radiogroup" aria-label="原始消費">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === sourceId}
              aria-label={`原始消費 ${s.title}`}
              data-testid="refund-source"
              onClick={() => pick(s)}
              className={cx(
                "w-full rounded-2xl bg-white p-3 text-left shadow-sm ring-2 transition",
                s.id === sourceId ? "ring-brand-500" : "ring-transparent",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold">{s.title}</span>
                <span className="shrink-0 font-bold">{formatMoney(s.amount)}</span>
              </div>
              <p className="mt-0.5 text-xs text-stone-500">
                {s.date}・{s.accountName}
                {s.fundName ? `・${s.fundName}` : ""}
              </p>
              <p className="mt-0.5 text-xs">
                <span className="text-stone-500">已退款 {formatMoney(s.refunded)}</span>
                <span className="mx-1 text-stone-300">·</span>
                <span className="font-semibold text-brand-600">可退款 {formatMoney(s.refundable)}</span>
              </p>
            </button>
          ))}
          {list.length === 0 && <p className="p-4 text-center text-sm text-stone-500">找不到符合的消費</p>}
        </div>
      </div>

      <Card className="space-y-3">
        <Field label="退款金額" hint={source ? `這筆消費 ${formatMoney(source.amount)}，已退款 ${formatMoney(source.refunded)}，最多可退 ${formatMoney(source.refundable)}` : undefined}>
          <Input
            name="amount"
            aria-label="退款金額"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
            className="h-14 text-2xl font-bold"
          />
        </Field>
        {over && source && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">退款金額不能超過可退款的 {formatMoney(source.refundable)}。</p>
        )}
        <Field label="退款實際進到哪個帳戶" hint={source ? `原本是從「${source.accountName}」付款` : undefined}>
          <Select name="accountId" aria-label="退款帳戶" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="退款日期"><Input name="occurredOn" type="date" aria-label="退款日期" defaultValue={today} required /></Field>
          <Field label="退款時間"><Input name="occurredTime" type="time" aria-label="退款時間" defaultValue={now} /></Field>
        </div>
        <Field label="退款原因／備註（選填）">
          <textarea name="note" maxLength={500} rows={2} aria-label="退款原因" placeholder="例如：尺寸不合退貨" className={cx(inputClass, "h-auto py-2.5")} />
        </Field>
      </Card>

      <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800" data-testid="refund-hint">
        退款會建立一筆獨立紀錄，不會改掉原始消費：原始消費 {source ? formatMoney(source.amount) : "$1,000"} + 退款{" "}
        {parsed > 0 ? formatMoney(parsed) : "$300"} → 實際淨支出{" "}
        {source ? formatMoney(Math.max(0, source.amount - source.refunded - parsed)) + "（尚未退款的部分）" : "會自動扣掉退款"}。
        兩人的負擔會依原本的分帳比例一起減少，欠款自動重算。
        {source?.fundName && <><br />這筆是基金支出，退回來的錢會回到帳戶的「可自由使用」金額；要放回基金請到基金頁再投入一次。</>}
      </p>

      <ErrorText>{state?.error}</ErrorText>
      <div className="sticky-submit-bar">
        <Button type="submit" className="w-full" disabled={pending || !sourceId || parsed <= 0 || over}>
          {pending ? "建立中…" : "建立退款"}
        </Button>
      </div>
    </ActionForm>
  );
}
