"use client";

import { useActionState, useState } from "react";
import { cancelFundEntryAction, cancelRewardDepositAction, depositRewardsAction, fundEntryAction, saveFundAction } from "@/app/actions/funds";
import { formatMoney, parseAmount } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { IconPicker } from "./EmojiPicker";
import { Button, cx, ErrorText, Field, Input, Select, inputClass } from "./ui";

const FUND_ICONS = ["piggy-bank", "plane", "house", "cake", "gem", "car", "gift", "dog", "smartphone", "sofa", "graduation-cap", "banknote"] as const;

export interface FundFormValues {
  id?: string;
  name: string;
  emoji: string;
  description: string;
  target: string;
  dueDate: string;
  isArchived?: boolean;
  /** 編輯時帶上讀取到的版本，避免覆蓋另一半的修改 */
  updatedAt?: string;
}

export function FundForm({ values, openingAccounts = [] }: { values: FundFormValues; openingAccounts?: Array<{ id: string; label: string }> }) {
  const [state, action, pending] = useActionState(saveFundAction, undefined);
  return (
    <ActionForm action={action} className="space-y-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {values.id && <input type="hidden" name="expectedUpdatedAt" value={values.updatedAt ?? ""} />}
      <Field label="圖示"><IconPicker options={FUND_ICONS} defaultValue={values.emoji} /></Field>
      <Field label="基金名稱"><Input name="name" required maxLength={20} defaultValue={values.name} placeholder="例如：日本旅遊基金" /></Field>
      <Field label="說明（選填）">
        <textarea name="description" maxLength={200} rows={2} defaultValue={values.description} className={cx(inputClass, "h-auto py-2.5")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="目標金額（選填）"><Input name="target" inputMode="decimal" defaultValue={values.target} placeholder="30000" /></Field>
        <Field label="到期日期（選填）"><Input name="dueDate" type="date" defaultValue={values.dueDate} /></Field>
      </div>
      {values.id && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isArchived" value="true" defaultChecked={values.isArchived} className="h-5 w-5 accent-brand-500" />
          封存（不能再投入，紀錄保留）
        </label>
      )}
      {/* 新建立時才有：一開就先把錢指定進來，不用再跑一次「投入」 */}
      {!values.id && openingAccounts.length > 0 && (
        <div className="rounded-2xl bg-brand-50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="初始金額（選填）">
              <Input name="openingAmount" inputMode="decimal" placeholder="0" data-testid="fund-opening" />
            </Field>
            <Field label="這筆錢放在">
              <Select name="openingAccountId" defaultValue={openingAccounts[0].id}>
                {openingAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </Select>
            </Field>
          </div>
          <p className="mt-2 text-xs text-stone-600">
            錢不會被搬走，只是把這個帳戶裡「還沒被指定用途」的錢指定給這個基金。留白就先建立空的基金。
          </p>
        </div>
      )}
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}
      <Button className="w-full" variant={values.id ? "secondary" : "primary"} disabled={pending}>{pending ? "儲存中…" : values.id ? "儲存設定" : "建立基金"}</Button>
    </ActionForm>
  );
}

export interface AccountOption {
  id: string;
  name: string;
  /** 帳戶可自由使用金額 */
  free: number;
  /** 這個基金在此帳戶的指定額度 */
  allocated: number;
  isCard: boolean;
  /** 共同帳戶或自己的帳戶（預設排前面） */
  preferred: boolean;
}

