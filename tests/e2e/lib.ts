import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
export const SHOTS = process.env.SHOTS_DIR ?? "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

export const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
export const step = (s: string) => console.log(`✓ ${s}`);

/** 等待換頁骨架消失（Next.js 的 loading.tsx 會先顯示骨架再串流真正的內容）。 */
export async function loaded(page: Page) {
  await page.locator('[data-testid="page-loading"]').waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
}

/** path 可以是 "/transactions" 或完整網址。 */
export async function go(page: Page, path: string) {
  await page.goto(path.startsWith("http") ? path : `${BASE}${path}`);
  await loaded(page);
}

/** 讀取整頁文字（空白壓成一格），方便用 toContain 比對。 */
export async function pageText(page: Page, path?: string) {
  if (path) await go(page, path);
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

/** 等待 locator 出現某段文字。 */
export async function expectText(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible();
}

export type Step = typeof step;
