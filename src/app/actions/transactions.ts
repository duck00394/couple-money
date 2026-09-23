"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppContext } from "@/server/context";
import { DomainError } from "@/server/domain/errors";
import { createTransaction, deleteTransaction, updateTransaction } from "@/server/services/ledger";
import { str, toActionState, type ActionState } from "@/server/actions";

const payloadSchema = z.object({
  type: z.enum(["EXPENSE", "INCOME"]),
  amount: z.number().int(),
  accountId: z.string().min(1, "請選擇帳戶"),
  categoryId: z.string().nullable(),
  title: z.string().max(50),
  note: z.string().max(500),
  occurredOn: z.string(),
  split: z.object({
    method: z.enum(["EQUAL", "RATIO", "AMOUNT", "FULL", "SHARES"]),
    participants: z.array(z.object({ userId: z.string(), value: z.number().optional() })).min(1),
  }),
  clientRequestId: z.string(),
  fundId: z.string().nullable().optional(),
  fundAccountId: z.string().nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  id: z.string().optional(),
  version: z.number().int().optional(),
});

function parse(form: FormData) {
  try {
    const r = payloadSchema.safeParse(JSON.parse(str(form, "payload")));
    if (!r.success) throw new DomainError("TX_INPUT", r.error.issues[0]?.message ?? "資料格式不正確");
    return r.data;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError("TX_INPUT", "資料格式不正確，請重新整理頁面");
  }
}

export async function saveTransactionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const { id, version, ...input } = parse(form);
    if (id) {
      await updateTransaction(ctx, id, version ?? 0, input);
    } else {
      await createTransaction(ctx, input);
    }
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  // 只接受站內路徑，避免開放式重新導向
  const returnTo = str(form, "returnTo");
  redirect(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/transactions");
}

export async function deleteTransactionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await deleteTransaction(ctx, str(form, "id"));
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect("/transactions");
}
