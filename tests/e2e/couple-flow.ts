/**
 * 端到端流程（兩個手機瀏覽器）：註冊 → 建帳本 → 邀請綁定 → 記帳四種分帳 → 編輯刪除 → 部分／全部結算 → 帳戶。
 * 執行：先 `npm run build && npm start`，再 `BASE_URL=http://localhost:3000 npm run test:e2e`
 * 會建立隨機 Email 的測試帳號，請勿對正式資料庫執行。
 */
import { chromium, devices, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { go, loaded } from "./lib";
import { phase2 } from "./phase2";
import { phase3Search } from "./phase3";
import { phase3Transfer } from "./phase3-2";
import { phase3Recurring } from "./phase3-3";
import { phase3Stats } from "./phase3-4";
import { phase3Adjust } from "./phase3-4c";
import { phase3Receipts } from "./phase3-4e";
import { phase3Export } from "./phase3-4g";
import { phase3Activity } from "./phase3-4h";
import { phase3Categories } from "./phase3-4d";
import { phase3Budgets } from "./phase3-4b";
import { phase3Batch } from "./phase3-4f";
import { phase4Ui } from "./phase4-ui";
import { v4Daily } from "./v4-daily";
import { iconText } from "./icon-text";
import { uxAudit } from "./ux-audit";

/** 後續階段的流程依序接在 Phase 1 之後執行（兩人帳號延續使用）。 */
const PHASES: Array<[string, (a: Page, b: Page) => Promise<void>]> = [
  ["phase2", phase2],
  ["phase3-1 search", phase3Search],
  ["phase3-2 transfer+refund", phase3Transfer],
  ["phase3-3 recurring", phase3Recurring],
  ["phase3-4 stats", phase3Stats],
  ["phase3-4c adjustment", phase3Adjust],
  ["phase3-4e receipts", phase3Receipts],
  ["phase3-4g export", async (a, b) => phase3Export(a, b)],
  ["phase3-4h activity", phase3Activity],
  ["phase3-4d categories", phase3Categories],
  ["phase3-4b budgets", phase3Budgets],
  ["phase3-4f batch", phase3Batch],
  ["phase4 ui+avatar", phase4Ui],
  ["v4 daily", v4Daily],
  ["icon text", async (a) => iconText(a)],
  ["ux audit", async (a) => uxAudit(a)],
];

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function register(page: Page, name: string, email: string) {
  await page.getByLabel("暱稱").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("密碼").fill("password123");
  await page.getByRole("button", { name: "建立帳號" }).click();
}

async function addExpense(
  page: Page,
  opts: { amount: string; title: string; account?: string; method?: "平分" | "比例" | "金額" | "一人負擔"; setup?: () => Promise<void>; expectEffect?: string },
) {
  await go(page, "/transactions/new");
  await page.getByLabel("金額").fill(opts.amount);
  await page.getByRole("button", { name: /餐飲/ }).click();
  await page.getByLabel("名稱（選填）").fill(opts.title);
  if (opts.account) await page.getByLabel("帳戶").selectOption({ label: opts.account });
  if (opts.method) await page.getByRole("button", { name: opts.method, exact: true }).click();
  if (opts.setup) await opts.setup();
  if (opts.expectEffect) await expect(page.getByTestId("split-effect")).toHaveText(opts.expectEffect);
  await page.getByRole("button", { name: "記下來" }).click();
  await page.waitForURL(`${BASE}/`);
}

const debtText = async (page: Page) => {
  await go(page, "/");
  return (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
};

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  // 兩支手機故意用不同尺寸：小艾 iPhone 13（390×664）、阿本 iPhone SE（320×568）
  const phone = { ...devices["iPhone 13"], locale: "zh-TW", timezoneId: "Asia/Taipei" };
  const smallPhone = { ...devices["iPhone SE"], locale: "zh-TW", timezoneId: "Asia/Taipei" };
  const a = await (await browser.newContext(phone)).newPage();
  const b = await (await browser.newContext(smallPhone)).newPage();
  for (const p of [a, b]) p.on("dialog", (d) => d.accept());
  const step = (s: string) => console.log(`✓ ${s}`);

  // 1. 註冊與登入保護
  await go(a, "/");
  await a.waitForURL(/\/login/);
  await shot(a, "01-login");
  await a.getByRole("link", { name: "註冊" }).click();
  await register(a, "小艾", `amy-${run}@example.com`);
  await a.waitForURL(/\/onboarding/);
  await loaded(a);
  await shot(a, "02-onboarding");
  step("A 註冊並導向建立帳本");

  // 2. 建立帳本 → 邀請碼
  await a.getByLabel("帳本名稱").fill("艾與本的帳本");
  await a.getByRole("button", { name: "建立帳本" }).click();
  await a.waitForURL(/\/more/);
  await a.getByRole("button", { name: "產生邀請碼" }).click();
  const code = (await a.getByTestId("invite-code").innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  await shot(a, "03-invite");
  step(`A 建立帳本並產生邀請碼 ${code}`);

  // 3. B 用邀請連結註冊並加入
  await go(b, `/invite/${code}`);
  await expect(b.getByText("小艾 邀請你加入「艾與本的帳本」")).toBeVisible();
  await b.getByRole("link", { name: "註冊新帳號" }).click();
  await register(b, "阿本", `ben-${run}@example.com`);
  await b.waitForURL(new RegExp(`/invite/${code}`));
  await b.getByRole("button", { name: "加入帳本" }).click();
  await b.waitForURL(`${BASE}/`);
  await expect(b.getByText("目前互不相欠")).toBeVisible();
  await go(a, "/more");
  await expect(a.getByText("已綁定")).toBeVisible();
  step("B 透過邀請連結加入，A 看到已綁定");

  // 4. 四種分帳
  await addExpense(a, { amount: "1000", title: "火鍋", method: "平分", expectEffect: "阿本 要還你 $500" });
  expect(await debtText(a)).toContain("阿本 要還你 $500");
  await shot(a, "04-dashboard-after-first");

  await addExpense(b, {
    amount: "300", title: "電影", method: "比例",
    setup: async () => { await b.getByLabel("我的百分比").fill("30"); },
    expectEffect: "小艾 要還你 $210",
  });
  expect(await debtText(a)).toContain("阿本 要還你 $290");

  await addExpense(a, {
    amount: "99", title: "飲料", method: "金額",
    setup: async () => { await a.getByLabel("我負擔的金額").fill("33"); },
    expectEffect: "阿本 要還你 $66",
  });
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("200");
  await a.getByRole("button", { name: "一人負擔", exact: true }).click();
  await a.getByRole("button", { name: "全部由阿本負擔" }).click();
  await expect(a.getByTestId("split-effect")).toHaveText("阿本 要還你 $200");
  await shot(a, "05-new-expense-full");
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL(`${BASE}/`);

  await addExpense(a, { amount: "500", title: "日用品", account: "共同帳戶", expectEffect: "共同帳戶支付，不影響誰欠誰" });
  expect(await debtText(a)).toContain("阿本 要還你 $556");
  expect(await debtText(b)).toContain("你要還 小艾 $556");
  await shot(b, "06-dashboard-partner");
  step("平分／比例／自訂金額／一人負擔／共同帳戶 計算正確（$556）");

  // 5. 編輯與刪除
  await go(a, "/transactions");
  await shot(a, "07-transactions");
  await a.getByRole("link", { name: /火鍋/ }).click();
  await a.getByLabel("金額").fill("800");
  await shot(a, "08-edit");
  await a.getByRole("button", { name: "儲存修改" }).click();
  await a.waitForURL(`${BASE}/transactions`);
  expect(await debtText(b)).toContain("你要還 小艾 $456");
  await go(a, "/transactions");
  await a.getByRole("link", { name: /飲料/ }).click();
  await a.getByRole("button", { name: "刪除這筆紀錄" }).click();
  await a.waitForURL(`${BASE}/transactions`);
  await expect(a.getByText("飲料")).toHaveCount(0);
  expect(await debtText(b)).toContain("你要還 小艾 $390");
  step("編輯（1000→800）與刪除後欠款重算（$390）");

  // 6. 部分結算 → 超額檢查 → 一鍵結清
  await go(b, "/settle");
  await b.getByRole("button", { name: "部分結算" }).click();
  await b.getByLabel("結算金額").fill("9999");
  await b.getByRole("button", { name: /確認/ }).click();
  await expect(b.locator("p[role=alert]")).toContainText("不能超過目前欠款");
  await b.getByLabel("結算金額").fill("90");
  await b.getByRole("button", { name: /確認/ }).click();
  await expect(b.getByTestId("debt-amount")).toHaveText("$300");
  await shot(b, "09-settle-partial");
  await go(a, "/settle");
  await a.getByRole("button", { name: /確認：阿本 已付給 我/ }).click();
  await expect(a.getByText("目前互不相欠")).toBeVisible();
  await shot(a, "10-settled");
  expect(await debtText(b)).toContain("目前互不相欠");
  step("部分結算 $90、超額被擋、一鍵結清 $300");

  // 取消結算會恢復欠款
  await go(a, "/settle");
  await a.getByRole("button", { name: "取消" }).first().click();
  await expect(a.getByTestId("debt-amount")).toHaveText("$300");
  await a.getByRole("button", { name: /確認：阿本 已付給 我/ }).click();
  await expect(a.getByText("目前互不相欠")).toBeVisible();
  step("取消結算恢復欠款後再結清");

  // 7. 帳戶：信用卡、銀行
  await go(a, "/accounts");
  await a.getByRole("button", { name: "＋ 新增帳戶" }).click();
  await a.getByLabel("類型").selectOption("CREDIT_CARD");
  await a.getByLabel("名稱").fill("玉山卡");
  await a.getByLabel("目前未繳金額（選填）").fill("1500");
  await a.getByRole("button", { name: "新增", exact: true }).click();
  await expect(a.getByText("玉山卡")).toBeVisible();
  await addExpense(a, { amount: "120", title: "早午餐", account: "我的・玉山卡", method: "平分" });
  await go(a, "/accounts");
  const cardRow = a.getByTestId("account-row").filter({ hasText: "玉山卡" });
  await expect(cardRow).toContainText("$1,620");
  await shot(a, "11-accounts");
  step("新增信用卡（未繳 $1,500）並刷卡 $120 → 未繳 $1,620");

  // 8. 登出、錯誤密碼、再登入
  await go(a, "/more");
  await a.getByRole("button", { name: "登出" }).click();
  await a.waitForURL(/\/login/);
  await a.getByLabel("Email").fill(`amy-${run}@example.com`);
  await a.getByLabel("密碼").fill("wrong-password");
  await a.getByRole("button", { name: "登入" }).click();
  await expect(a.locator("p[role=alert]")).toHaveText("Email 或密碼錯誤");
  await a.getByLabel("密碼").fill("password123");
  await a.getByRole("button", { name: "登入" }).click();
  await a.waitForURL(`${BASE}/`);
  expect(await debtText(a)).toContain("阿本 要還你 $60");
  await shot(a, "12-dashboard-final");
  step("登出／錯誤密碼／重新登入，欠款 $60 正確");

  const only = process.env.E2E_PHASES?.split(",");
  for (const [name, fn] of PHASES) {
    if (only && !only.includes(name)) continue;
    console.log(`── ${name} ──`);
    await fn(a, b);
  }

  await browser.close();
  console.log("E2E 全部通過");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
