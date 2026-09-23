"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppContext } from "@/server/context";
import { DomainError } from "@/server/domain/errors";
import { formatMoney } from "@/lib/money";
import { saveUpload } from "@/server/services/attachments";
import { cancelCheckIn, checkIn, createTask, deleteTask, editCheckIn, reviewCheckIn, updateTask, waivePenalty } from "@/server/services/tasks";
import { str, toActionState, type ActionState } from "@/server/actions";

const schema = z.object({
  title: z.string(),
  description: z.string(),
  emoji: z.string(),
  scope: z.enum(["PERSONAL", "SHARED"]),
  assigneeId: z.string().nullable(),
  frequency: z.enum(["DAILY", "WEEKLY", "CUSTOM"]),
  daysOfWeek: z.number().int(),
  requiresApproval: z.boolean(),
  requiresPhoto: z.boolean(),
  rewardAmount: z.number().int(),
  fundId: z.string().nullable(),
  penaltyAmount: z.number().int(),
  penaltyText: z.string(),
  isActive: z.boolean(),
  milestones: z.array(z.object({ days: z.number().int(), bonusAmount: z.number().int(), badgeEmoji: z.string(), badgeName: z.string(), rewardText: z.string() })),
});

export async function saveTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "id");
  let taskId = id;
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const parsed = schema.safeParse(JSON.parse(str(form, "payload") || "{}"));
    if (!parsed.success) throw new DomainError("TASK_INPUT", "資料格式不正確，請重新整理頁面");
    if (id) await updateTask(ctx, id, parsed.data, undefined, str(form, "expectedUpdatedAt") || null);
    else taskId = (await createTask(ctx, parsed.data)).id;
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect(`/tasks/${taskId}`);
}

export async function deleteTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await deleteTask(ctx, str(form, "id"));
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect("/tasks");
}

async function uploadIfAny(ctx: Awaited<ReturnType<typeof getAppContext>>["ctx"], form: FormData) {
  const file = form.get("photo");
  if (file instanceof File && file.size > 0) return (await saveUpload(ctx, file)).id;
  return undefined;
}

export async function checkInAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const photoId = await uploadIfAny(ctx, form);
    const r = await checkIn(ctx, str(form, "taskId"), { note: str(form, "note"), photoId });
    if (r.checkIn.status === "PENDING") return { ok: "已打卡，等另一半確認 ⏳" };
    const bonus = r.reached
      .map((m) => `${m.badgeEmoji} 達成「${m.badgeName}」${m.bonusAmount ? ` +${formatMoney(m.bonusAmount)}（尚未入金）` : ""}${m.rewardText ? `・${m.rewardText}` : ""}`)
      .join("　");
    return { ok: `完成！連續 ${r.streak} 天 🔥${bonus ? `　${bonus}` : ""}` };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function editCheckInAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const photoId = await uploadIfAny(ctx, form);
    await editCheckIn(ctx, str(form, "id"), { note: str(form, "note"), photoId });
    return { ok: "已更新打卡" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function cancelCheckInAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await cancelCheckIn(ctx, str(form, "id"));
    return { ok: "已取消打卡，獎金已收回" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function reviewCheckInAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await reviewCheckIn(ctx, str(form, "id"), str(form, "approve") === "true", str(form, "reviewNote"));
  });
  revalidatePath("/", "layout");
  return state;
}

export async function waivePenaltyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await waivePenalty(ctx, str(form, "id"));
  });
  revalidatePath("/", "layout");
  return state;
}