export function FundEntryForm({ fundId, balance, today, people, accounts }: {
  fundId: string;
  balance: number;
  today: string;
  people: Array<{ id: string; label: string }>;
  accounts: AccountOption[];
}) {
  const [type, setType] = useState<"DEPOSIT" | "WITHDRAW">("DEPOSIT");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");
  // 投入：可自由使用多的帳戶排前面；取回：額度多的排前面
  const options = type === "DEPOSIT"
    ? accounts.filter((a) => !a.isCard).sort((x, y) => Number(y.preferred) - Number(x.preferred) || y.free - x.free)
    : accounts.filter((a) => a.allocated > 0).sort((x, y) => Number(y.preferred) - Number(x.preferred) || y.allocated - x.allocated);
  const [accountId, setAccountId] = useState(options[0]?.id ?? "");
  const selected = options.find((a) => a.id === accountId) ?? options[0];
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof fundEntryAction>>, fd: FormData) => {
    const r = await fundEntryAction(prev, fd);
    if (r?.ok) {
      setAmount("");
      setRequestId(crypto.randomUUID());
    }
    return r;
  }, undefined);
  const limit = selected ? (type === "DEPOSIT" ? selected.free : selected.allocated) : 0;
  const parsed = parseAmount(amount) ?? 0; // 用整數解析，浮點數會讓「超過上限」的提示忽隱忽現
  return (
    <ActionForm action={action} className="space-y-3">
      <input type="hidden" name="fundId" value={fundId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="clientRequestId" value={requestId} />
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
        {(["DEPOSIT", "WITHDRAW"] as const).map((t) => (
          <button key={t} type="button" onClick={() => { setType(t); setAccountId(""); }} className={cx("h-10 rounded-lg text-sm", type === t ? "bg-white font-semibold shadow-sm" : "text-stone-500")}>
            {t === "DEPOSIT" ? "投入" : "取回"}
          </button>
        ))}
      </div>
      <Field
        label={type === "DEPOSIT" ? "錢在哪個帳戶（必填）" : "從哪個帳戶的額度取回"}
        hint={selected ? (type === "DEPOSIT" ? `可自由使用 ${formatMoney(selected.free)}` : `這個帳戶指定給本基金 ${formatMoney(selected.allocated)}`) : type === "WITHDRAW" ? `基金目前 ${formatMoney(balance)}，沒有可取回的帳戶額度` : undefined}
      >
        <Select name="accountId" aria-label="存放帳戶" value={selected?.id ?? ""} onChange={(e) => setAccountId(e.target.value)} required>
          {options.length === 0 && <option value="">沒有可用的帳戶</option>}
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}（{type === "DEPOSIT" ? `可用 ${formatMoney(a.free)}` : `額度 ${formatMoney(a.allocated)}`}）
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="金額">
          <Input name="amount" aria-label="基金金額" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0" required />
        </Field>
        <Field label={type === "DEPOSIT" ? "誰投入" : "誰取回"}>
          <Select name="userId" aria-label="投入者">
            {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
      </div>
      {selected && parsed > 0 && parsed > limit && (
        <p className="text-xs text-orange-600" data-testid="fund-limit-hint">
          {type === "DEPOSIT" ? `超過「${selected.name}」可自由使用的 ${formatMoney(Math.max(0, limit))}` : `超過這個帳戶的額度 ${formatMoney(limit)}`}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="日期"><Input name="occurredOn" type="date" defaultValue={today} required /></Field>
        <Field label="備註（選填）"><Input name="note" maxLength={200} /></Field>
      </div>
      <p className="text-xs text-stone-500">投入＝把帳戶裡的錢「指定用途」：帳戶餘額不變、不算欠款，但這筆錢不能再指定給別的基金。</p>
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}
      <Button className="w-full" disabled={pending || options.length === 0}>{pending ? "處理中…" : type === "DEPOSIT" ? "投入基金" : "從基金取回"}</Button>
    </ActionForm>
  );
}

/** 獎金入金：把尚未入金的獎金（扣掉懲罰）變成實際基金金額。 */
export function RewardDepositForm({ fundId, net, today, targets, sources }: {
  fundId: string;
  net: number;
  today: string;
  targets: AccountOption[];
  sources: AccountOption[];
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [target, setTarget] = useState(targets.find((t) => t.name.includes("共同"))?.id ?? targets[0]?.id ?? "");
  const [source, setSource] = useState("");
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof depositRewardsAction>>, fd: FormData) => {
    const r = await depositRewardsAction(prev, fd);
    if (r?.ok) setRequestId(crypto.randomUUID());
    return r;
  }, undefined);
  const t = targets.find((x) => x.id === target);
  const s = sources.find((x) => x.id === source);
  return (
    <ActionForm action={action} className="space-y-3" data-testid="reward-deposit-form">
      <input type="hidden" name="fundId" value={fundId} />
      <input type="hidden" name="clientRequestId" value={requestId} />
      <input type="hidden" name="occurredOn" value={today} />
      <Field label="入金到哪個帳戶">
        <Select name="targetAccountId" aria-label="入金帳戶" value={target} onChange={(e) => setTarget(e.target.value)}>
          {targets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </Field>
      <Field label="錢從哪裡來" hint={s ? `從「${s.name}」轉 ${formatMoney(net)} 到「${t?.name}」，會記一筆帳戶間轉帳` : `錢已經在「${t?.name ?? ""}」裡（可自由使用 ${formatMoney(t?.free ?? 0)}），只指定用途`}>
        <Select name="sourceAccountId" aria-label="入金來源" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">錢已經在入金帳戶裡</option>
          {sources.filter((a) => a.id !== target).map((a) => <option key={a.id} value={a.id}>從 {a.name} 轉入（可用 {formatMoney(a.free)}）</option>)}
        </Select>
      </Field>
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="text-sm text-emerald-600" role="status">{state.ok}</p>}
      <Button className="w-full" disabled={pending || net <= 0}>{pending ? "入金中…" : `入金 ${formatMoney(Math.max(0, net))}`}</Button>
    </ActionForm>
  );
}

export function CancelRewardDepositButton({ id, label }: { id: string; label?: string }) {
  const [state, action, pending] = useActionState(cancelRewardDepositAction, undefined);
  return (
    <form action={action} onSubmit={(e) => { if (!confirm("取消這筆獎金入金？轉帳會作廢，獎金回到「尚未入金」。")) e.preventDefault(); }} className="text-right">
      <input type="hidden" name="id" value={id} />
      <button className="text-xs text-stone-400 underline" disabled={pending} aria-label={`取消入金 ${label ?? ""}`.trim()}>取消入金</button>
      {state?.error && <p className="max-w-40 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

export function CancelFundEntryButton({ id, label }: { id: string; label?: string }) {
  const [state, action, pending] = useActionState(cancelFundEntryAction, undefined);
  return (
    <form action={action} onSubmit={(e) => { if (!confirm("取消這筆紀錄？")) e.preventDefault(); }} className="text-right">
      <input type="hidden" name="id" value={id} />
      <button className="text-xs text-stone-400 underline" disabled={pending} aria-label={`取消紀錄 ${label ?? ""}`.trim()}>取消</button>
      {state?.error && <p className="max-w-32 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
