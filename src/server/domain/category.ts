/**
 * 分類管理的純邏輯（Phase 3-4 D）。
 *
 * 只做「日常記帳真的用得到」的事：名稱、圖示、停用／啟用。
 * 刻意不做子分類、預算綁定、自動分類。
 */
import { toIconKey, type IconName } from "../../lib/icons";
import { assert } from "./errors";

export const CATEGORY_KINDS = ["EXPENSE", "INCOME"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export const CATEGORY_KIND_LABEL: Record<CategoryKind, string> = { EXPENSE: "支出", INCOME: "收入" };

export const CATEGORY_NAME_MAX = 10;

/**
 * 分類管理可以選的圖示。存的是 `src/lib/icons.ts` 的 icon key，
 * **不是 emoji**（畫面一律用 lucide 的線性 SVG 呈現）。
 */
export const CATEGORY_ICONS: IconName[] = [
  "tag", "utensils", "utensils-crossed", "coffee", "bus", "car", "fuel", "house", "lightbulb", "smartphone",
  "package", "shopping-bag", "shirt", "clapperboard", "gamepad", "plane", "hotel", "pill", "stethoscope", "dog",
  "gift", "scissors", "book", "piggy-bank", "banknote", "receipt", "coins", "heart",
];

/** 名稱正規化：去掉前後空白、把中間的連續空白收成一個。 */
export function normalizeCategoryName(input: string): string {
  return input.replace(/[\s　]+/g, " ").trim();
}

/** 比對用的鍵：忽略大小寫與空白差異（同帳本同類型不可重複）。 */
export function categoryNameKey(input: string): string {
  return normalizeCategoryName(input).replace(/\s+/g, "").toLocaleLowerCase("zh-TW");
}

/** 驗證並回傳整理過的名稱。 */
export function assertCategoryName(input: string): string {
  const name = normalizeCategoryName(input);
  assert(name.length >= 1, "CATEGORY_NAME", "請輸入分類名稱");
  assert(name.length <= CATEGORY_NAME_MAX, "CATEGORY_NAME", `分類名稱最多 ${CATEGORY_NAME_MAX} 個字`);
  return name;
}

export function assertCategoryKind(kind: string): CategoryKind {
  assert((CATEGORY_KINDS as readonly string[]).includes(kind), "CATEGORY_KIND", "分類類型不正確");
  return kind as CategoryKind;
}

/**
 * 圖示：只接受清單裡的 icon key，避免變成任意字串。
 * 舊資料（emoji）會被 `toIconKey()` 轉成對應的 key，不會遺失分類本身。
 */
export function normalizeCategoryIcon(input: string | null | undefined): string {
  const key = toIconKey(input);
  return (CATEGORY_ICONS as string[]).includes(key) ? key : CATEGORY_ICONS[0];
}
