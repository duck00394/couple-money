"use client";

import { useActionState, useMemo, useState } from "react";
import { saveRecurringAction } from "@/app/actions/recurring";
import { formatMoney, parseAmount, toInputString } from "@/lib/money";
import { computeSplit, type SplitMethod, type SplitRule } from "@/server/domain/split";
import { DomainError } from "@/server/domain/errors";
import { computeNextDueDate, scheduleLabel, WEEKDAY_NAMES, type RecurringFrequency } from "@/server/domain/recurring";
import { Button, Card, cx, ErrorText, Field, Input, inputClass, Select } from "./ui";

type Member = { userId: string; nickname: string };
type AccountOpt = { id: string; label: string; ownerId: string | null };
type CategoryOpt = { id: string; name: string; icon: string };

export interface RecurringInitial {
  id: string;
  name: string;
  note: string;
  amount: number;
  categoryId: string | null;
  accountId: string;
  split: SplitRule;
  frequency: RecurringFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  month: number | null;
  startDate: string;
  endDate: string | null;
  updatedAt: string;
}

const METHODS: Array<{ id: Exclude<SplitMethod, "SHARES">; label: string }> = [
  { id: "EQUAL", label: "平分" },
  { id: "RATIO", label: "比例" },
  { id: "AMOUNT", label: "金額" },
  { id: "FULL", label: "一人負擔" },
];
const FREQS: Array<{ id: RecurringFrequency; label: string }> = [
  { id: "WEEKLY", label: "每週" },
  { id: "MONTHLY", label: "每月" },
  { id: "YEARLY", label: "每年" },
];

