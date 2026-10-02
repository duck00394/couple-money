"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/server/context";
import { removeRate, setRate } from "@/server/services/rates";
import { parseCurrencyAmount } from "@/lib/currency";
import { str, toActionState, type ActionState } from "@/server/actions";

/**
 * 設定一個幣別的匯率。
 *
 * 表單收的是人看得懂的那兩個數字：「100 JPY = 21.5 TWD」，
 * 左邊存成 foreignUnits、右邊換算成本位幣最小單位存成 baseMinor。
 * 這裡**只寫 ExchangeRate**，一行都不會碰既有的 Transaction ——
 * 所以改匯率不可能影響歷史交易。
 */
export async function setRateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const currency = str(form, "currency");
    const units = Number(str(form, "foreignUnits"));
    const baseMinor = parseCurrencyAmount(str(form, "baseValue"), ctx.book.baseCurrency);
    if (baseMinor === null) return { error: "請輸入匯率" };
    await setRate(ctx, { currency, foreignUnits: units, baseMinor });
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
