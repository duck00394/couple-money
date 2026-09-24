"use client";

import { useActionState, useState } from "react";
import { withdrawRewardsAction } from "@/app/actions/rewards";
import { formatMoney } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { ArtIcon } from "./ArtIcon";
import { Button, Card, ErrorText, Field, Select } from "./ui";

/**
 * 我的獎勵餘額 + 提列。
 * A-2 只做「能操作」，版面與文案留到下一階段統一處理。
 */
export function RewardBox({
  balance,
  earned,
  settled,
  accounts,
  requestId,
  canWrite,
}: {
  balance: number;
  earned: number;
  settled: number;
  accounts: Array<{ id: string; label: string }>;
  requestId: string;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof withdrawRewardsAction>>, fd: FormData) => {
    const r = await withdrawRewardsAction(prev, fd);
    if (r?.ok) setOpen(false);
    return r;
  }, undefined);

  return (
    <Card className="space-y-3" data-testid="reward-box">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <ArtIcon name="coins" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-800">我的獎勵</p>
          <p className="text-[11px] text-stone-500">累計獲得 {formatMoney(earned)}・已提列 {formatMoney(settled)}</p>
        </div>
        <p className="amount text-xl text-stone-800" data-testid="reward-balance">{formatMoney(balance)}</p>
      </div>

      {state?.ok && <p className="text-sm text-emerald-700" role="status">{state.ok}</p>}

      {canWrite && balance > 0 && !open && (
        <Button variant="secondary" className="w-full" onClick={() => setOpen(true)} data-testid="reward-withdraw-open">
          提列 {formatMoney(balance)} 到帳戶
        </Button>
      )}

      {canWrite && open && (
        <ActionForm action={action} className="space-y-3 rounded-2xl bg-stone-100/70 p-3" data-testid="reward-withdraw-form">
          <input type="hidden" name="clientRequestId" value={requestId} />
          <Field label="收到哪個帳戶" hint="提列後會建立一筆收入，帳戶餘額才會增加">
            <Select name="accountId" aria-label="收款帳戶" required>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </Select>
          </Field>
          <ErrorText>{state?.error}</ErrorText>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={pending} data-testid="reward-withdraw-submit">{pending ? "提列中…" : "確定提列"}</Button>
          </div>
        </ActionForm>
      )}

      {balance <= 0 && <p className="text-xs text-stone-500">完成任務就會累積獎勵，累積後可以提列成真正的收入。</p>}
    </Card>
  );
}
