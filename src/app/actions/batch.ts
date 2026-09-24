"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/server/context";
import { assertBatchAction } from "@/server/domain/batch";
import { batchAddTags, batchDeleteTransactions, batchSetCategory } from "@/server/services/batch";
import { str, toActionState, type ActionState } from "@/server/actions";

/** 批次操作：只接受畫面上明確選取的 transaction id，帳本一律取自登入者的 context。 */
export async function batchAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const ids = form.getAll("ids").map((v) => String(v));
    const action = assertBatchAction(str(form, "action"));
    if (action === "DELETE") {
      const r = await batchDeleteTransactions(ctx, ids);
      return { ok: `已刪除 ${r.done} 筆` };
    }
    if (action === "CATEGORY") {
      const categoryId = str(form, "categoryId") || null;
      const r = await batchSetCategory(ctx, ids, categoryId);
      return { ok: `已改好 ${r.done} 筆的分類` };
    }
    const r = await batchAddTags(ctx, ids, str(form, "tags"));
    return { ok: `已為 ${r.done} 筆加上標籤` };
  });
  revalidatePath("/", "layout");
  return state;
}
