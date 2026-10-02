/**
 * V14：多幣別＋自訂匯率。
 *
 * 走一遍真正的使用情境：出國前設匯率 → 用日圓記帳 → 看換算 → 改匯率 → 確認舊帳沒變。
 *
 * 最重要的一步是第 5 步：**改完匯率回去看那筆舊的日圓消費，金額必須一模一樣。**
 * 這是整個功能的財務底線，UI 上也要看得到。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

export async function v14Currency(a: Page, b: Page) {
  // ───────── 1. 入口：更多 → 幣別與匯率 ─────────
  expect(await pageText(a, "/more")).toContain("幣別與匯率");
  await go(a, "/more");
  await a.getByRole("link", { name: /幣別與匯率/ }).first().click();
  await a.waitForURL(/\/rates$/);
  await loaded(a);
  const settings = await pageText(a);
  expect(settings).toContain("本位幣");
  expect(settings).toContain("改匯率不會動到已經記過的帳");
  expect(await a.locator("nav a").count(), "底部導覽維持五個").toBe(5);
  step("更多 →「幣別與匯率」；頁面有講清楚改匯率不影響歷史");

  // ───────── 2. 設定日圓匯率：1 JPY = 0.215 TWD ─────────
  const jpyRow = a.getByTestId("rate-row").filter({ hasText: "JPY" });
  // 方向固定是「1 外幣 = ? 本位幣」，沒有左邊的數量欄位可以填錯
  expect(await jpyRow.getByLabel("JPY 數量").count(), "不該再有左邊的數量欄位").toBe(0);
  await expect(jpyRow.getByText("1 JPY =")).toBeVisible();
  await jpyRow.getByLabel(/JPY 兌 .* 匯率/).fill("0.215");
  // 預覽拿 100 個外幣當例子，方向跟輸入一致（外幣 → 台幣），不會反過來寫
  await expect(jpyRow.getByTestId("rate-preview")).toContainText("¥100 ≈ NT$21.50");
  await jpyRow.getByRole("button", { name: /設定匯率|更新匯率/ }).click();
  await a.waitForTimeout(1200);
  await go(a, "/rates");
  expect(await pageText(a)).toContain("已設定");
  // 重新整理之後輸入框要回填成當初輸入的那個數字（不是放大之後的存法）
  await expect(a.getByTestId("rate-row").filter({ hasText: "JPY" }).getByLabel(/JPY 兌 .* 匯率/)).toHaveValue("0.215");
  await shot(a, "v14-01-rates");
  step("設定 1 JPY = 0.215 TWD（方向固定、小數直接打），列表標成「已設定」");

  // ───────── 3. 用日圓記帳：¥2,500 → 約 NT$537.50 ─────────
  await go(a, "/transactions/new");
  await a.getByTestId("tx-currency").selectOption("JPY");
  await a.getByLabel("金額").fill("2500");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("日本晚餐");
  // 畫面上要直接看到換算，使用者不用自己乘除
  await expect(a.getByTestId("tx-converted")).toContainText("537.50");
  await shot(a, "v14-02-form");
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);
  step("記一筆 ¥2,500，表單即時顯示「≈ NT$537.50」");

  // ───────── 4. 列表與明細都看得到原幣 ─────────
  const list = await pageText(a, "/transactions");
  expect(list, "列表沒有顯示原幣").toContain("¥2,500");
  await a.getByText("日本晚餐").first().click();
  await a.waitForURL(/\/transactions\/[^/]+$/);
  await loaded(a);
  const txUrl = a.url();
  await expect(a.getByTestId("tx-foreign")).toHaveText("¥2,500");
  await expect(a.getByTestId("tx-rate")).toHaveText("1 JPY = 0.215 TWD");
  const detail = await pageText(a);
  expect(detail, "明細沒有顯示換算後的台幣").toContain("537.50");
  await shot(a, "v14-03-detail");
  step("明細頁：原幣是主角、台幣換算與匯率都寫出來了（規格點 13）");

  // ───────── 5. 最重要的一步：改匯率，舊帳不能變 ─────────
  await go(a, "/rates");
  const jpy2 = a.getByTestId("rate-row").filter({ hasText: "JPY" });
  await jpy2.getByLabel(/JPY 兌 .* 匯率/).fill("0.22");
  await jpy2.getByRole("button", { name: /更新匯率/ }).click();
  await a.waitForTimeout(1200);

  await go(a, txUrl);
  await loaded(a);
  await expect(a.getByTestId("tx-foreign"), "原幣金額變了").toHaveText("¥2,500");
  await expect(a.getByTestId("tx-rate"), "歷史交易的匯率被改掉了").toHaveText("1 JPY = 0.215 TWD");
  expect(await pageText(a), "歷史交易的台幣金額被改匯率影響了").toContain("537.50");
  await shot(a, "v14-04-locked");
  step("★ 改成 1 JPY = 0.22 TWD 之後，那筆舊的日圓消費仍然是 ¥2,500 / NT$537.50");

  // ───────── 6. 新交易才用新匯率 ─────────
  await go(a, "/transactions/new");
  await a.getByTestId("tx-currency").selectOption("JPY");
  await a.getByLabel("金額").fill("2500");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("改匯率後的日本午餐");
  await expect(a.getByTestId("tx-converted")).toContainText("550");
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);
  step("同樣 ¥2,500 的新交易換成 NT$550（新匯率只影響新交易）");

  // ───────── 7. 統計：台幣總額，外幣分開列 ─────────
  const stats = await pageText(a, "/stats");
  expect(stats).toContain("其中的外幣消費");
  expect(stats, "統計沒有列出日圓小計").toContain("¥5,000"); // 2500 + 2500
  await shot(a, "v14-05-stats");
  step("統計頁：總額用台幣，另外列出「其中的外幣消費 ¥5,000」（規格點 12）");

  // ───────── 8. 台幣記帳完全沒有多餘資訊 ─────────
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("500");
  // 預設就是本位幣，不該出現「≈」那一行（規格點 8）
  expect(await a.getByTestId("tx-converted").count(), "台幣記帳不該顯示換算").toBe(0);
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("台幣消費");
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);
  expect(await pageText(a, "/transactions")).toContain("台幣消費");
  step("台幣記帳維持原樣：沒有多出任何換算資訊");

  // ───────── 9. 編輯外幣交易時，金額欄位回到原幣 ─────────
  await go(a, txUrl);
  await loaded(a);
  await expect(a.getByLabel("金額"), "編輯時金額應該顯示原幣 2500").toHaveValue("2500");
  await expect(a.getByTestId("tx-currency")).toHaveValue("JPY");
  step("編輯外幣交易：金額欄位回到當初輸入的 ¥2,500，不是換算後的台幣");

  // ───────── 10. 另一半看得到同一份匯率與原幣 ─────────
  const bList = await pageText(b, "/transactions");
  expect(bList, "另一半看不到原幣").toContain("¥2,500");
  expect(await pageText(b, "/rates")).toContain("已設定");
  step("另一半看到同一份匯率設定與同樣的原幣金額");

  // ───────── 10b. 外幣帳本記帳時看得到「約 NT$」 ─────────
  // 日圓帳本記日圓：幣別等於本位幣，所以沒有「換算」，但還是要知道大概多少台幣
  await go(a, "/books/new");
  await a.getByLabel("帳本名稱").fill("日圓帳本");
  await a.getByLabel("旅行地區／幣別").selectOption("JPY");
  expect(await a.getByLabel("JPY 數量").count(), "建立帳本也不該有數量欄位").toBe(0);
  await a.getByLabel("台幣金額").fill("0.215");
  await a.getByRole("button", { name: /建立並切換過去/ }).click();
  await a.waitForURL(/\/$/);
  await loaded(a);
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("5000");
  await expect(a.getByTestId("tx-home-approx"), "日圓帳本記帳沒有顯示約多少台幣").toContainText("NT$1,075");
  step("日圓帳本記 ¥5,000：金額下面顯示「約 NT$1,075」");
  // 切回原帳本，不影響後面的階段
  await go(a, "/");
  await a.getByTestId("book-switcher").click();
  await a.getByTestId("book-menu").getByText("艾與本的帳本", { exact: true }).first().click();
  await expect(a.getByTestId("book-switcher")).toContainText("艾與本的帳本", { timeout: 15000 });
  await loaded(a);

  // ───────── 11. 沒設匯率的幣別不會出現在選單裡 ─────────
  await go(a, "/transactions/new");
  const options = await a.getByTestId("tx-currency").locator("option").allTextContents();
  expect(options, "選單出現了沒設匯率的幣別").not.toContain("EUR");
  expect(options).toContain("JPY");
  step("幣別選單只列出有設匯率的（沒匯率就記不了帳，列出來只會讓人撞牆）");
}
