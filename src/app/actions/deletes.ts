"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/server/context";
import { decideDelete, requestDelete } from "@/server/services/deleteRequests";
import { str, toActionState, type ActionState } from "@/server/actions";

const listPage = "/goals";

export async function requestDeleteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const type = str(form, "entityType") === "FUND" ? "FUND" : "GOAL";
  let deleted = false;
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const r = await requestDelete(ctx, type, str(form, "entityId"));
    deleted = r.deleted;
    return { ok: r.deleted ? "已刪除" : "已送出刪除申請，等另一半確認" };
  });
  revalidatePath("/", "layout");
  if (deleted) redirect(listPage);
  return state;
}

export async function decideDeleteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const decision = str(form, "decision");
  let approved = false;
  let fromDetail = false;
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const r = await decideDelete(ctx, str(form, "id"), decision === "APPROVE" ? "APPROVE" : decision === "CANCEL" ? "CANCEL" : "REJECT");
    approved = r.status === "APPROVED";
    fromDetail = str(form, "fromDetail") === "1";
    return { ok: approved ? "已同意並刪除" : decision === "CANCEL" ? "已取消申請" : "已拒絕刪除" };
  });
  revalidatePath("/", "layout");
  if (approved && fromDetail) redirect(listPage);
  return state;
}
