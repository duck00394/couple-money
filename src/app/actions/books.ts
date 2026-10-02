"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/server/context";
import { requireUser } from "@/server/auth/session";
import { closeBook, createSecondaryBook, reopenBook, switchBook } from "@/server/services/books";
import { str, toActionState, type ActionState } from "@/server/actions";

/**
 * 切換目前操作的帳本。
 *
 * bookId 來自 client，所以 service 會**再驗一次 membership**（規格點 28）——
 * 這裡不做任何信任。
 *
 * 簽名是單參數的 `(FormData)`，因為切換鈕沒有任何欄位、也沒有錯誤要回填，
 * 直接用原生 `<form action={...}>` 就好，不需要 useActionState。
 */
export async function switchBookAction(form: FormData): Promise<void> {
  const user = await requireUser();
  await switchBook(user.id, str(form, "bookId"));
  revalidatePath("/", "layout");
  redirect("/");
}

/** 建立旅遊／自訂帳本。建立後直接切過去（規格點 12 建議的預設）。 */
export async function createBookAction2(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx, user } = await getAppContext();
    const book = await createSecondaryBook(ctx, user.id, {
      name: str(form, "name"),
      type: str(form, "type") === "CUSTOM" ? "CUSTOM" : "TRIP",
      baseCurrency: str(form, "baseCurrency") || null,
      startOn: str(form, "startOn") || null,
      endOn: str(form, "endOn") || null,
      note: str(form, "note") || null,
    });
    // 使用者是主動建立的，直接切過去才符合預期（規格點 12）
    if (str(form, "switchTo") !== "0") await switchBook(user.id, book.id);
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect(str(form, "switchTo") !== "0" ? "/" : `/books`);
}

/** 結案。原帳本會被 service 擋下來。沒有欄位，所以不需要 prev / form。 */
export async function closeBookAction(): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx, user } = await getAppContext();
    await closeBook(ctx, user.id);
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect("/books?closed=1");
}

/** 重新開啟，並自動切換過去（規格點 17）。 */
export async function reopenBookAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const user = await requireUser();
    await reopenBook(user.id, str(form, "bookId"));
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect("/");
}
