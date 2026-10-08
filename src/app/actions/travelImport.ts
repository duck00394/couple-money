"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/server/auth/session";
import { DomainError } from "@/server/domain/errors";
import { importTravel, previewTravel, type ImportTarget } from "@/server/services/travelImport";

const FAIL = "匯出失敗，旅行資料沒有被刪除。";
const fail = (e: unknown) => {
  if (e instanceof DomainError) return { error: e.message };
  console.error("travel-import failed", e instanceof Error ? e.name : "unknown"); // 不印任何交易內容
  return { error: FAIL };
};

/** 匯入頁開啟時：未登入回 login，登入了就回預覽。票由 client 從網址 # 後面讀出來，用 POST body 傳進來。 */
export async function previewTravelAction(ticket: string) {
  const user = await getCurrentUser();
  if (!user) return { login: true as const };
  try {
    return { preview: await previewTravel(user.id, ticket) };
  } catch (e) {
    return fail(e);
  }
}

export async function importTravelAction(ticket: string, target: ImportTarget) {
  const user = await getCurrentUser();
  if (!user) return { login: true as const };
  try {
    const r = await importTravel(user.id, ticket, target.mode === "existing" ? { mode: "existing", bookId: String(target.bookId) } : { mode: "new" });
    revalidatePath("/", "layout");
    return { result: r };
  } catch (e) {
    return fail(e);
  }
}
