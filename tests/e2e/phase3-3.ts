/** Phase 3-3 端到端：固定支出。前提：Phase 1～3-2 流程已跑完。 */
import { devices, expect, type Page } from "@playwright/test";
import { go, shot, step } from "./lib";

const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const todayDay = Number(todayKey.slice(8)); // 讓固定支出「今天就到期」，才測得到待處理與產生

async function accountBalance(page: Page, name: string) {
  await go(page, "/accounts");
  const row = page.getByTestId("account-row").filter({ hasText: name }).first();
  // 一列可能有「已指定給基金／可自由使用」，右邊最後一個金額才是餘額
  const all = [...(await row.innerText()).replace(/\s+/g, " ").matchAll(/(-?)\$([\d,]+)/g)];
  const last = all[all.length - 1];
  return Number(`${last[1]}${last[2].replace(/,/g, "")}`);
}

/** 目前欠款金額（互不相欠時為 0）。 */
async function debtAmount(page: Page) {
  await go(page, "/settle");
  const el = page.getByTestId("debt-amount");
  if ((await el.count()) === 0) return 0;
  return Number((await el.first().innerText()).replace(/[^\d]/g, ""));
}

export async function phase3Recurring(a: Page, b: Page) {
  const bankBefore = await accountBalance(a, "小艾銀行");
  const debtBefore = await debtAmount(a);

  // 1. 建立固定支出（房租 $15,500，每月今天，平分，小艾銀行付款）
  await go(a, "/transactions");
  await a.getByRole("link", { name: /固定支出/ }).click();
  await a.waitForURL(/\/recurring$/);
  await a.getByRole("link", { name: "＋ 新增" }).click();
  await a.waitForURL(/\/recurring\/new/);
  await a.getByLabel("名稱").fill("房租");
  await a.getByLabel("金額").fill("15500");
  await a.getByLabel("付款帳戶").selectOption({ label: "🏦 我的・小艾銀行" });
  await a.getByRole("button", { name: "每月", exact: true }).click();
  await a.getByLabel("幾號").selectOption(String(todayDay));
  await expect(a.getByTestId("recurring-preview")).toContainText(`下一次應付日：${todayKey}`);
  await expect(a.getByTestId("recurring-split")).toContainText("$7,750");
  await shot(a, "p33-01-new");
  await a.getByRole("button", { name: "建立固定支出" }).click();
  await a.waitForURL(/\/recurring$/);
  step("建立固定支出：房租 $15,500、每月、平分");

  // 2. 建立設定不會立刻扣錢，也不會有交易
  expect(await accountBalance(a, "小艾銀行")).toBe(bankBefore);
  await go(a, "/transactions?q=房租");
  await expect(a.getByTestId("tx-row")).toHaveCount(0);
  step("建立設定沒有扣帳、沒有產生任何交易");

  // 3. 待處理
  await go(a, "/recurring");
  await expect(a.getByTestId("recurring-due-count")).toHaveText("1");
  await expect(a.getByTestId("recurring-due-label").first()).toContainText("今天");
  await expect(a.getByTestId("recurring-due-label").first()).toContainText(todayKey);
  await shot(a, "p33-02-pending");
  step("固定支出出現在「待處理」");

  // 4 + 5 + 6 + 7. 產生記帳 → 餘額、列表、欠款
  await a.getByTestId("generate-recurring").first().click();
  await expect(a.getByTestId("recurring-due-count")).toHaveCount(0);
  expect(await accountBalance(a, "小艾銀行")).toBe(bankBefore - 15500);
  await go(a, "/transactions?q=房租");
  await expect(a.getByTestId("tx-row")).toHaveCount(1);
  await expect(a.getByTestId("tx-row").first()).toContainText("固定支出");
  await expect(a.getByTestId("tx-row").first()).toContainText("$15,500");
  await a.getByTestId("tx-row").first().click();
  await a.waitForURL(/\/transactions\/[\w-]+$/);
  const txUrl = a.url();
  await a.locator("summary", { hasText: "查看詳細資料" }).click();
  await expect(a.getByTestId("tx-recurring")).toContainText("固定支出：房租");
  expect(await debtAmount(a)).toBe(debtBefore + 7750);
  step("產生記帳：帳戶 −$15,500、列表看得到來源、欠款 +$7,750");

  // 產生後不會再出現待處理（不會重複產生）
  await go(a, "/recurring");
  await expect(a.getByTestId("generate-recurring")).toHaveCount(0);
  await a.getByTestId("recurring-row").first().click();
  await a.waitForURL(/\/recurring\/[\w-]+$/);
  const recurringUrl = a.url();
  await expect(a.getByTestId("recurring-history").locator("li")).toHaveCount(1);
  step("產生後從待處理消失，同一個應付日不會再產生第二筆");

  // 8 + 9. 修改設定不會動到已經產生的交易
  await a.locator("summary", { hasText: "修改設定" }).click();
  await a.getByLabel("金額").fill("16000");
  await a.getByRole("button", { name: "儲存修改" }).click();
  await a.waitForURL(recurringUrl);
  await expect(a.getByTestId("recurring-detail")).toContainText("$16,000");
  await go(a, txUrl);
  await expect(a.getByTestId("refund-summary")).toContainText("原始金額 $15,500");
  await go(a, "/transactions?q=房租");
  await expect(a.getByTestId("tx-row").first()).toContainText("$15,500");
  step("把金額改成 $16,000：已產生的交易仍然是 $15,500");

  // 10 + 11. 停用後不再產生
  await go(a, recurringUrl);
  await a.getByRole("button", { name: "停用" }).click();
  await expect(a.getByTestId("recurring-detail")).toContainText("已停用");
  await go(a, "/recurring");
  await expect(a.getByTestId("generate-recurring")).toHaveCount(0);
  await expect(a.getByText("已停用，不會產生新的待處理")).toBeVisible();
  step("停用：不再出現待處理、不能產生");

  // 12 + 13. 重新啟用不補歷史
  await go(a, recurringUrl);
  await a.getByRole("button", { name: "重新啟用" }).click();
  await expect(a.getByTestId("recurring-detail")).toContainText("啟用中");
  await expect(a.getByTestId("recurring-history").locator("li")).toHaveCount(1, { timeout: 5000 });
  const detail = (await a.getByTestId("recurring-detail").innerText()).replace(/\s+/g, " ");
  expect(detail).not.toContain(`下一次應付日：${todayKey}`);
  await go(a, "/transactions?q=房租");
  await expect(a.getByTestId("tx-row")).toHaveCount(1);
  step("重新啟用：不補停用期間的付款，交易還是只有 1 筆");

  // 14. 第二支手機
  await go(b, "/recurring");
  await expect(b.getByTestId("recurring-row").filter({ hasText: "房租" })).toHaveCount(1);
  await go(b, "/transactions?q=房租");
  await expect(b.getByTestId("tx-row")).toHaveCount(1);
  await b.getByTestId("tx-row").first().click();
  await b.locator("summary", { hasText: "查看詳細資料" }).click();
  await expect(b.getByTestId("tx-recurring")).toContainText("固定支出：房租");
  await go(b, recurringUrl);
  await expect(b.getByTestId("recurring-detail")).toContainText("$16,000");
  await shot(b, "p33-03-partner");
  step("阿本（另一半）看得到固定支出、也看得到它產生的交易");

  // 15. 跨帳本隔離
  const browser = a.context().browser()!;
  const outsider = await browser.newContext({ ...devices["iPhone 13"], locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const c = await outsider.newPage();
  await go(c, "/register");
  await c.getByLabel("暱稱").fill("路人乙");
  await c.getByLabel("Email").fill(`outsider33-${Date.now().toString(36)}@example.com`);
  await c.getByLabel("密碼").fill("password123");
  await c.getByRole("button", { name: "建立帳號" }).click();
  await c.waitForURL(/\/onboarding/);
  await c.getByLabel("帳本名稱").fill("路人乙的帳本");
  await c.getByRole("button", { name: "建立帳本" }).click();
  await c.waitForURL(/\/more/);
  await go(c, "/recurring");
  await expect(c.getByTestId("recurring-row")).toHaveCount(0);
  // 直接開別的帳本的網址：看到「找不到」畫面，資料不會外洩
  await c.goto(recurringUrl);
  await expect(c.getByText("找不到這筆資料")).toBeVisible();
  const leaked = (await c.locator("body").innerText()).replace(/\s+/g, " ");
  expect(leaked).not.toContain("房租");
  expect(leaked).not.toContain("16,000");
  await expect(c.getByTestId("recurring-detail")).toHaveCount(0);
  // 連原始 HTML／RSC payload 都不能出現對方的資料
  const raw = await (await c.request.get(recurringUrl)).text();
  for (const secret of ["房租", "16,000", "小艾銀行"]) expect(raw).not.toContain(secret);
  await outsider.close();
  step("另一個帳本：看不到固定支出，直接開網址只看到「找不到這筆資料」");
}
