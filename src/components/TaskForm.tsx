"use client";

import { useActionState, useState } from "react";
import { deleteTaskAction, saveTaskAction } from "@/app/actions/tasks";
import { parseAmount, toInputString } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { Button, cx, ErrorText, Field, Input, Select, inputClass } from "./ui";
import { PHOTOS_ENABLED } from "@/config/app";

const DAYS = ["日", "一", "二", "三", "四", "五", "六"];
const EMOJIS = ["✅", "📚", "🏃", "💪", "🧘", "💧", "😴", "🧹", "🍳", "📵", "💌", "🚶"];

export interface TaskFormValues {
  id?: string;
  title: string;
  description: string;
  emoji: string;
  scope: "PERSONAL" | "SHARED";
  assigneeId: string | null;
  frequency: "DAILY" | "WEEKLY" | "CUSTOM";
  daysOfWeek: number;
  requiresApproval: boolean;
  requiresPhoto: boolean;
  rewardAmount: number;
  fundId: string | null;
  penaltyAmount: number;
  penaltyText: string;
  isActive: boolean;
  milestones: Array<{ days: number; bonusAmount: number; badgeEmoji: string; badgeName: string; rewardText: string }>;
  /** 編輯時帶上讀取到的版本（updatedAt），避免覆蓋另一半的修改 */
  updatedAt?: string;
}

type MsRow = { days: string; bonus: string; badgeEmoji: string; badgeName: string; rewardText: string };
const amountOrZero = (s: string) => (s.trim() === "" ? 0 : parseAmount(s) ?? -1);

