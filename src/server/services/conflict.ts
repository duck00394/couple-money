import { assert } from "../domain/errors";

/**
 * 兩支手機同時編輯同一筆設定時的樂觀鎖。
 * 畫面載入時把 updatedAt 一起帶進表單，送出時比對；不一樣代表另一半剛剛改過，
 * 直接擋下來，避免用舊資料覆蓋掉對方的修改（lost update）。
 * 沒有帶 expected（例如測試或舊版頁面）就不檢查。
 */
export function assertFresh(before: { updatedAt: Date }, expected: string | null | undefined, label: string) {
  if (!expected) return;
  const t = new Date(expected).getTime();
  assert(
    Number.isFinite(t) && t === before.updatedAt.getTime(),
    "STALE_EDIT",
    `另一半剛剛修改過這${label}，請重新整理頁面後再編輯（避免蓋掉對方的修改）`,
  );
}