/** 固定支出設定表單。只是排程規則，不會產生任何交易。 */
export function RecurringForm({ me, partner, accounts, categories, today, initial }: {
  me: Member;
  partner: Member | null;
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  today: string;
  initial?: RecurringInitial;
}) {
  const members = useMemo(() => [me, ...(partner ? [partner] : [])], [me, partner]);
  const [name, setName] = useState(initial?.name ?? "");
  const [amountStr, setAmountStr] = useState(initial ? toInputString(initial.amount) : "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts.find((a) => a.ownerId === me.userId)?.id ?? accounts[0]?.id ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [frequency, setFrequency] = useState<RecurringFrequency>(initial?.frequency ?? "MONTHLY");
  const [dayOfWeek, setDayOfWeek] = useState(initial?.dayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(initial?.dayOfMonth ?? 1);
  const [month, setMonth] = useState(initial?.month ?? 1);
  const [startDate, setStartDate] = useState(initial?.startDate ?? today);
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");

  const init = initial?.split;
  const [method, setMethod] = useState<Exclude<SplitMethod, "SHARES">>(
    (init?.method === "SHARES" ? "EQUAL" : init?.method) ?? "EQUAL",
  );
  const [myRatio, setMyRatio] = useState(String(init?.method === "RATIO" ? init.participants.find((p) => p.userId === me.userId)?.value ?? 50 : 50));
  const [myAmountStr, setMyAmountStr] = useState(
    init?.method === "AMOUNT" ? toInputString(init.participants.find((p) => p.userId === me.userId)?.value ?? 0) : "",
  );
  const [fullUser, setFullUser] = useState(init?.method === "FULL" ? init.participants[0]?.userId ?? me.userId : me.userId);

  const amount = parseAmount(amountStr);
  const split: SplitRule = useMemo(() => {
    if (!partner) return { method: "FULL", participants: [{ userId: me.userId }] };
    switch (method) {
      case "RATIO": {
        const mine = Math.min(100, Math.max(0, Number(myRatio) || 0));
        return { method: "RATIO", participants: [{ userId: me.userId, value: mine }, { userId: partner.userId, value: Math.round((100 - mine) * 100) / 100 }] };
      }
      case "AMOUNT": {
        const mine = parseAmount(myAmountStr) ?? 0;
        return { method: "AMOUNT", participants: [{ userId: me.userId, value: mine }, { userId: partner.userId, value: Math.max(0, (amount ?? 0) - mine) }] };
      }
      case "FULL":
        return { method: "FULL", participants: [{ userId: fullUser }] };
      default:
        return { method: "EQUAL", participants: members.map((m) => ({ userId: m.userId })) };
    }
  }, [method, myRatio, myAmountStr, fullUser, amount, me.userId, partner, members]);

  const preview = useMemo(() => {
    if (!amount) return { lines: null as null | Array<{ userId: string; amount: number }>, error: null as string | null };
    try {
      return { lines: computeSplit(amount, split), error: null };
    } catch (e) {
      return { lines: null, error: e instanceof DomainError ? e.message : "分帳設定不正確" };
    }
  }, [amount, split]);
  const shareOf = (userId: string) => preview.lines?.find((l) => l.userId === userId)?.amount ?? 0;

  const schedule = { frequency, dayOfWeek: frequency === "WEEKLY" ? dayOfWeek : null, dayOfMonth: frequency === "WEEKLY" ? null : dayOfMonth, month: frequency === "YEARLY" ? month : null };
  const nextDue = (() => {
    try {
      return computeNextDueDate(schedule, { startDate, endDate: endDate || null, today });
    } catch {
      return null;
    }
  })();

  const payload = JSON.stringify({
    ...(initial ? { id: initial.id, expectedUpdatedAt: initial.updatedAt } : {}),
    name: name.trim(),
    note,
    amount: amount ?? 0,
    categoryId: categoryId || null,
    accountId,
    split,
    ...schedule,
    startDate,
    endDate: endDate || null,
  });
  const [state, action, pending] = useActionState(saveRecurringAction, undefined);
  const account = accounts.find((a) => a.id === accountId);
  const payer = account ? (account.ownerId === null ? "共同帳戶付款（不產生欠款）" : account.ownerId === me.userId ? "我付款" : `${partner?.nickname ?? ""}付款`) : "";
  const canSubmit = !!name.trim() && !!amount && !!accountId && !!startDate && !preview.error && !pending;

  return (
    <form action={action} className="pb-submit-bar space-y-4 px-4">
      <input type="hidden" name="payload" value={payload} />

      <Card className="space-y-3">
        <Field label="名稱"><Input aria-label="名稱" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="例如：房租、Netflix" /></Field>
        <Field label="金額">
          <Input aria-label="金額" inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0" className="h-14 text-2xl font-bold" />
        </Field>
        <Field label="分類（選填）">
          <Select aria-label="分類" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">不分類</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </Select>
        </Field>
        <Field label="付款帳戶" hint={payer}>
          <Select aria-label="付款帳戶" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
        </Field>
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-medium text-stone-600">多久一次</p>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1">
          {FREQS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFrequency(f.id)} className={cx("h-9 rounded-lg text-sm", frequency === f.id ? "bg-white font-semibold shadow-sm" : "text-stone-500")}>
              {f.label}
            </button>
          ))}
        </div>
        {frequency === "WEEKLY" && (
          <Field label="星期幾">
            <Select aria-label="星期幾" value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
              {WEEKDAY_NAMES.map((w, i) => <option key={w} value={i}>{w}</option>)}
            </Select>
          </Field>
        )}
        {frequency !== "WEEKLY" && (
          <div className={cx("grid gap-3", frequency === "YEARLY" ? "grid-cols-2" : "grid-cols-1")}>
            {frequency === "YEARLY" && (
              <Field label="月份">
                <Select aria-label="月份" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1} 月</option>)}
                </Select>
              </Field>
            )}
            <Field label="幾號" hint={dayOfMonth > 28 ? "該月沒有這天時，會改成當月最後一天" : undefined}>
              <Select aria-label="幾號" value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))}>
                {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1} 日</option>)}
              </Select>
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="開始日期"><Input aria-label="開始日期" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="結束日期（選填）"><Input aria-label="結束日期" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        </div>
        <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800" data-testid="recurring-preview">
          {scheduleLabel(schedule)}・下一次應付日：{!startDate ? "請先選開始日期" : nextDue ?? "已結束（超過結束日期）"}
          <br />
          建立設定不會扣任何帳戶，也不會產生記帳；到了應付日再由你按「產生記帳」。
        </p>
      </Card>

      {partner && (
        <Card>
          <p className="mb-2 text-sm font-medium text-stone-600">怎麼分</p>
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-stone-100 p-1">
            {METHODS.map((m) => (
              <button key={m.id} type="button" onClick={() => setMethod(m.id)} className={cx("h-9 rounded-lg text-sm", method === m.id ? "bg-white font-semibold shadow-sm" : "text-stone-500")}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {method === "RATIO" && (
              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="flex items-center gap-1">
                  我
                  <input aria-label="我的百分比" inputMode="decimal" value={myRatio} onChange={(e) => setMyRatio(e.target.value.replace(/[^\d.]/g, ""))} className="h-9 w-16 rounded-lg border border-stone-200 text-center" />
                  %
                </label>
                <span>{partner.nickname} {Math.round((100 - Number(myRatio || 0)) * 100) / 100}%</span>
              </div>
            )}
            {method === "AMOUNT" && (
              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="flex items-center gap-1">
                  我 $
                  <input aria-label="我負擔的金額" inputMode="decimal" value={myAmountStr} onChange={(e) => setMyAmountStr(e.target.value.replace(/[^\d.,]/g, ""))} className="h-9 w-24 rounded-lg border border-stone-200 text-center" placeholder="0" />
                </label>
                <span>{partner.nickname} {formatMoney(Math.max(0, (amount ?? 0) - (parseAmount(myAmountStr) ?? 0)))}</span>
              </div>
            )}
            {method === "FULL" && (
              <div className="grid grid-cols-2 gap-2">
                {members.map((m) => (
                  <button key={m.userId} type="button" onClick={() => setFullUser(m.userId)} className={cx("h-10 rounded-lg text-sm", fullUser === m.userId ? "bg-brand-100 font-semibold text-brand-700 ring-2 ring-brand-500" : "bg-stone-100")}>
                    全部由{m.userId === me.userId ? "我" : m.nickname}負擔
                  </button>
                ))}
              </div>
            )}
          </div>
          {preview.error && <p className="mt-3 text-sm text-red-600">{preview.error}</p>}
          {preview.lines && (
            <div className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-sm" data-testid="recurring-split">
              {members.map((m) => (
                <div key={m.userId} className="flex justify-between">
                  <span className="text-stone-500">{m.userId === me.userId ? "我" : m.nickname}負擔</span>
                  <span>{formatMoney(shareOf(m.userId))}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Field label="備註（選填）">
        <textarea aria-label="備註" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={cx(inputClass, "h-auto py-2.5")} />
      </Field>

      <ErrorText>{state?.error}</ErrorText>
      <div className="sticky-submit-bar">
        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {pending ? "儲存中…" : initial ? "儲存修改" : "建立固定支出"}
        </Button>
      </div>
    </form>
  );
}
