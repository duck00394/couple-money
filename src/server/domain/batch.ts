/**
 * 批次操作的純邏輯（Phase 3-4 F）。
 *
 * 這裡只處理「選取的清單本身」：去重、驗證、筆數上限。
 * **所有財務規則都不在這裡**——批次刪除逐筆走既有的 `deleteTransactionIn()`，
 * 批次改分類／加標籤只動非金額欄位，規則都在 service 層沿用既有實作。
 */
import { assert } from "./errors";

/** 一次最多幾筆。超過一律由 server 端拒絕，不是只靠畫面限制。 */
export const MAX_BATCH = 50;

/** 可以批次做的事。沒列在這裡的一律不支援（尤其：金額、日期、帳戶、分帳、型別都不可批次改）。 */
export const BATCH_ACTIONS = ["DELETE", "CATEGORY", "TAGS"] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];
export const BATCH_ACTION_LABEL: Record<BatchAction, string> = {
  DELETE: "刪除",
  CATEGORY: "改分類",
  TAGS: "加標籤",
};

const ID = /^[\w-]{1,64}$/;

/**
 * 整理選取的 id：去空白、去重複、驗證格式、檢查數量。
 * 順序保留第一次出現的位置，回報失敗時比較好對照。
 */
export function normalizeSelection(input: readonly string[] | undefined | null): string[] {
  const ids: string[] = [];
  for (const raw of input ?? []) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    assert(ID.test(id), "BATCH_ID", "選取的紀錄不正確，請重新整理頁面");
    if (!ids.includes(id)) ids.push(id);
  }
  assert(ids.length > 0, "BATCH_EMPTY", "請先選取要處理的紀錄");
  assert(ids.length <= MAX_BATCH, "BATCH_TOO_MANY", `一次最多處理 ${MAX_BATCH} 筆，目前選了 ${ids.length} 筆`);
  return ids;
}

export function assertBatchAction(action: string): BatchAction {
  assert((BATCH_ACTIONS as readonly string[]).includes(action), "BATCH_ACTION", "不支援的批次操作");
  return action as BatchAction;
}
