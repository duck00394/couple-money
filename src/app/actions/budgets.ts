"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/server/context";
import { parseAmount } from "@/lib/money";
import { DomainError } from "@/server/domain/errors";
import { createBudgets, deleteBudget, setBudgetActive, updateBudget } from "@/server/services/budgets";
import { str, toActionState, type ActionState } from "@/server/actions";

function amountOf(form: FormData) {
  const parsed = parseAmount(str(form, "amount").trim());
  if (parsed === null) throw new DomainError("BUDGET_AMOUNT", "請輸入正確的金額");
  return parsed;
}

export async function createBudgetAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const personal = str(form, "mode") === "PERSONAL";
    // 個人預算：每個成員一個 amount:<userId> 欄位，沒填的那個人就不設定
    const entries = personal
      ? ctx.members
          .map((m) => ({ subjectKey: m.userId, raw: str(form, `amount:${m.userId}`).trim() }))
          .filter((e) => e.raw !== "")
          .map((e) => {
            const amount = parseAmount(e.raw);
            if (amount === null) throw new DomainError("BUDGET_AMOUNT", "請輸入正確的金額");
            return { subjectKey: e.subjectKey, amount };
          })
      : [{ subjectKey: "COUPLE", amount: amountOf(form) }];
    await createBudgets(ctx, {
      categoryId: str(form, "categoryId"),
      month: str(form, "month"),
      entries,
      note: str(form, "note"),
    });
    return { ok: "已設定預算" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function updateBudgetAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await updateBudget(ctx, str(form, "id"), { amount: amountOf(form), note: str(form, "note") });
    return { ok: "已更新預算" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function toggleBudgetAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const active = str(form, "active") === "true";
    await setBudgetActive(ctx, str(form, "id"), active);
    return { ok: active ? "已重新啟用" : "已停用" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function deleteBudgetAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await deleteBudget(ctx, str(form, "id"));
    return { ok: "已刪除預算" };
  });
  revalidatePath("/", "layout");
  return state;
}
