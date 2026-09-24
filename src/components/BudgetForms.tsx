"use client";

import { useActionState, useState } from "react";
import { createBudgetAction, deleteBudgetAction, toggleBudgetAction, updateBudgetAction } from "@/app/actions/budgets";
import { BUDGET_STATE_LABEL, type BudgetState } from "@/server/domain/budget";
import { formatMoney, toInputString } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { ArtTile } from "./ArtIcon";
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
  subjectKey: string;
  personName: string | null;
  progress: { amount: number; spent: number; remaining: number; ratio: number; state: BudgetState; over: number };
}

export interface BudgetGroupItem {
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryArchived: boolean;
  spent: number;
  couple: BudgetItem | null;
  people: BudgetItem[];
  combined: { amount: number; fromPeople: boolean; progress: BudgetItem["progress"] } | null;
}

const TONE: Record<BudgetState, { bar: string; text: string; chip: string }> = {
  OK: { bar: "bg-emerald-400", text: "text-stone-800", chip: "bg-emerald-50 text-emerald-700" },
  NEAR: { bar: "bg-orange-400", text: "text-orange-700", chip: "bg-orange-50 text-orange-700" },
  OVER: { bar: "bg-red-500", text: "text-red-600", chip: "bg-red-50 text-red-700" },
};

