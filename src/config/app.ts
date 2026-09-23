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
 * 照片上傳（記帳收據、任務打卡照片）是否開放。
 *
 * 照片目前是存在伺服器的檔案系統（`UPLOAD_DIR`，預設專案下的 `.uploads/`）。
 * 部署在**沒有持久硬碟**的平台（例如 Vercel）時，檔案寫進去就會消失，
 * 所以那種環境要把 `NEXT_PUBLIC_PHOTOS_ENABLED` 設成 `0` 把這個功能關掉，
 * 讓畫面直接說明「這個版本暫時不支援」，而不是讓使用者上傳完才發現不見。
 *
 * 本機執行不用設，預設就是開啟。
 */
export const PHOTOS_ENABLED = process.env.NEXT_PUBLIC_PHOTOS_ENABLED !== "0";
