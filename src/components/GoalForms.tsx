"use client";

import { useActionState } from "react";
import { goalStatusAction, saveGoalAction } from "@/app/actions/goals";
import { ActionForm } from "./ActionForm";
import { IconPicker } from "./EmojiPicker";
import { Button, ErrorText, Field, Input, Select, inputClass, cx } from "./ui";

const GOAL_ICONS = ["target", "map", "plane", "house", "gem", "car", "cake", "sofa", "dog", "laptop", "graduation-cap", "mountain"] as const;

export interface GoalFormValues {
  id?: string;
  name: string;
  description: string;
  emoji: string;
  target: string;
  startDate: string;
  deadline: string;
  fundId: string;
  isActive: boolean;
  /** 編輯時帶上讀取到的版本，避免覆蓋另一半的修改 */
  updatedAt?: string;
}

export function GoalForm({ funds, values }: { funds: Array<{ id: string; name: string }>; values: GoalFormValues }) {
  const [state, action, pending] = useActionState(saveGoalAction, undefined);
  return (
    <ActionForm action={action} className="space-y-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {values.id && <input type="hidden" name="expectedUpdatedAt" value={values.updatedAt ?? ""} />}
      <Field label="封面圖示"><IconPicker options={GOAL_ICONS} defaultValue={values.emoji} label="封面圖示" /></Field>
      <Field label="目標名稱"><Input name="name" required maxLength={30} defaultValue={values.name} placeholder="例如：日本旅行" /></Field>
      <Field label="描述（選填）">
        <textarea name="description" maxLength={300} rows={2} defaultValue={values.description} className={cx(inputClass, "h-auto py-2.5")} />
      </Field>
      <Field label="目標金額"><Input name="target" inputMode="decimal" required defaultValue={values.target} placeholder="30000" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="開始日期"><Input name="startDate" type="date" required defaultValue={values.startDate} /></Field>
        <Field label="目標日期（選填）"><Input name="deadline" type="date" defaultValue={values.deadline} /></Field>
      </div>
      <Field label="目前金額來自哪個基金" hint="目標的目前金額 = 基金餘額（由每一筆基金紀錄加總）">
        <Select name="fundId" defaultValue={values.fundId} aria-label="連結基金">
          {!values.id && <option value="NEW">＋ 建立同名基金</option>}
          <option value="">不連結基金（手動標記完成）</option>
          {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" value="true" defaultChecked={values.isActive} className="h-5 w-5 accent-brand-500" />
        啟用（停用的目標不會出現在首頁與列表）
      </label>
      <ErrorText>{state?.error}</ErrorText>
      <Button className="w-full" disabled={pending}>{pending ? "儲存中…" : values.id ? "儲存目標" : "建立目標"}</Button>
    </ActionForm>
  );
}

export function GoalStatusButtons({ id, achieved }: { id: string; achieved: boolean }) {
  const [state, action, pending] = useActionState(goalStatusAction, undefined);
  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="intent" value={achieved ? "reopen" : "achieve"} />
        <Button variant="secondary" className="w-full" disabled={pending}>{achieved ? "改回進行中" : "標記為已完成"}</Button>
      </form>
      <ErrorText>{state?.error}</ErrorText>
    </div>
  );
}
