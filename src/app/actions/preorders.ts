"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppContext } from "@/server/context";
import { DomainError } from "@/server/domain/errors";
import { parseAmount } from "@/lib/money";
import {
  createPreorder, deletePreorder, payPreorder, setPreorderCancelled, updatePreorder,
} from "@/server/services/preorders";
import { str, toActionState, type ActionState } from "@/server/actions";

function parse(form: FormData) {
  const money = (field: string, required: boolean) => {
    const raw = str(form, field).trim();
    if (!raw) {
      if (required) throw new DomainError("PREORDER_AMOUNT", "請輸入商品金額");
      return 0;
    }
    const v = parseAmount(raw);
    if (v === null) throw new DomainError("PREORDER_AMOUNT", "請輸入正確的金額");
    return v;
  };
  const owner = str(form, "ownerId");
  // 明細品項與「誰付多少」用 JSON 帶（欄位是動態的，用 FormData 一個個拆很難維護）
  const extraSchema = z.object({
    items: z.array(z.object({
      name: z.string().max(40),
      unitAmount: z.number().int(),
      qty: z.number().int(),
      ownerId: z.string().nullable(),
    })).max(50),
    splitRule: z.object({
      method: z.enum(["EQUAL", "RATIO", "AMOUNT", "FULL", "SHARES"]),
      participants: z.array(z.object({ userId: z.string(), value: z.number().optional() })).min(1),
    }).nullable(),
  });
  const rawExtra = str(form, "extra");
  let extra: z.infer<typeof extraSchema> = { items: [], splitRule: null };
  if (rawExtra) {
    try {
      const r = extraSchema.safeParse(JSON.parse(rawExtra));
      if (!r.success) throw new DomainError("PREORDER_INPUT", r.error.issues[0]?.message ?? "資料格式不正確");
      extra = r.data;
    } catch (e) {
      if (e instanceof DomainError) throw e;
      throw new DomainError("PREORDER_INPUT", "資料格式不正確，請重新整理頁面");
    }
  }
  return {
    name: str(form, "name"),
    seller: str(form, "seller"),
    emoji: str(form, "emoji"),
    expectedOn: str(form, "expectedOn") || null,
    itemAmount: money("itemAmount", extra.items.length === 0),
    shipping: money("shipping", false),
    ownerId: owner === "JOINT" || owner === "" ? null : owner,
    note: str(form, "note"),
    items: extra.items,
    splitRule: extra.splitRule,
  };
}

export async function savePreorderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "id");
  let newId = id;
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    if (id) await updatePreorder(ctx, id, parse(form));
    else newId = (await createPreorder(ctx, parse(form))).id;
  });
  revalidatePath("/", "layout");
  if (state?.error) return state;
  if (id) return { ok: "已儲存" };
  redirect(`/preorders/${newId}`);
}

export async function cancelPreorderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const cancel = str(form, "cancel") === "true";
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await setPreorderCancelled(ctx, str(form, "id"), cancel);
    return { ok: cancel ? "已取消這張預購（已付的錢不會被動到）" : "已恢復這張預購" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function deletePreorderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await deletePreorder(ctx, str(form, "id"));
  });
  revalidatePath("/", "layout");
  if (state?.error) return state;
  redirect("/preorders");
}

const paySchema = z.object({
  amount: z.number().int().positive(),
  accountId: z.string().min(1),
  categoryId: z.string().nullable(),
  title: z.string(),
  note: z.string(),
  occurredOn: z.string(),
  split: z.object({ method: z.enum(["EQUAL", "RATIO", "AMOUNT", "FULL"]), participants: z.array(z.object({ userId: z.string(), value: z.number().optional() })) }),
});

/** 記錄一次付款：建立一筆普通的 EXPENSE，並掛到這張預購單上。 */
export async function payPreorderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const parsed = paySchema.safeParse(JSON.parse(str(form, "payload") || "{}"));
    if (!parsed.success) throw new DomainError("PREORDER_PAY", "資料格式不正確，請重新整理頁面");
    await payPreorder(ctx, str(form, "id"), { ...parsed.data, clientRequestId: str(form, "clientRequestId") });
    return { ok: "已記錄這次付款" };
  });
  revalidatePath("/", "layout");
  return state;
}