export function TaskForm({ me, partner, funds, values, creatorName, isCreator = true }: {
  me: { userId: string; nickname: string };
  partner: { userId: string; nickname: string } | null;
  funds: Array<{ id: string; name: string }>;
  values: TaskFormValues;
  /** 任務建立者的暱稱（編輯時顯示權限說明） */
  creatorName?: string;
  /** 我是不是建立者：獎金、懲罰、週期、基金、里程碑、刪除只有建立者可以動 */
  isCreator?: boolean;
}) {
  const locked = !!values.id && !isCreator;
  const editing = !!values.id;
  const [title, setTitle] = useState(values.title);
  const [description, setDescription] = useState(values.description);
  const [emoji, setEmoji] = useState(values.emoji);
  const [who, setWho] = useState(values.scope === "SHARED" ? "SHARED" : values.assigneeId ?? me.userId);
  const [frequency, setFrequency] = useState(values.frequency);
  const [mask, setMask] = useState(values.daysOfWeek);
  const [approval, setApproval] = useState(values.requiresApproval);
  const [photo, setPhoto] = useState(values.requiresPhoto && PHOTOS_ENABLED);
  const [reward, setReward] = useState(values.rewardAmount ? toInputString(values.rewardAmount) : "");
  const [fundId, setFundId] = useState(values.fundId ?? "");
  const [penalty, setPenalty] = useState(values.penaltyAmount ? toInputString(values.penaltyAmount) : "");
  const [penaltyText, setPenaltyText] = useState(values.penaltyText);
  const [active, setActive] = useState(values.isActive);
  const [milestones, setMilestones] = useState<MsRow[]>(
    values.milestones.map((m) => ({ days: String(m.days), bonus: m.bonusAmount ? toInputString(m.bonusAmount) : "", badgeEmoji: m.badgeEmoji, badgeName: m.badgeName, rewardText: m.rewardText })),
  );
  const [state, action, pending] = useActionState(saveTaskAction, undefined);
  const [delState, del, deleting] = useActionState(deleteTaskAction, undefined);

  const effectiveMask = frequency === "DAILY" ? 127 : mask;
  const payload = JSON.stringify({
    title,
    description,
    emoji,
    scope: who === "SHARED" ? "SHARED" : "PERSONAL",
    assigneeId: who === "SHARED" ? null : who,
    frequency,
    daysOfWeek: effectiveMask,
    requiresApproval: approval,
    requiresPhoto: photo,
    rewardAmount: amountOrZero(reward),
    fundId: fundId || null,
    penaltyAmount: amountOrZero(penalty),
    penaltyText,
    isActive: active,
    milestones: milestones.filter((m) => m.days.trim()).map((m) => ({ days: Number(m.days), bonusAmount: amountOrZero(m.bonus), badgeEmoji: m.badgeEmoji, badgeName: m.badgeName, rewardText: m.rewardText })),
  });
  const setMs = (i: number, patch: Partial<MsRow>) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-4 px-4 pb-10">
      <ActionForm action={action} className="space-y-4">
        <input type="hidden" name="payload" value={payload} />
        <input type="hidden" name="id" value={values.id ?? ""} />
        {/* 樂觀鎖：另一半在我按儲存前改過這個任務，就擋下來不要覆蓋 */}
        <input type="hidden" name="expectedUpdatedAt" value={values.updatedAt ?? ""} />

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="圖示">
          {EMOJIS.map((e) => (
            <button key={e} type="button" role="radio" aria-checked={emoji === e} onClick={() => setEmoji(e)} className={cx("h-10 w-10 rounded-xl text-xl", emoji === e ? "bg-brand-100 ring-2 ring-brand-500" : "bg-white shadow-sm")}>{e}</button>
          ))}
        </div>
        <Field label="任務名稱"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={30} required placeholder="例如：英文 30 分鐘" /></Field>
        <Field label="描述（選填）"><textarea aria-label="任務描述" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} className={cx(inputClass, "h-auto py-2.5")} /></Field>

        <Field label="執行者" hint={editing ? "建立後不能修改執行者" : who === "SHARED" ? "共同任務：兩人任一人打卡就算今天完成" : undefined}>
          <Select value={who} onChange={(e) => setWho(e.target.value)} disabled={editing} aria-label="執行者">
            <option value={me.userId}>我的任務</option>
            {partner && <option value={partner.userId}>{partner.nickname} 的任務</option>}
            <option value="SHARED">共同任務</option>
          </Select>
        </Field>

        {locked && (
          <p className="rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-600" data-testid="task-locked-note">
            🔒 週期、獎金、懲罰、基金與里程碑只有建立者（{creatorName}）可以修改；名稱、說明、照片與確認設定、停用雙方都可以改。
          </p>
        )}
        <fieldset disabled={locked} className="space-y-4 disabled:opacity-60">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold">週期</p>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1">
            {([["DAILY", "每日"], ["WEEKLY", "每週"], ["CUSTOM", "自訂"]] as const).map(([f, l]) => (
              <button key={f} type="button" onClick={() => { setFrequency(f); if (f === "WEEKLY") setMask(1 << 6); if (f === "CUSTOM" && mask === 127) setMask(0b0111110); }} className={cx("h-9 rounded-lg text-sm", frequency === f ? "bg-white font-semibold shadow-sm" : "text-stone-500")}>{l}</button>
            ))}
          </div>
          {frequency !== "DAILY" && (
            <div className="mt-3 grid grid-cols-7 gap-1.5">
              {DAYS.map((d, i) => (
                <button key={d} type="button" aria-pressed={!!(mask & (1 << i))} aria-label={`週${d}`}
                  onClick={() => setMask(frequency === "WEEKLY" ? 1 << i : mask ^ (1 << i))}
                  className={cx("h-10 rounded-lg text-sm", mask & (1 << i) ? "bg-brand-500 font-semibold text-white" : "bg-stone-100 text-stone-500")}>
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold">完成條件</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} className="h-5 w-5 accent-brand-500" />需要對方確認</label>
          {PHOTOS_ENABLED && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} className="h-5 w-5 accent-brand-500" />需要上傳照片</label>}
        </div>

        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold">獎金與懲罰</p>
          <Field label="獎金／懲罰進出哪個基金" hint={funds.length === 0 ? "還沒有基金，請先到「目標」建立基金" : "獎金先記為「尚未入金」，到基金頁入金後才變成實際基金金額"}>
            <Select value={fundId} onChange={(e) => setFundId(e.target.value)} aria-label="獎金基金">
              <option value="">不連結基金（無金額）</option>
              {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="完成獎金"><Input aria-label="完成獎金" inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></Field>
            <Field label="漏做扣款"><Input aria-label="漏做扣款" inputMode="decimal" value={penalty} onChange={(e) => setPenalty(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></Field>
          </div>
          <Field label="非金錢懲罰（選填）" hint="排定日沒有完成，隔天會自動記一次懲罰（建立當天不算）">
            <Input aria-label="非金錢懲罰" value={penaltyText} onChange={(e) => setPenaltyText(e.target.value)} maxLength={100} placeholder="例如：洗碗一次" />
          </Field>
        </div>

        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold">連續打卡里程碑</p>
          {milestones.map((m, i) => (
            <div key={i} className="space-y-2 rounded-xl bg-stone-50 p-3 text-sm" data-testid="milestone-row">
              <div className="flex items-center gap-2">
                <input aria-label={`里程碑${i + 1}徽章圖示`} value={m.badgeEmoji} onChange={(e) => setMs(i, { badgeEmoji: e.target.value })} className="h-10 w-12 rounded-lg border border-stone-200 bg-white text-center text-lg" />
                <span>連續</span>
                <input aria-label={`里程碑${i + 1}天數`} inputMode="numeric" value={m.days} onChange={(e) => setMs(i, { days: e.target.value.replace(/\D/g, "") })} className="h-10 w-14 rounded-lg border border-stone-200 bg-white text-center" />
                <span>天</span>
                <button type="button" className="ml-auto px-2 text-stone-400" onClick={() => setMilestones(milestones.filter((_, j) => j !== i))} aria-label={`移除里程碑${i + 1}`}>✕</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input aria-label={`里程碑${i + 1}徽章名稱`} value={m.badgeName} onChange={(e) => setMs(i, { badgeName: e.target.value })} maxLength={20} placeholder="徽章名稱" className="h-10 rounded-lg border border-stone-200 bg-white px-2" />
                <input aria-label={`里程碑${i + 1}額外獎金`} inputMode="decimal" value={m.bonus} onChange={(e) => setMs(i, { bonus: e.target.value.replace(/[^\d.]/g, "") })} placeholder="額外獎金 $" className="h-10 rounded-lg border border-stone-200 bg-white px-2" />
              </div>
              <input aria-label={`里程碑${i + 1}非金錢獎勵`} value={m.rewardText} onChange={(e) => setMs(i, { rewardText: e.target.value })} maxLength={100} placeholder="非金錢獎勵（選填），例如：對方請吃甜點" className="h-10 w-full rounded-lg border border-stone-200 bg-white px-2" />
            </div>
          ))}
          <button type="button" className="text-sm font-semibold text-brand-600" onClick={() => setMilestones([...milestones, { days: "", bonus: "", badgeEmoji: "🏅", badgeName: "", rewardText: "" }])}>＋ 新增里程碑</button>
        </div>
        </fieldset>

        {editing && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-5 w-5 accent-brand-500" />啟用（停用後不會出現在今日任務，也不會產生懲罰）</label>
        )}
        <ErrorText>{state?.error}</ErrorText>
        <Button className="w-full" disabled={pending || !title.trim()}>{pending ? "儲存中…" : editing ? "儲存任務" : "建立任務"}</Button>
      </ActionForm>

      {editing && isCreator && (
        <form action={del} onSubmit={(e) => { if (!confirm("刪除任務？打卡、獎金與懲罰紀錄都會保留。")) e.preventDefault(); }}>
          <input type="hidden" name="id" value={values.id} />
          <ErrorText>{delState?.error}</ErrorText>
          <Button variant="danger" className="w-full" disabled={deleting}>刪除任務</Button>
        </form>
      )}
    </div>
  );
}
