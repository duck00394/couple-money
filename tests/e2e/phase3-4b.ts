/**
 * Phase 3-4 B：每月分類預算（兩支手機）。
 * 前提：Phase 1～3-4 D 的流程已經跑完，帳本裡已經有分類與消費。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

const money = (s: string) => Number(s.replace(/[^\d.-]/g, ""));
const rowOf = (p: Page, name: string) => p.getByTestId("budget-row").filter({ hasText: name }).first();

/** 下拉選單的文字前面有 emoji，所以用「包含名稱」的那個 option 的 value 來選。 */
async function selectCategory(p: Page, name: string) {
  const option = p.getByLabel("預算分類").locator("option").filter({ hasText: name }).first();
  await p.getByLabel("預算分類").selectOption(await option.getAttribute("value"));
}

export async function phase3Budgets(a: Page, b: Page) {
  // 1. 從「更多」進得去；還沒有預算時有 empty state
  await go(a, "/more");
  await a.getByRole("link", { name: /每月預算/ }).click();
  await a.waitForURL(/\/budgets$/);
  await loaded(a);
  await expect(a.getByRole("heading", { name: "預算", exact: true })).toBeVisible();
  expect(await pageText(a)).toContain("還沒有預算");
  await shot(a, "25-budgets-empty");
  step("更多頁 →「每月預算」，沒有預算時有說明");

  // 2. 新增一個餐飲預算
  await a.getByRole("button", { name: "＋ 新增預算" }).click();
  await selectCategory(a, "餐飲");
  await a.getByLabel("預算金額").fill("100000");
  await a.getByLabel("新預算備註").fill("外食少一點");
  await a.getByRole("button", { name: "新增", exact: true }).click();
  await expect(rowOf(a, "餐飲")).toBeVisible();
  await expect(a.getByTestId("budget-summary")).toBeVisible();
  const spent = money(await rowOf(a, "餐飲").getByTestId("budget-spent").innerText());
  expect(spent).toBeGreaterThan(0); // 這個帳本本來就有餐飲消費
  await shot(a, "26-budgets");
  step(`新增餐飲預算 $100,000，已支出自動帶入 ${spent}`);

  // 3. 已支出要與統計頁的分類金額一致
  await go(a, "/stats");
  const statsRow = a.getByTestId("category-row").filter({ hasText: "餐飲" }).first();
  // 這一列的文字是「餐飲 $2,420 12.8%」，只取第一個金額
  const statsAmount = money((await statsRow.innerText()).match(/\$[\d,.]+/)![0]);
  expect(statsAmount).toBe(spent);
  step("預算的「已支出」與統計頁的分類金額完全一致");

  // 4. 同一個月同一個分類不能再設一次（下拉選單裡已經沒有它）
  await go(a, "/budgets");
  await a.getByRole("button", { name: "＋ 新增預算" }).click();
  const options = await a.getByLabel("預算分類").locator("option").allInnerTexts();
  expect(options.some((o) => o.includes("餐飲"))).toBe(false);
  await a.getByRole("button", { name: "取消" }).click();
  step("已經設過預算的分類不會再出現在新增選單");

  // 5. 改金額 → 變成超支
  await rowOf(a, "餐飲").getByRole("button", { name: "編輯 餐飲 的預算" }).click();
  await a.getByLabel("餐飲 的預算金額").fill("1");
  await a.getByRole("button", { name: "儲存" }).click();
  await expect(rowOf(a, "餐飲").getByTestId("budget-state")).toHaveText("已超支");
  expect(await rowOf(a, "餐飲").getByTestId("budget-remaining").innerText()).toContain("超支");
  expect(await pageText(a)).toContain("1 個超支");
  await shot(a, "27-budgets-over");
  step("把預算改成 $1 之後顯示「已超支」與超支金額");

  // 6. 超支不會擋住記帳
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("60");
  await a.getByLabel("名稱（選填）").fill("超支後還是記得下去");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL(/\/$/);
  step("超支只是提醒，記帳照樣記得下去");

  // 7. 首頁摘要
  const home = await pageText(a, "/");
  expect(home).toContain("本月預算");
  expect(home).toContain("超支");
  await expect(a.getByTestId("budget-hint")).toBeVisible();
  step("首頁出現一行預算摘要");

  // 8. 月份切換：上個月沒有預算
  await go(a, "/budgets");
  const thisMonth = (await a.getByTestId("budget-month").innerText()).trim();
  await a.getByRole("link", { name: /^看 / }).first().click();
  await a.waitForURL(/\/budgets\?m=/);
  await loaded(a);
  const lastMonth = (await a.getByTestId("budget-month").innerText()).trim();
  expect(lastMonth).not.toBe(thisMonth);
  expect(await pageText(a)).toContain("還沒有預算");
  await go(a, "/budgets?m=abc");
  expect((await a.getByTestId("budget-month").innerText()).trim()).toBe(thisMonth);
  step(`月份切換：${thisMonth} → ${lastMonth}，亂填參數回本月`);

  // 9. 停用：不算進摘要，但紀錄還在
  await go(a, "/budgets");
  await rowOf(a, "餐飲").getByRole("button", { name: "停用 餐飲 的預算" }).click();
  await expect(rowOf(a, "餐飲")).toContainText("已停用");
  await expect(a.getByTestId("budget-summary")).toHaveCount(0);
  await rowOf(a, "餐飲").getByRole("button", { name: "啟用 餐飲 的預算" }).click();
  await expect(a.getByTestId("budget-summary")).toBeVisible();
  step("停用的預算不算進摘要，重新啟用後又回來");

  // 10. 另一半看得到，而且動態記得住
  await go(b, "/budgets");
  await expect(rowOf(b, "餐飲")).toBeVisible();
  await go(b, "/activity");
  expect(await pageText(b)).toMatch(/設了預算|改了預算|停用了預算|重新啟用了預算/);
  step("另一半看得到同一份預算，動態也記得住");

  // 11. 跨帳本看不到
  const browser = a.context().browser()!;
  const outsider = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const c2 = await outsider.newPage();
  await go(c2, "/register");
  await c2.getByLabel("暱稱").fill("路人辛");
  await c2.getByLabel("Email").fill(`outsider39-${Date.now().toString(36)}@example.com`);
  await c2.getByLabel("密碼").fill("password123");
  await c2.getByRole("button", { name: "建立帳號" }).click();
  await c2.waitForURL(/\/onboarding/);
  await c2.getByLabel("帳本名稱").fill("路人辛的帳本");
  await c2.getByRole("button", { name: "建立帳本" }).click();
  await c2.waitForURL(/\/more/);
  await go(c2, "/budgets");
  const theirs = await pageText(c2);
  expect(theirs).toContain("還沒有預算");
  expect(theirs).not.toContain("外食少一點");
  await outsider.close();
  step("別的帳本只看得到自己的空預算頁");

  // 12. 刪除
  await go(a, "/budgets");
  await rowOf(a, "餐飲").getByRole("button", { name: "刪除 餐飲 的預算" }).click();
  await expect(a.getByTestId("budget-row")).toHaveCount(0);
  expect(await pageText(a)).toContain("還沒有預算");
  // 刪掉預算不會影響任何記帳
  await go(a, "/transactions?q=超支後還是記得下去");
  expect(await pageText(a)).toContain("超支後還是記得下去");
  step("刪除預算之後記帳完全不受影響");

  // 13. 手機版面
  await go(a, "/budgets");
  await a.getByRole("button", { name: "＋ 新增預算" }).click();
  await selectCategory(a, "餐飲");
  await a.getByLabel("預算金額").fill("3000");
  await a.getByRole("button", { name: "新增", exact: true }).click();
  await expect(rowOf(a, "餐飲")).toBeVisible();
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 664 }]) {
    await a.setViewportSize(size);
    await go(a, "/budgets");
    const o = await a.evaluate(() => ({ w: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(o.w, `${size.width}px 不該水平溢出`).toBeLessThanOrEqual(o.inner + 1);
    await expect(rowOf(a, "餐飲").getByTestId("budget-state")).toBeVisible();
    if (size.width === 320) await shot(a, "28-budgets-320");
  }
  await a.setViewportSize({ width: 390, height: 664 });
  step("預算頁在 320px 與 390px 都不破版");
}
