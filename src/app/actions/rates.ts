"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/server/context";
import { removeRate, setRate } from "@/server/services/rates";
import { parseRatePair } from "@/server/domain/exchange";
import { str, toActionState, type ActionState } from "@/server/actions";

/**
 * 設定一個幣別的匯率。
 *
 * 表單只收一個數字：「1 JPY = ? TWD」的那個 ?，由 parseRatePair() 轉成存起來的整數對。
 * 這裡**只寫 ExchangeRate**，一行都不會碰既有的 Transaction ——
 * 所以改匯率不可能影響歷史交易。
 */
export async function setRateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const currency = str(form, "currency");
    const pair = parseRatePair(str(form, "baseValue"), ctx.book.baseCurrency);
    if (!pair) return { error: `請輸入 1 ${currency} 等於多少 ${ctx.book.baseCurrency}（小數最多六位）` };
    await setRate(ctx, { currency, ...pair });
    return { ok: `已更新 ${currency} 匯率（只影響之後的新交易）` };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function removeRateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await removeRate(ctx, str(form, "currency"));
    return { ok: "已移除，已經記過的交易不受影響" };
  });
  revalidatePath("/", "layout");
  return state;
}
