"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/server/context";
import { DomainError } from "@/server/domain/errors";
import { parseAmount } from "@/lib/money";
import { createRefund, createTransfer } from "@/server/services/transfers";
import { str, toActionState, type ActionState } from "@/server/actions";

function amountOf(form: FormData, key = "amount") {
  const v = parseAmount(str(form, key));
  if (v === null || v <= 0) throw new DomainError("TX_AMOUNT", "請輸入正確的金額");
  return v;
}

export async function createTransferAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await createTransfer(ctx, {
      fromAccountId: str(form, "fromAccountId"),
      toAccountId: str(form, "toAccountId"),
      amount: amountOf(form),
      occurredOn: str(form, "occurredOn"),
      occurredTime: str(form, "occurredTime"),
      note: str(form, "note"),
      clientRequestId: str(form, "clientRequestId"),
    });
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect("/transactions?kind=TRANSFER");
}

export async function createRefundAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await createRefund(ctx, {
      originalId: str(form, "originalId"),
      amount: amountOf(form),
      accountId: str(form, "accountId"),
      occurredOn: str(form, "occurredOn"),
      occurredTime: str(form, "occurredTime"),
      note: str(form, "note"),
      clientRequestId: str(form, "clientRequestId"),
    });
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect(`/transactions/${str(form, "originalId")}`);
}
