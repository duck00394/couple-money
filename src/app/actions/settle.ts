"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/server/context";
import { parseAmount } from "@/lib/money";
import { cancelSettlement, settle } from "@/server/services/ledger";
import { DomainError } from "@/server/domain/errors";
import { str, toActionState, type ActionState } from "@/server/actions";

export async function settleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const amount = parseAmount(str(form, "amount"));
    if (!amount) throw new DomainError("SETTLE_AMOUNT", "請輸入正確的結算金額");
    await settle(ctx, {
      fromUserId: str(form, "fromUserId"),
      toUserId: str(form, "toUserId"),
      fromAccountId: str(form, "fromAccountId"),
      toAccountId: str(form, "toAccountId"),
      amount,
      note: str(form, "note"),
      clientRequestId: str(form, "clientRequestId"),
    });
    return { ok: "結算完成" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function cancelSettlementAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await cancelSettlement(ctx, str(form, "id"));
  });
  revalidatePath("/", "layout");
  return state;
}
