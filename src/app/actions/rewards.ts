"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/server/context";
import { withdrawRewards } from "@/server/services/rewards";
import { str, toActionState, type ActionState } from "@/server/actions";

/** 把自己的獎勵餘額全部提列成一筆收入。只會動到自己的獎勵。 */
export async function withdrawRewardsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const tx = await withdrawRewards(ctx, {
      accountId: str(form, "accountId"),
      clientRequestId: str(form, "clientRequestId"),
    });
    return { ok: `已提列，收入紀錄已建立（${tx.id.slice(-6)}）` };
  });
  revalidatePath("/", "layout");
  return state;
}