/** 一條「誰・用了多少／多少・剩多少」的進度列。共同與個人共用同一個樣式。 */
function ProgressLine({
  label,
  progress,
  testIdPrefix,
  dim,
}: {
  label: string;
  progress: BudgetItem["progress"];
  testIdPrefix?: string;
  dim?: boolean;
}) {
  const tone = TONE[progress.state];
  const t = (name: string) => (testIdPrefix ? `${testIdPrefix}-${name}` : undefined);
  return (
    <div className={cx(dim && "opacity-50")}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="shrink-0 text-stone-500">{label}</span>
        <span className="tnum min-w-0 flex-1 truncate text-right text-stone-500">
          <span className={cx("font-semibold", tone.text)} data-testid={t("spent")}>{formatMoney(progress.spent)}</span>
          <span className="text-stone-400"> / {formatMoney(progress.amount)}</span>
        </span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-100"
        role="progressbar"
        aria-valuenow={Math.round(progress.ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} 已用 ${Math.round(progress.ratio * 100)}%`}
      >
        <div
          className={cx("h-full rounded-full transition-all duration-500 ease-out", tone.bar)}
          style={{ width: `${Math.max(0, Math.min(1, progress.ratio)) * 100}%` }}
        />
      </div>
      <p className="tnum mt-1 text-[11px] text-stone-400" data-testid={t("remaining")}>
        {progress.over > 0 ? `超支 ${formatMoney(progress.over)}` : `剩餘 ${formatMoney(progress.remaining)}`}
      </p>
    </div>
  );
}

/** 單筆預算的操作列（編輯、停用、刪除）。 */
function BudgetActions({ budget }: { budget: BudgetItem }) {
  const who = budget.personName ? `${budget.categoryName}・${budget.personName}` : budget.categoryName;
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof updateBudgetAction>>, fd: FormData) => {
    const r = await updateBudgetAction(prev, fd);
    if (r?.ok) setEditing(false);
    return r;
  }, undefined);
  const [toggleState, toggle, toggling] = useActionState(toggleBudgetAction, undefined);
  const [deleteState, remove, deleting] = useActionState(deleteBudgetAction, undefined);
  const busy = pending || toggling || deleting;

  return (
    <>
      <div className="mt-1.5 flex items-center gap-3 text-xs text-stone-400">
        <button className="underline underline-offset-2" onClick={() => setEditing((v) => !v)} disabled={busy} aria-label={`編輯 ${who} 的預算`}>編輯</button>
        <form action={toggle} className="inline">
          <input type="hidden" name="id" value={budget.id} />
          <input type="hidden" name="active" value={String(!budget.isActive)} />
          <button className="underline underline-offset-2" disabled={busy} aria-label={`${budget.isActive ? "停用" : "啟用"} ${who} 的預算`}>
            {budget.isActive ? "停用" : "啟用"}
          </button>
        </form>
        <form
          action={remove}
          className="inline"
          onSubmit={(e) => {
            if (!confirm(`刪除「${who}」這個月的預算？記帳資料不會受影響。`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={budget.id} />
          <button className="text-red-500 underline underline-offset-2" disabled={busy} aria-label={`刪除 ${who} 的預算`}>刪除</button>
        </form>
      </div>

      {editing && (
        <ActionForm action={action} className="mt-2 space-y-2 rounded-2xl bg-stone-100/70 p-3" data-testid="budget-edit">
          <input type="hidden" name="id" value={budget.id} />
          <Field label="預算金額">
            <Input name="amount" inputMode="decimal" defaultValue={toInputString(budget.progress.amount)} aria-label={`${who} 的預算金額`} />
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
    </>
  );
}

/**
 * 一個分類的預算群組：最上面是「共同」（有共同預算就用它，否則是個人預算合計），
 * 下面依序是每個人的個人預算。
 */
export function BudgetGroupCard({ group, canWrite }: { group: BudgetGroupItem; canWrite: boolean }) {
  const primary = group.couple ?? null;
  return (
    <div className="px-4 py-4" data-testid="budget-row">
      <div className="mb-3 flex items-center gap-3">
        <ArtTile name={group.categoryIcon} size={38} />
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-stone-800">
          {group.categoryName}
          {group.categoryArchived && <span className="ml-1 text-[11px] font-normal text-stone-400">（分類已停用）</span>}
        </p>
        {group.combined && (
          <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[group.combined.progress.state].chip)} data-testid="budget-state">
            {BUDGET_STATE_LABEL[group.combined.progress.state]}
          </span>
        )}
      </div>

      <div className="space-y-3.5">
        {group.combined && (
          <div>
            <ProgressLine
              label={group.combined.fromPeople ? "共同（兩人合計）" : "共同"}
              progress={group.combined.progress}
              testIdPrefix="budget"
              dim={!!primary && !primary.isActive}
            />
            {primary && !primary.isActive && <p className="mt-1 text-[11px] text-stone-400">已停用</p>}
            {primary && canWrite && <BudgetActions budget={primary} />}
            {!primary && group.combined.fromPeople && (
              <p className="mt-1 text-[11px] text-stone-400">這是兩個人的個人預算加起來的數字，沒有另外設共同預算。</p>
            )}
          </div>
        )}

        {group.people.map((p) => (
          <div key={p.id} data-testid="budget-person-row">
            <ProgressLine label={p.personName ?? "個人"} progress={p.progress} dim={!p.isActive} />
            {!p.isActive && <p className="mt-1 text-[11px] text-stone-400">已停用</p>}
            {canWrite && <BudgetActions budget={p} />}
          </div>
        ))}
      </div>

      {group.people.length > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-stone-400">
          個人的「已使用」是分帳後實際負擔（不是誰付的錢）：AA 的話兩個人各算一半。
        </p>
      )}
    </div>
  );
}

/** 新增這個月的預算：可以設共同預算，也可以一次設兩個人的個人預算。 */
export function NewBudgetForm({
  month,
  options,
  personalOptions,
  members,
}: {
  month: string;
  options: Array<{ id: string; name: string; icon: string }>;
  personalOptions: Array<{ id: string; name: string; icon: string }>;
  members: Array<{ userId: string; nickname: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"COUPLE" | "PERSONAL">("COUPLE");
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof createBudgetAction>>, fd: FormData) => {
    const r = await createBudgetAction(prev, fd);
    if (r?.ok) setOpen(false);
    return r;
  }, undefined);

  const list = mode === "COUPLE" ? options : personalOptions;
  if (options.length === 0 && personalOptions.length === 0) {
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
    <ActionForm action={action} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm" data-testid="new-budget">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="mode" value={mode} />

      <div>
        <p className="mb-1.5 text-sm font-medium text-stone-600">預算類型</p>
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-stone-100 p-1">
          {([["COUPLE", "共同"], ["PERSONAL", "個人"]] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cx("h-10 rounded-xl text-sm transition", mode === m ? "bg-white font-semibold text-stone-800 shadow-sm" : "text-stone-500")}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-stone-500">
          {mode === "COUPLE" ? "兩個人共用一份額度。" : "各自一份額度，已使用依分帳後實際負擔計算。"}
        </p>
      </div>

      <Field label="分類">
        <Select name="categoryId" aria-label="預算分類" key={mode}>
          {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>

      {mode === "COUPLE" ? (
        <Field label="這個月的共同預算" hint="只是提醒，超過也還是記得下去">
          <Input name="amount" inputMode="decimal" required placeholder="例如：8000" aria-label="預算金額" />
        </Field>
      ) : (
        <div className="space-y-3">
          {members.map((m) => (
            <Field key={m.userId} label={`${m.nickname} 的個人預算`}>
              <Input name={`amount:${m.userId}`} inputMode="decimal" placeholder="不填就不設定" aria-label={`${m.nickname} 的預算金額`} />
            </Field>
          ))}
        </div>
      )}

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
