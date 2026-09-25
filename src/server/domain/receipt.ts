/**
 * 圖片驗證（純函式）：副檔名、大小、檔頭。
 * 打卡照片與記帳收據共用同一套規則，不重複定義。
 */
import { assert } from "./errors";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** 頭貼的上限比收據小：只是一張小圓圖，不需要 4MB */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
/** 每筆記帳最多幾張收據（私人使用，不做相簿） */
export const MAX_RECEIPTS = 3;

export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** 檔案內容真的是這個格式嗎（避免把別的檔案改副檔名上傳）。 */
export function sniffImage(buf: Uint8Array): "jpg" | "png" | "webp" | null {
  const b = Buffer.from(buf.subarray(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
  if (b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "webp";
  return null;
}

/** 人看得懂的大小文字（只用在錯誤訊息上）。 */
export function sizeLabel(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

/** 驗證 MIME、大小與檔頭，回傳副檔名。不合法就丟 DomainError。 */
export function assertImage(meta: { type: string; size: number }, buf: Uint8Array, maxBytes = MAX_UPLOAD_BYTES): string {
  const ext = IMAGE_TYPES[meta.type];
  assert(ext, "UPLOAD_TYPE", "只支援 JPG、PNG、WebP 圖片");
  assert(meta.size > 0 && meta.size <= maxBytes, "UPLOAD_SIZE", `照片太大（上限 ${sizeLabel(maxBytes)}）`);
  assert(sniffImage(buf) === ext, "UPLOAD_TYPE", "檔案內容不是圖片");
  return ext;
}
