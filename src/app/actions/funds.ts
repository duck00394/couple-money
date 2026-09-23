"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/server/context";
import { formatMoney, parseAmount } from "@/lib/money";
import { DomainError } from "@/server/domain/errors";
import { addFundEntry, cancelFundEntry, cancelRewardDeposit, createFund, depositRewards, updateFund, type FundInput } from "@/server/services/funds";
import { str, toActionState, type ActionState } from "@/server/actions";

function parseFund(form: FormData): FundInput {
  const raw = str(form, "target").trim();
  const target = raw ? parseAmount(raw) : null;
  if (raw && !target) throw new DomainError("FUND_TARGET", "請輸入正確的目標金額");
  return { name: str(form, "name"), emoji: str(form, "emoji"), description: str(form, "description"), targetAmount: target, dueDate: str(form, "dueDate") || null };
}

export async function saveFundAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "id");
  let fundId = id;
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    if (id) {
      await updateFund(ctx, id, { ...parseFund(form), isArchived: str(form, "isArchived") === "true" }, str(form, "expectedUpdatedAt") || null);
      return { ok: "已儲存" };
    }
    fundId = (await createFund(ctx, parseFund(form))).id;
  });
  if (state?.error || id) {
    revalidatePath("/", "layout");
    return state;
  }
  revalidatePath("/", "layout");
  redirect(`/funds/${fundId}`);
}

export async function fundEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const type = str(form, "type") === "WITHDRAW" ? "WITHDRAW" : "DEPOSIT";
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const amount = parseAmount(str(form, "amount"));
    if (!amount) throw new DomainError("FUND_AMOUNT", "請輸入正確的金額");
    const who = str(form, "userId");
    await addFundEntry(ctx, {
      fundId: str(form, "fundId"),
      type,
      amount,
      userId: who === "JOINT" ? null : who,
      accountId: str(form, "accountId") || null,
      note: str(form, "note"),
      occurredOn: str(form, "occurredOn"),
      clientRequestId: str(form, "clientRequestId"),
    });
    return { ok: type === "DEPOSIT" ? "已投入基金" : "已從基金取回" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function cancelFundEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await cancelFundEntry(ctx, str(form, "id"));
  });
  revalidatePath("/", "layout");
  return state;
}

export async function depositRewardsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const e = await depositRewards(ctx, {
      fundId: str(form, "fundId"),
      targetAccountId: str(form, "targetAccountId"),
      sourceAccountId: str(form, "sourceAccountId") || null,
      note: str(form, "note"),
      occurredOn: str(form, "occurredOn"),
      clientRequestId: str(form, "clientRequestId"),
    });
    return { ok: `已入金 ${formatMoney(e.amount)}，基金實際金額已增加` };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function cancelRewardDepositAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await cancelRewardDeposit(ctx, str(form, "id"));
  });
  revalidatePath("/", "layout");
  return state;
}
