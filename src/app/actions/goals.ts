"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/server/context";
import { parseAmount } from "@/lib/money";
import { DomainError } from "@/server/domain/errors";
import { createGoal, setGoalAchieved, updateGoal, type GoalInput } from "@/server/services/goals";
import { str, toActionState, type ActionState } from "@/server/actions";

function parseGoal(form: FormData): GoalInput {
  const target = parseAmount(str(form, "target"));
  if (!target) throw new DomainError("GOAL_TARGET", "請輸入正確的目標金額");
  return {
    name: str(form, "name"),
    description: str(form, "description"),
    emoji: str(form, "emoji"),
    targetAmount: target,
    startDate: str(form, "startDate"),
    deadline: str(form, "deadline") || null,
    fundId: str(form, "fundId") || null,
    isActive: str(form, "isActive") === "true",
  };
}

export async function saveGoalAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "id");
  let goalId = id;
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    if (id) await updateGoal(ctx, id, parseGoal(form), str(form, "expectedUpdatedAt") || null);
    else goalId = (await createGoal(ctx, parseGoal(form))).id;
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect(`/goals/${goalId}`);
}

export async function goalStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const intent = str(form, "intent");
  const id = str(form, "id");
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await setGoalAchieved(ctx, id, intent === "achieve");
  });
  revalidatePath("/", "layout");
  return state;
}
