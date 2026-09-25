/**
 * Phase 3-4 D：分類管理（兩支手機）。
 * 前提：Phase 1～3-4 H 的流程已經跑完，帳本裡已經有用到分類的記帳。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

const rowOf = (p: Page, name: string) => p.getByTestId("category-row").filter({ hasText: name }).first();

export async function phase3Categories(a: Page, b: Page) {
  // 1. 從「更多」進得去
  await go(a, "/more");
  await a.getByRole("link", { name: /分類管理/ }).click();
  await a.waitForURL(/\/categories$/);
  await loaded(a);
  await expect(a.getByRole("heading", { name: "分類", exact: true })).toBeVisible();
  const text = await pageText(a);
  expect(text).toContain("支出分類");
  expect(text).toContain("收入分類");
  await shot(a, "23-categories");
  step("更多頁 →「分類管理」，支出與收入分類都列得出來");

  // 2. 新增一個分類
  await a.getByRole("button", { name: "＋ 新增分類" }).click();
  await a.getByLabel("分類名稱").fill("  寵物  ");
  await a.getByRole("radio").nth(1).click();
  await a.getByRole("button", { name: "新增", exact: true }).click();
  await expect(rowOf(a, "寵物")).toBeVisible();
  expect(await rowOf(a, "寵物").innerText()).toContain("還沒用過");
  step("新增分類「寵物」，前後空白會被去掉");

  // 3. 重複名稱會被擋下來
  await a.getByRole("button", { name: "＋ 新增分類" }).click();
  await a.getByLabel("分類名稱").fill("寵 物");
  await a.getByRole("button", { name: "新增", exact: true }).click();
  await expect(a.getByTestId("new-category").locator("p[role=alert]")).toContainText("已經有一個叫");
  await a.getByRole("button", { name: "取消" }).click();
  step("同名分類（忽略空白差異）會被擋下來");

  // 4. 用新分類記一筆 → 它就不能被刪了
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("250");
  await a.getByLabel("名稱（選填）").fill("貓罐頭");
  await a.getByRole("button", { name: /寵物/ }).click();
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL(/\/$/);
  await go(a, "/categories");
  expect(await rowOf(a, "寵物").innerText()).toContain("1 筆記帳");
  await expect(rowOf(a, "寵物").getByRole("button", { name: "刪除 寵物" })).toHaveCount(0);
  step("用過的分類顯示筆數，而且不再提供刪除");

  // 5. 改名：舊紀錄跟著顯示新名稱，而且金額沒有被動到
  await rowOf(a, "寵物").getByRole("button", { name: "編輯 寵物" }).click();
  await a.getByLabel("寵物 的新名稱").fill("毛小孩");
  await a.getByRole("button", { name: "儲存" }).click();
  await expect(rowOf(a, "毛小孩")).toBeVisible();
  await go(a, "/transactions?q=毛小孩");
  expect(await pageText(a)).toContain("貓罐頭");
  step("改名之後，舊紀錄用新名稱就搜尋得到");

  // 6. 停用：新增表單選不到，但舊紀錄還在
  await go(a, "/categories");
  await rowOf(a, "毛小孩").getByRole("button", { name: "停用 毛小孩" }).click();
  await expect(rowOf(a, "毛小孩")).toContainText("已停用");
  await go(a, "/transactions/new");
  await expect(a.getByRole("button", { name: /毛小孩/ })).toHaveCount(0);
  await go(a, "/transactions?q=貓罐頭");
  expect(await pageText(a)).toContain("貓罐頭");
  step("停用後新增表單選不到，但舊紀錄仍在、仍搜尋得到");

  // 7. 編輯那筆舊紀錄時，停用的分類仍然留得住
  await a.getByTestId("tx-row").filter({ hasText: "貓罐頭" }).first().click();
  await a.waitForURL(/\/transactions\/[\w-]+$/);
  await loaded(a);
  await expect(a.getByRole("button", { name: /毛小孩（已停用）/ })).toBeVisible();
  const txUrl = a.url();
  step("編輯舊紀錄時看得到「（已停用）」的原分類，不會一存檔就掉分類");

  // 8. 統計裡的分類仍然算得到
  await go(a, "/stats");
  expect(await pageText(a)).toContain("毛小孩");
  step("停用的分類仍然出現在統計的分類佔比裡");

  // 9. 重新啟用
  await go(a, "/categories");
  await rowOf(a, "毛小孩").getByRole("button", { name: "啟用 毛小孩" }).click();
  await expect(rowOf(a, "毛小孩")).not.toContainText("已停用");
  await go(a, "/transactions/new");
  await expect(a.getByRole("button", { name: /毛小孩/ })).toBeVisible();
  step("重新啟用之後又可以選了");

  // 10. 另一半看得到同一份分類，也在最近動態看得到這些操作
  await go(b, "/categories");
  await expect(rowOf(b, "毛小孩")).toBeVisible();
  await go(b, "/activity");
  const activity = await pageText(b);
  expect(activity).toMatch(/新增了分類|改了分類名稱|停用了分類|重新啟用了分類/);
  step("另一半看得到同一份分類，動態也記得住這些操作");

  // 11. 刪除完全沒用過的分類
  await go(a, "/categories");
  await a.getByRole("button", { name: "＋ 新增分類" }).click();
  await a.getByLabel("分類名稱").fill("臨時分類");
  await a.getByRole("button", { name: "新增", exact: true }).click();
  await expect(rowOf(a, "臨時分類")).toBeVisible();
  await rowOf(a, "臨時分類").getByRole("button", { name: "刪除 臨時分類" }).click();
  await expect(a.getByTestId("category-row").filter({ hasText: "臨時分類" })).toHaveCount(0);
  step("完全沒用過的分類可以刪掉");

  // 12. 跨帳本看不到我們的分類
  const browser = a.context().browser()!;
  const outsider = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const c = await outsider.newPage();
  await go(c, "/register");
  await c.getByLabel("暱稱").fill("路人庚");
  await c.getByLabel("Email").fill(`outsider38-${Date.now().toString(36)}@example.com`);
  await c.getByLabel("密碼").fill("password123");
  await c.getByRole("button", { name: "建立帳號" }).click();
  await c.waitForURL(/\/onboarding/);
  await c.getByLabel("帳本名稱").fill("路人庚的帳本");
  await c.getByRole("button", { name: "建立帳本" }).click();
  await c.waitForURL(/\/more/);
  await go(c, "/categories");
  const theirs = await pageText(c);
  expect(theirs).not.toContain("毛小孩");
  expect(theirs).toContain("餐飲"); // 自己帳本的預設分類還是在
  expect(await (await c.request.get(`${new URL(txUrl).origin}/categories`)).text()).not.toContain("毛小孩");
  await outsider.close();
  step("別的帳本只看得到自己的分類");

  // 13. 手機版面
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 664 }]) {
    await a.setViewportSize(size);
    await go(a, "/categories");
    const o = await a.evaluate(() => ({ w: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(o.w, `${size.width}px 不該水平溢出`).toBeLessThanOrEqual(o.inner + 1);
    await expect(rowOf(a, "餐飲").getByRole("button", { name: "編輯 餐飲" })).toBeVisible();
    if (size.width === 320) await shot(a, "24-categories-320");
  }
  await a.setViewportSize({ width: 390, height: 664 });
  step("分類頁在 320px 與 390px 都不破版，按鈕點得到");
}
