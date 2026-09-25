"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/server/context";
import { DomainError } from "@/server/domain/errors";
import { addReceipt, removeReceipt } from "@/server/services/receipts";
import { str, toActionState, type ActionState } from "@/server/actions";

export async function addReceiptAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const file = form.get("receipt");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("UPLOAD_EMPTY", "請先選一張照片");
    await addReceipt(ctx, str(form, "transactionId"), file);
    return { ok: "已加上收據" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function removeReceiptAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await removeReceipt(ctx, str(form, "id"));
    return { ok: "已刪除這張收據" };
  });
  revalidatePath("/", "layout");
  return state;
}
