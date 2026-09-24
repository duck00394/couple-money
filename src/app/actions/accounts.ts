"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AccountType } from "@prisma/client";
import { getAppContext } from "@/server/context";
import { parseAmount, parseSignedAmount } from "@/lib/money";
import { DomainError } from "@/server/domain/errors";
import { adjustAccountBalance, cancelAdjustment, createAccount, updateAccount } from "@/server/services/ledger";
import { str, toActionState, type ActionState } from "@/server/actions";

export async function createAccountAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const type = str(form, "type") as AccountType;
    const raw = str(form, "balance").trim();
    const parsed = raw === "" ? 0 : parseAmount(raw);
    if (parsed === null) throw new DomainError("ACCOUNT_BALANCE", "請輸入正確的金額");
    // 信用卡輸入的是「目前未繳金額」，在總帳裡是負餘額
    const openingBalance = type === "CREDIT_CARD" ? -parsed : parsed;
    await createAccount(ctx, {
      name: str(form, "name"), type, shared: str(form, "owner") === "shared", openingBalance,
      clientRequestId: str(form, "clientRequestId") || undefined,
    });
    return { ok: "已新增帳戶" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function toggleAccountAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await updateAccount(ctx, str(form, "id"), { isActive: str(form, "isActive") === "true" });
  });
  revalidatePath("/", "layout");
  return state;
}

/** 餘額調整：輸入「實際正確的餘額」，系統算出差額並建立一筆 ADJUSTMENT 交易。 */
export async function adjustBalanceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const raw = str(form, "balance").trim();
    // 餘額可以是負的（銀行透支、信用卡溢繳）
    const parsed = raw === "" ? null : parseSignedAmount(raw);
    if (parsed === null) throw new DomainError("ADJUST_AMOUNT", "請輸入正確的金額");
    // 信用卡輸入的是「目前未繳金額」，在總帳裡是負餘額（與新增帳戶同一套規則）
    const targetBalance = str(form, "isCard") === "true" ? -parsed : parsed;
    await adjustAccountBalance(ctx, {
      accountId: str(form, "id"),
      targetBalance,
      note: str(form, "note"),
      clientRequestId: str(form, "clientRequestId"),
    });
    return { ok: "已建立餘額調整" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function cancelAdjustmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await cancelAdjustment(ctx, str(form, "id"));
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect("/accounts"); // 作廢後回到帳戶頁，直接看到恢復後的餘額
}
