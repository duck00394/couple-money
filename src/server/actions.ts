import { unstable_rethrow } from "next/navigation";
import { DomainError } from "./domain/errors";

export type ActionState = { error?: string; ok?: string } | undefined;

/**
 * 把可預期的商業錯誤轉成表單訊息；其他錯誤記錄後顯示通用訊息。
 * redirect()／notFound() 是用丟例外實作的，必須原樣往外丟，不能被當成錯誤吃掉。
 */
export async function toActionState(fn: () => Promise<void | ActionState>): Promise<ActionState> {
  try {
    return (await fn()) ?? {};
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof DomainError) return { error: e.message };
    console.error(e);
    return { error: "發生錯誤，請稍後再試" };
  }
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}
