/**
 * Phase 3-4 A：統計與報表 /stats（兩支手機）。
 * 前提：Phase 1～3-3 的流程已經跑完，帳本裡有支出、退款、轉帳、結算、基金、固定支出。
 */
import { devices, expect, type Page } from "@playwright/test";
import { go, pageText, shot, step } from "./lib";

const money = (s: string) => Number(s.replace(/[^\d.-]/g, ""));

export async function phase3Stats(a: Page, b: Page) {
  // 1. 從記帳頁的捷徑進入統計
  await go(a, "/transactions");
  await a.getByRole("link", { name: "📊 統計" }).click();
  await a.waitForURL(/\/stats/);
  await expect(a.getByTestId("stats-month")).toBeVisible();
  const netExpense = money(await a.getByTestId("stats-net-expense").innerText());
  const income = money(await a.getByTestId("stats-income").innerText());
  expect(netExpense).toBeGreaterThan(0);
  expect(income).toBeGreaterThan(0);
  await shot(a, "13-stats");
  step(`統計頁：本月淨支出 ${netExpense}、收入 ${income}`);

  // 2. 誰掏錢（三項加總 = 淨支出）與誰負擔（兩項加總 = 淨支出）
  const paid = ["paid-me", "paid-partner", "paid-joint"].map(async (id) => money(await a.getByTestId(id).innerText()));
  const [pMe, pPartner, pJoint] = await Promise.all(paid);
  expect(Math.round((pMe + pPartner + pJoint) * 100)).toBe(Math.round(netExpense * 100));
  const [bMe, bPartner] = await Promise.all(
    ["borne-me", "borne-partner"].map(async (id) => money(await a.getByTestId(id).innerText())),
  );
  expect(Math.round((bMe + bPartner) * 100)).toBe(Math.round(netExpense * 100));
  expect(pJoint).toBeGreaterThan(0); // 這個帳本有共同帳戶付款
  step(`誰掏錢 ${pMe}/${pPartner}/共同 ${pJoint}、誰負擔 ${bMe}/${bPartner}，兩側加總都等於淨支出`);

  // 3. 與記帳列表對帳：同一個月的篩選結果要看到相同的淨支出
  const monthLink = a.getByRole("link", { name: /淨支出/ }).first();
  await monthLink.click();
  await a.waitForURL(/\/transactions\?/);
  const listNet = money(await a.getByTestId("search-net-expense").innerText());
  expect(listNet).toBe(netExpense);
  step("點淨支出 → 記帳列表（已帶入本月區間），數字與統計一致");

  // 4. 分類佔比可以點進已篩選的列表
  await go(a, "/stats");
  const firstCategory = a.getByTestId("category-row").first();
  await expect(firstCategory).toBeVisible();
  await firstCategory.click();
  await a.waitForURL(/\/transactions\?/);
  await expect(a.getByTestId("filter-chips")).toBeVisible();
  expect(a.url()).toContain("from=");
  step("分類列可以點進「該分類 + 該月份」的記帳列表");

  // 5. 切換到上個月
  await go(a, "/stats");
  const thisMonth = (await a.getByTestId("stats-month").innerText()).trim();
  await a.getByRole("link", { name: /^看 / }).first().click();
  await a.waitForURL(/\/stats\?m=/);
  const lastMonth = (await a.getByTestId("stats-month").innerText()).trim();
  expect(lastMonth).not.toBe(thisMonth);
  const lastText = await pageText(a);
  expect(lastText).toContain("還沒有任何紀錄"); // 測試資料都記在今天
  step(`月份切換：${thisMonth} → ${lastMonth}`);

  // 6. 網址亂填會回到本月，不會壞掉
  await go(a, "/stats?m=abc");
  expect((await a.getByTestId("stats-month").innerText()).trim()).toBe(thisMonth);
  await go(a, "/stats?m=2099-01");
  expect((await a.getByTestId("stats-month").innerText()).trim()).toBe(thisMonth);
  step("無效或未來的月份參數會回到本月");

  // 7. 另一半看到同一份數字（負擔左右相反）
  await go(b, "/stats");
  expect(money(await b.getByTestId("stats-net-expense").innerText())).toBe(netExpense);
  expect(money(await b.getByTestId("borne-me").innerText())).toBe(bPartner);
  expect(money(await b.getByTestId("paid-joint").innerText())).toBe(pJoint);
  await shot(b, "14-stats-partner");
  step("阿本看到同一份統計，負擔的「我」換成他自己");

  // 8. 目前欠款與目前基金有標示是「目前」
  const text = await pageText(a, "/stats");
  expect(text).toContain("目前欠款");
  expect(text).toContain("最近 6 個月");
  await expect(a.getByTestId("stats-trend")).toBeVisible();
  step("趨勢、目前欠款、目前基金都在，且標示為「目前」");

  // 9. 跨帳本隔離
  const browser = a.context().browser()!;
  const outsider = await browser.newContext({ ...devices["iPhone 13"], locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const c = await outsider.newPage();
  await go(c, "/register");
  await c.getByLabel("暱稱").fill("路人丙");
  await c.getByLabel("Email").fill(`outsider34-${Date.now().toString(36)}@example.com`);
  await c.getByLabel("密碼").fill("password123");
  await c.getByRole("button", { name: "建立帳號" }).click();
  await c.waitForURL(/\/onboarding/);
  await c.getByLabel("帳本名稱").fill("路人丙的帳本");
  await c.getByRole("button", { name: "建立帳本" }).click();
  await c.waitForURL(/\/more/);
  const statsUrl = `${new URL(a.url()).origin}/stats`;
  await c.goto(statsUrl);
  const leaked = (await c.locator("body").innerText()).replace(/\s+/g, " ");
  for (const secret of ["火鍋", "玉山卡", "小艾銀行", "日本旅遊"]) expect(leaked).not.toContain(secret);
  // 連原始 HTML／RSC payload 都不能出現對方的資料
  const raw = await (await c.request.get(statsUrl)).text();
  for (const secret of ["火鍋", "玉山卡", "小艾銀行", "日本旅遊"]) expect(raw).not.toContain(secret);
  await outsider.close();
  step("另一個帳本的統計是自己的空帳本，看不到也抓不到對方任何資料");
}
