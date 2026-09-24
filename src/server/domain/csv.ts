/**
 * CSV 產生（純函式）。
 *
 * 目標是「試算表打得開、數字算得動」：
 *   - UTF-8 BOM（台灣的 Excel 沒有 BOM 會變亂碼）
 *   - 金額一律是純數字（沒有 $ 與千分位），固定兩位小數，負號在最前面
 *   - 日期固定 YYYY-MM-DD，排序即是時間序
 *   - 文字欄位若以 = + - @ 開頭會加上單引號，避免被試算表當成公式執行
 */
export const CSV_BOM = "﻿";

const NUMERIC = /^-?\d+(\.\d+)?$/;
const FORMULA = /^[=+\-@\t\r]/;

/** 一個儲存格：先擋公式注入，再依 RFC 4180 加引號。 */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (s && !NUMERIC.test(s) && FORMULA.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
  // CRLF：Excel 對 CRLF 最保險
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/** 最小單位整數 → 試算表用的數字字串（固定兩位小數，保留負號）。 */
export function csvAmount(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 下載檔名：couple-money-交易明細-2026-09-20.csv */
export function csvFileName(kind: string, dateKey: string): string {
  return `couple-money-${kind}-${dateKey}.csv`;
}

/**
 * Content-Disposition。HTTP 標頭只能放 Latin-1，所以中文檔名要走 RFC 5987 的 filename*，
 * 另外給一個純 ASCII 的備援檔名給舊瀏覽器。
 */
export function contentDisposition(asciiName: string, utf8Name: string): string {
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`;
}
