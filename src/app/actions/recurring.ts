"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppContext } from "@/server/context";
import { DomainError } from "@/server/domain/errors";
import {
  createRecurring, deleteRecurring, generateRecurring, setRecurringActive, updateRecurring,
} from "@/server/services/recurring";
import { str, toActionState, type ActionState } from "@/server/actions";

const schema = z.object({
  id: z.string().optional(),
  expectedUpdatedAt: z.string().optional(),
  name: z.string().min(1, "請輸入名稱").max(30),
  note: z.string().max(500),
  amount: z.number().int().positive(),
  categoryId: z.string().nullable(),
  accountId: z.string().min(1, "請選擇付款帳戶"),
  split: z.object({
    method: z.enum(["EQUAL", "RATIO", "AMOUNT", "FULL", "SHARES"]),
    participants: z.array(z.object({ userId: z.string(), value: z.number().optional() })).min(1),
  }),
  frequency: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]),
  dayOfWeek: z.number().int().nullable(),
  dayOfMonth: z.number().int().nullable(),
  month: z.number().int().nullable(),
  startDate: z.string(),
  endDate: z.string().nullable(),
});

function parse(form: FormData) {
  try {
    const r = schema.safeParse(JSON.parse(str(form, "payload")));
    if (!r.success) throw new DomainError("RECURRING_INPUT", r.error.issues[0]?.message ?? "資料格式不正確");
    return r.data;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError("RECURRING_INPUT", "資料格式不正確，請重新整理頁面");
  }
}

export async function saveRecurringAction(_: ActionState, form: FormData): Promise<ActionState> {
  let target = "/recurring";
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const { id, expectedUpdatedAt, ...input } = parse(form);
    if (id) {
      await updateRecurring(ctx, id, input, undefined, expectedUpdatedAt);
      target = `/recurring/${id}`;
    } else {
      await createRecurring(ctx, input);
    }
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect(target);
}

/** 到期後產生真正的記帳。dueDate 是畫面上顯示的應付日，用來擋重複送出。 */
export async function generateRecurringAction(_: ActionState, form: FormData): Promise<ActionState> {
  let skipped = false;
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const r = await generateRecurring(ctx, str(form, "id"), { expectedDueDate: str(form, "dueDate") || null });
    skipped = r.skipped;
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  return { ok: skipped ? "這一期先前產生過又被刪除了，已跳到下一期" : "已產生記帳" };
}

export async function setRecurringActiveAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await setRecurringActive(ctx, str(form, "id"), str(form, "active") === "true").then(() => undefined);
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  return { ok: str(form, "active") === "true" ? "已重新啟用" : "已停用" };
}

export async function deleteRecurringAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await deleteRecurring(ctx, str(form, "id"));
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect("/recurring");
}
