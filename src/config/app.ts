/** App 名稱與品牌設定集中在這裡，改名只需要改這個檔案。 */
export const APP = {
  name: "Couple Money",
  shortName: "CoupleMoney",
  tagline: "一起記帳、一起存錢、一起完成目標。",
  defaultCurrency: "TWD",
  locale: "zh-TW",
  timeZone: "Asia/Taipei",
} as const;

/**
 * 照片上傳（記帳收據、任務打卡照片、使用者頭貼）是否開放。
 *
 * 檔案實際上放在 `src/server/storage`：本機是 `UPLOAD_DIR`（預設 `.uploads/`），
 * 線上是 Vercel Blob（設了 `BLOB_READ_WRITE_TOKEN` 就自動切換）。
 *
 * 這個開關只是**額外的手動關閉**，預設是開的。伺服器那一側還會再檢查一次
 * 儲存層是不是持久的：部署在 Vercel 卻沒有接 Blob 時會自動拒絕上傳，
 * 不會讓使用者傳完才發現檔案不見（見 `storage().durable`）。
 */
export const PHOTOS_ENABLED = process.env.NEXT_PUBLIC_PHOTOS_ENABLED !== "0";
