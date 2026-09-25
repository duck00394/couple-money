/**
 * Phase 3-4 H：最近動態（兩支手機）。
 * 前提：Phase 1～3-4 G 的流程已經跑完，兩個人都做過不少操作。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

export async function phase3Activity(a: Page, b: Page) {
  // 1. 從「更多」進得去
  await go(a, "/more");
  await a.getByRole("link", { name: /最近動態/ }).click();
  await a.waitForURL(/\/activity$/);
  await loaded(a);
  await expect(a.getByRole("heading", { name: "最近動態" })).toBeVisible();
  await shot(a, "21-activity");
  step("更多頁 →「最近動態」");

  // 2. 阿本做一筆記帳，小艾的動態立刻看得到
  await go(b, "/transactions/new");
  await b.getByLabel("金額").fill("168");
  await b.getByLabel("名稱（選填）").fill("阿本的宵夜");
  await b.getByRole("button", { name: "記下來" }).click();
  await b.waitForURL(/\/$/);

  await go(a, "/activity");
  const firstRow = a.getByTestId("activity-row").first();
  await expect(firstRow).toContainText("新增了一筆支出");
  await expect(firstRow).toContainText("阿本的宵夜");
  await expect(firstRow).toContainText("$168");
  const text = await pageText(a);
  expect(text).toContain("今天");
  step("對方記一筆之後，我的動態最上面就看得到（含名稱與金額）");

  // 3. 點進去會到那筆記帳
  await firstRow.click();
  await a.waitForURL(/\/transactions\/[\w-]+$/);
  await loaded(a);
  // 支出的詳細頁是編輯表單，名稱在 input 的 value 裡（不在 innerText）
  await expect(a.getByLabel("名稱（選填）")).toHaveValue("阿本的宵夜");
  expect(await pageText(a)).toContain("$168");
  step("點動態可以直接跳到那筆記帳");

  // 4. 自己做的事不會出現在自己的動態
  await go(b, "/activity");
  const benText = await pageText(b);
  expect(benText).not.toContain("阿本的宵夜");
  expect(benText).toContain("小艾"); // 但看得到小艾做的事
  step("自己的操作不會變成自己的通知；對方的操作看得到");

  // 5. 作廢之後：動態還在，但點不過去了
  await go(b, "/transactions");
  await b.getByTestId("tx-row").filter({ hasText: "阿本的宵夜" }).first().click();
  await b.waitForURL(/\/transactions\/[\w-]+$/);
  await loaded(b);
  await b.getByRole("button", { name: "刪除這筆紀錄" }).click();
  await b.waitForURL(/\/transactions$/);

  await go(a, "/activity");
  const deleted = a.getByTestId("activity-row").first();
  await expect(deleted).toContainText("作廢了一筆支出");
  expect(await deleted.evaluate((el) => el.tagName)).toBe("DIV"); // 不是連結
  const rows = a.getByTestId("activity-row");
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    if ((await row.innerText()).includes("阿本的宵夜")) {
      expect(await row.evaluate((el) => el.tagName), "已作廢的記帳不該還連得過去").toBe("DIV");
    }
  }
  step("作廢後動態保留為「作廢了一筆支出」，但不再是可點的連結");

  // 6. 沒有未讀紅點（沒有已讀狀態就不做假 badge）
  await go(a, "/more");
  const moreText = await pageText(a);
  expect(moreText).not.toMatch(/最近動態\s*\d+/);
  step("沒有假的未讀數字");

  // 7. 匯出 CSV 不會污染動態
  const origin = new URL(a.url()).origin;
  const beforeExport = await a.getByTestId("activity-row").count().catch(() => 0);
  await b.request.get(`${origin}/api/export/transactions`);
  await go(a, "/activity");
  const list = await pageText(a);
  expect(list).not.toContain("匯出");
  expect(beforeExport).toBeGreaterThanOrEqual(0);
  step("對方匯出 CSV 不會變成通知");

  // 8. 別的帳本看不到我們的動態
  const browser = a.context().browser()!;
  const outsider = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const c = await outsider.newPage();
  await go(c, "/register");
  await c.getByLabel("暱稱").fill("路人己");
  await c.getByLabel("Email").fill(`outsider37-${Date.now().toString(36)}@example.com`);
  await c.getByLabel("密碼").fill("password123");
  await c.getByRole("button", { name: "建立帳號" }).click();
  await c.waitForURL(/\/onboarding/);
  await c.getByLabel("帳本名稱").fill("路人己的帳本");
  await c.getByRole("button", { name: "建立帳本" }).click();
  await c.waitForURL(/\/more/);
  await go(c, "/activity");
  const outsiderText = await pageText(c);
  for (const secret of ["阿本的宵夜", "火鍋", "小艾銀行", "日本旅遊"]) expect(outsiderText).not.toContain(secret);
  expect(outsiderText).toContain("最近沒有新的動態");
  const raw = await (await c.request.get(`${origin}/activity`)).text();
  for (const secret of ["阿本的宵夜", "火鍋", "小艾銀行"]) expect(raw).not.toContain(secret);
  await outsider.close();
  step("別的帳本只看得到自己的空動態，原始 payload 也不外洩");

  // 9. 手機版面：320 與 390 都不破版
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 664 }]) {
    await a.setViewportSize(size);
    await go(a, "/activity");
    const o = await a.evaluate(() => ({ w: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(o.w, `${size.width}px 不該水平溢出`).toBeLessThanOrEqual(o.inner + 1);
    await expect(a.getByRole("link", { name: "首頁" })).toBeVisible();
    if (size.width === 320) await shot(a, "22-activity-320");
  }
  await a.setViewportSize({ width: 390, height: 664 });
  step("動態頁在 320px 與 390px 都不破版，導覽列都在");
}
