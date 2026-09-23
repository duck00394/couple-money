"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/server/context";
import { createCategory, deleteCategory, setCategoryArchived, updateCategory } from "@/server/services/categories";
import { str, toActionState, type ActionState } from "@/server/actions";

export async function createCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await createCategory(ctx, { name: str(form, "name"), kind: str(form, "kind"), icon: str(form, "icon") });
    return { ok: "已新增分類" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function updateCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await updateCategory(ctx, str(form, "id"), { name: str(form, "name"), icon: str(form, "icon") });
    return { ok: "已更新分類" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function archiveCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const archived = str(form, "archived") === "true";
    await setCategoryArchived(ctx, str(form, "id"), archived);
    return { ok: archived ? "已停用" : "已重新啟用" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function deleteCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await deleteCategory(ctx, str(form, "id"));
    return { ok: "已刪除分類" };
  });
  revalidatePath("/", "layout");
  return state;
}
