"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/server/context";
import { parseAmount } from "@/lib/money";
import { toOwnerId } from "@/server/domain/purchase";
import {
  addFromTransaction, addKeyword, addManual, convertToManual, createCategory, createGroup, createTag,
  deleteCategory, deleteGroup, deleteKeyword, deleteTag, removeEntry, renameCategory, renameTag,
  seedStarter, updateEntry, updateGroup,
} from "@/server/services/purchases";
import { str, toActionState, type ActionState } from "@/server/actions";

/** 表單共用：作品、角色、歸屬。歸屬的 "JOINT" 在這裡才轉成 null。 */
const target = (form: FormData) => ({
  groupId: str(form, "groupId"),
  categoryId: str(form, "categoryId"),
  tagId: str(form, "tagId"),
  ownerId: toOwnerId(str(form, "ownerId")),
  note: str(form, "note"),
});

/* ───────────────────────── 作品 ───────────────────────── */

export async function createGroupAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await createGroup(ctx, { name: str(form, "name"), icon: str(form, "icon") });
    return { ok: "已新增作品" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function updateGroupAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await updateGroup(ctx, str(form, "id"), { name: str(form, "name"), icon: str(form, "icon") });
    return { ok: "已更新" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function deleteGroupAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await deleteGroup(ctx, str(form, "id"));
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect("/purchases/manage");
}

/* ───────────────────────── 角色 ───────────────────────── */

export async function createTagAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await createTag(ctx, str(form, "groupId"), str(form, "name"));
    return { ok: "已新增角色" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function renameTagAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await renameTag(ctx, str(form, "id"), str(form, "name"));
    return { ok: "已改名" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function deleteTagAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const r = await deleteTag(ctx, str(form, "id"));
    return {
      ok: r.movedCount > 0
        ? `已刪除，${r.movedCount} 筆購買紀錄移到「${r.fallbackName}」`
        : "已刪除",
    };
  });
  revalidatePath("/", "layout");
  return state;
}

/* ───────────────────────── 關鍵字 ───────────────────────── */

export async function addKeywordAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await addKeyword(ctx, {
      groupId: str(form, "groupId"),
      tagId: str(form, "tagId") || null,
      categoryId: str(form, "categoryId") || null,
      word: str(form, "word"),
    });
    return { ok: "已新增關鍵字" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function deleteKeywordAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await deleteKeyword(ctx, str(form, "id"));
  });
  revalidatePath("/", "layout");
  return state;
}

/* ───────────────────────── 購買紀錄 ───────────────────────── */

export async function addFromTransactionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await addFromTransaction(ctx, str(form, "transactionId"), target(form));
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  const back = str(form, "returnTo");
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : `/purchases/${str(form, "groupId")}`);
}

export async function addManualAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await addManual(ctx, {
      ...target(form),
      title: str(form, "title"),
      amount: parseAmount(str(form, "amount")) ?? 0,
      occurredOn: str(form, "occurredOn"),
    });
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  redirect(`/purchases/${str(form, "groupId")}`);
}

export async function updateEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const amount = parseAmount(str(form, "amount"));
    await updateEntry(ctx, str(form, "id"), {
      ...target(form),
      ...(str(form, "manual") === "1"
        ? { title: str(form, "title"), amount: amount ?? 0, occurredOn: str(form, "occurredOn") }
        : {}),
    });
    return { ok: "已儲存" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function removeEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await removeEntry(ctx, str(form, "id"));
  });
  if (state?.error) return state;
  revalidatePath("/", "layout");
  const back = str(form, "returnTo");
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : "/purchases");
}

export async function convertToManualAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await convertToManual(ctx, str(form, "id"));
    return { ok: "已轉成手動紀錄" };
  });
  revalidatePath("/", "layout");
  return state;
}

/* ───────────────────────── 商品分類 ───────────────────────── */

export async function createCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await createCategory(ctx, str(form, "groupId"), str(form, "name"));
    return { ok: "已新增商品分類" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function renameCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await renameCategory(ctx, str(form, "id"), str(form, "name"));
    return { ok: "已改名" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function deleteCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const r = await deleteCategory(ctx, str(form, "id"));
    return { ok: r.movedCount > 0 ? `已刪除，${r.movedCount} 筆移到「${r.fallbackName}」` : "已刪除" };
  });
  revalidatePath("/", "layout");
  return state;
}

/** 一鍵建立預設作品與角色（吉伊卡哇、排球少年）。只在還沒有任何作品時有用。 */
export async function seedStarterAction(): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const r = await seedStarter(ctx);
    return { ok: r.created > 0 ? `已建立 ${r.created} 個作品` : "已經有作品了" };
  });
  revalidatePath("/", "layout");
  return state;
}
