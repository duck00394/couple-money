"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppContext } from "@/server/context";
import { DomainError } from "@/server/domain/errors";
import { createTransaction, deleteTransaction, updateTransaction } from "@/server/services/ledger";
import { addFromTransaction, autoAttach } from "@/server/services/purchases";
import { toOwnerId } from "@/server/domain/purchase";
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
  preorderId: z.string().nullable().optional(),
  // 購買紀錄（V12）。完全不參與金額計算，只決定這筆消費要不要也記進購買紀錄。
  purchase: z
    .object({ groupId: z.string().min(1), tagId: z.string().min(1), ownerId: z.string().nullable() })
    .nullable()
    .optional(),
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
  /** 記帳存檔之後才決定購買紀錄，寫在這裡讓 toast 有東西可以講 */
  let purchaseNote = "";
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const { id, version, purchase, ...input } = parse(form);
    if (id) {
      await updateTransaction(ctx, id, version ?? 0, input);
      return;
    }
    const created = await createTransaction(ctx, input);
    if (input.type !== "EXPENSE") return;
    try {
      if (purchase) {
        // 使用者自己勾了「加入購買紀錄」：照他選的作品、歸屬、角色
        await addFromTransaction(ctx, created.id, {
          groupId: purchase.groupId,
          tagId: purchase.tagId,
          ownerId: toOwnerId(purchase.ownerId),
        });
        purchaseNote = "，已加入購買紀錄";
      } else {
        // 沒勾就交給關鍵字。**只猜作品與角色，歸屬一律共同**，不從付款人推定。
        const auto = await autoAttach(ctx, created.id);
        if (auto) purchaseNote = "，已自動加入購買紀錄";
      }
    } catch {
      // 購買紀錄失敗絕對不能讓記帳跟著失敗 —— 錢已經記好了，這只是附帶的整理
      purchaseNote = "";
    }
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  // 「再記一筆」：一天常常連記好幾筆，這時候不換頁，留在表單上繼續記。
  // 只有新增才適用；編輯完就該回去看結果。
  if (str(form, "stay") === "1" && !str(form, "id")) return { ok: `已記下來${purchaseNote}` };
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
