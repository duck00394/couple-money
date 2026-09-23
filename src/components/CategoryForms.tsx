"use client";

import { useActionState, useState } from "react";
import { archiveCategoryAction, createCategoryAction, deleteCategoryAction, updateCategoryAction } from "@/app/actions/categories";
import { CATEGORY_ICONS, CATEGORY_NAME_MAX } from "@/server/domain/category";
import { ActionForm } from "./ActionForm";
import { EmojiPicker } from "./EmojiPicker";
import { Button, ErrorText, Field, Input, Select } from "./ui";

export interface CategoryItem {
  id: string;
  name: string;
  icon: string;
  kind: "EXPENSE" | "INCOME";
  isArchived: boolean;
  usedByTransactions: number;
  usedByRecurring: number;
  usedByBudget: number;
  deletable: boolean;
}

/** 一列分類：顯示用量，可改名、停用／啟用；完全沒用過的才給刪除。 */
export function CategoryRow({ category, canWrite }: { category: CategoryItem; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof updateCategoryAction>>, fd: FormData) => {
    const r = await updateCategoryAction(prev, fd);
    if (r?.ok) setEditing(false);
    return r;
  }, undefined);
  const [archiveState, archive, archiving] = useActionState(archiveCategoryAction, undefined);
  const [deleteState, remove, deleting] = useActionState(deleteCategoryAction, undefined);
  const used = category.usedByTransactions + category.usedByRecurring + category.usedByBudget;
  const busy = pending || archiving || deleting;

  return (
    <div className="px-4 py-3" data-testid="category-row">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-base">{category.icon}</span>
        <div className="min-w-0 flex-1">
          <p className={`truncate font-medium ${category.isArchived ? "text-stone-400 line-through" : ""}`}>{category.name}</p>
          <p className="text-[11px] text-stone-500">
            {used === 0 ? "還沒用過" : `${category.usedByTransactions} 筆記帳${category.usedByRecurring > 0 ? `・${category.usedByRecurring} 筆固定支出` : ""}${category.usedByBudget > 0 ? `・${category.usedByBudget} 個月有預算` : ""}`}
            {category.isArchived && "・已停用"}
          </p>
        </div>
        {canWrite && <div className="flex shrink-0 items-center gap-2 text-xs">
          <button className="text-stone-400 underline" onClick={() => setEditing((v) => !v)} aria-label={`編輯 ${category.name}`} disabled={busy}>編輯</button>
          <form action={archive} className="inline">
            <input type="hidden" name="id" value={category.id} />
            <input type="hidden" name="archived" value={String(!category.isArchived)} />
            <button className="text-stone-400 underline" disabled={busy} aria-label={`${category.isArchived ? "啟用" : "停用"} ${category.name}`}>
              {category.isArchived ? "啟用" : "停用"}
            </button>
          </form>
          {category.deletable && (
            <form
              action={remove}
              className="inline"
              onSubmit={(e) => {
                if (!confirm(`刪除「${category.name}」？這個分類還沒有任何紀錄在用。`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="id" value={category.id} />
              <button className="text-red-500 underline" disabled={busy} aria-label={`刪除 ${category.name}`}>刪除</button>
            </form>
          )}
        </div>}
      </div>

      {editing && (
        <ActionForm action={action} className="mt-2 space-y-2 rounded-xl bg-stone-50 p-3" data-testid="category-edit">
          <input type="hidden" name="id" value={category.id} />
          <Field label="名稱">
            <Input name="name" defaultValue={category.name} maxLength={CATEGORY_NAME_MAX} aria-label={`${category.name} 的新名稱`} />
          </Field>
          <Field label="圖示">
            <EmojiPicker name="icon" options={CATEGORY_ICONS} defaultValue={category.icon} />
          </Field>
          <ErrorText>{state?.error}</ErrorText>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>取消</Button>
            <Button disabled={pending}>{pending ? "儲存中…" : "儲存"}</Button>
          </div>
          <p className="text-[11px] text-stone-400">改名不會動到任何舊紀錄，舊紀錄會跟著顯示新名稱。</p>
        </ActionForm>
      )}
      <ErrorText>{archiveState?.error ?? deleteState?.error}</ErrorText>
    </div>
  );
}

/** 新增分類。 */
export function NewCategoryForm() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("EXPENSE");
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof createCategoryAction>>, fd: FormData) => {
    const r = await createCategoryAction(prev, fd);
    if (r?.ok) setOpen(false);
    return r;
  }, undefined);

  if (!open) {
    return (
      <>
        {state?.ok && <p className="mb-2 text-center text-sm text-emerald-600">{state.ok}</p>}
        <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>＋ 新增分類</Button>
      </>
    );
  }
  return (
    <ActionForm action={action} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm" data-testid="new-category">
      <Field label="類型">
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="EXPENSE">支出</option>
          <option value="INCOME">收入</option>
        </Select>
      </Field>
      <Field label="名稱">
        <Input name="name" required maxLength={CATEGORY_NAME_MAX} placeholder={kind === "EXPENSE" ? "例如：寵物" : "例如：股息"} aria-label="分類名稱" />
      </Field>
      <Field label="圖示">
        <EmojiPicker name="icon" options={CATEGORY_ICONS} />
      </Field>
      <ErrorText>{state?.error}</ErrorText>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>取消</Button>
        <Button disabled={pending}>{pending ? "新增中…" : "新增"}</Button>
      </div>
    </ActionForm>
  );
}
