"use client";

import { useActionState, useState } from "react";
import { createBudgetAction, deleteBudgetAction, toggleBudgetAction, updateBudgetAction } from "@/app/actions/budgets";
import { BUDGET_STATE_LABEL, type BudgetState } from "@/server/domain/budget";
import { formatMoney, toInputString } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { Button, cx, ErrorText, Field, Input, Select } from "./ui";

export interface BudgetItem {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryArchived: boolean;
  month: string;
  isActive: boolean;
  note: string | null;
  progress: { amount: number; spent: number; remaining: number; ratio: number; state: BudgetState; over: number };
}

const TONE: Record<BudgetState, { bar: string; chip: string }> = {
  OK: { bar: "bg-emerald-400", chip: "bg-emerald-50 text-emerald-700" },
  NEAR: { bar: "bg-orange-400", chip: "bg-orange-50 text-orange-700" },
  OVER: { bar: "bg-red-500", chip: "bg-red-50 text-red-700" },
};

/** 一列預算：預算／已支出／剩餘 + 進度條 + 狀態；可改金額、停用、刪除。 */
export function BudgetRow({ budget, canWrite }: { budget: BudgetItem; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof updateBudgetAction>>, fd: FormData) => {
    const r = await updateBudgetAction(prev, fd);
    if (r?.ok) setEditing(false);
    return r;
  }, undefined);
  const [toggleState, toggle, toggling] = useActionState(toggleBudgetAction, undefined);
  const [deleteState, remove, deleting] = useActionState(deleteBudgetAction, undefined);
  const busy = pending || toggling || deleting;
  const p = budget.progress;
  const tone = TONE[p.state];

  return (
    <div className={cx("px-4 py-3", !budget.isActive && "opacity-50")} data-testid="budget-row">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-stone-100 text-lg">{budget.categoryIcon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-stone-800">
            {budget.categoryName}
            {budget.categoryArchived && <span className="ml-1 text-[11px] text-stone-400">（分類已停用）</span>}
          </p>
          <p className="text-[11px] text-stone-500">
            預算 {formatMoney(p.amount)}・已支出 <span className="tnum" data-testid="budget-spent">{formatMoney(p.spent)}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          {budget.isActive ? (
            <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", tone.chip)} data-testid="budget-state">
              {BUDGET_STATE_LABEL[p.state]}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">已停用</span>
          )}
          <p className={cx("tnum mt-0.5 text-base font-bold", p.state === "OVER" ? "text-red-600" : "text-stone-800")} data-testid="budget-remaining">
            {p.over > 0 ? `超支 ${formatMoney(p.over)}` : `剩 ${formatMoney(p.remaining)}`}
          </p>
        </div>
      </div>

      <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuenow={Math.round(p.ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${budget.categoryName} 已用 ${Math.round(p.ratio * 100)}%`}>
        <div className={cx("h-full rounded-full transition-all duration-500 ease-out", tone.bar)} style={{ width: `${Math.max(0, Math.min(1, p.ratio)) * 100}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-stone-400">用掉 {Math.round(p.ratio * 100)}%{budget.note ? `・${budget.note}` : ""}</p>

      {canWrite && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <button className="text-stone-400 underline" onClick={() => setEditing((v) => !v)} disabled={busy} aria-label={`編輯 ${budget.categoryName} 的預算`}>編輯</button>
          <form action={toggle} className="inline">
            <input type="hidden" name="id" value={budget.id} />
            <input type="hidden" name="active" value={String(!budget.isActive)} />
            <button className="text-stone-400 underline" disabled={busy} aria-label={`${budget.isActive ? "停用" : "啟用"} ${budget.categoryName} 的預算`}>
              {budget.isActive ? "停用" : "啟用"}
            </button>
          </form>
          <form
            action={remove}
            className="inline"
            onSubmit={(e) => {
              if (!confirm(`刪除「${budget.categoryName}」這個月的預算？記帳資料不會受影響。`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={budget.id} />
            <button className="text-red-500 underline" disabled={busy} aria-label={`刪除 ${budget.categoryName} 的預算`}>刪除</button>
          </form>
        </div>
      )}

      {editing && (
        <ActionForm action={action} className="mt-2 space-y-2 rounded-2xl bg-stone-100/70 p-3" data-testid="budget-edit">
          <input type="hidden" name="id" value={budget.id} />
          <Field label="預算金額">
            <Input name="amount" inputMode="decimal" defaultValue={toInputString(p.amount)} aria-label={`${budget.categoryName} 的預算金額`} />
          </Field>
          <Field label="備註（選填）">
            <Input name="note" maxLength={100} defaultValue={budget.note ?? ""} aria-label="預算備註" />
          </Field>
          <ErrorText>{state?.error}</ErrorText>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>取消</Button>
            <Button disabled={pending}>{pending ? "儲存中…" : "儲存"}</Button>
          </div>
        </ActionForm>
      )}
      <ErrorText>{toggleState?.error ?? deleteState?.error}</ErrorText>
    </div>
  );
}

/** 新增這個月的分類預算。 */
export function NewBudgetForm({ month, options }: { month: string; options: Array<{ id: string; name: string; icon: string }> }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof createBudgetAction>>, fd: FormData) => {
    const r = await createBudgetAction(prev, fd);
    if (r?.ok) setOpen(false);
    return r;
  }, undefined);

  if (options.length === 0) {
    return <p className="mt-5 text-center text-xs text-stone-400">所有支出分類這個月都設過預算了。</p>;
  }
  if (!open) {
    return (
      <>
        {state?.ok && <p className="mb-2 text-center text-sm text-emerald-600">{state.ok}</p>}
        <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>＋ 新增預算</Button>
      </>
    );
  }
  return (
    <ActionForm action={action} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm" data-testid="new-budget">
      <input type="hidden" name="month" value={month} />
      <Field label="分類">
        <Select name="categoryId" aria-label="預算分類">
          {options.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </Select>
      </Field>
      <Field label="這個月的預算" hint="只是提醒，超過也還是記得下去">
        <Input name="amount" inputMode="decimal" required placeholder="例如：8000" aria-label="預算金額" />
      </Field>
      <Field label="備註（選填）">
        <Input name="note" maxLength={100} placeholder="例如：外食少一點" aria-label="新預算備註" />
      </Field>
      <ErrorText>{state?.error}</ErrorText>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>取消</Button>
        <Button disabled={pending}>{pending ? "新增中…" : "新增"}</Button>
      </div>
    </ActionForm>
  );
}
