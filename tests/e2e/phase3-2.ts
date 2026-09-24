/** Phase 3-2 端到端：帳戶間轉帳 + 退款。前提：Phase 1～3-1 流程已跑完。 */
import { devices, expect, type Page } from "@playwright/test";
import { BASE, go, shot, step } from "./lib";

const money = (text: string, label: string) => {
  const m = new RegExp(`${label}\\s*\\$([\\d,]+)`).exec(text);
  if (!m) throw new Error(`找不到「${label}」：${text}`);
  return Number(m[1].replace(/,/g, ""));
};

async function accountBalance(page: Page, name: string) {
  await go(page, "/accounts");
  const row = page.getByTestId("account-row").filter({ hasText: name }).first();
  const text = (await row.innerText()).replace(/\s+/g, " ");
  // 一列可能有「已指定給基金／可自由使用」，右邊最後一個金額才是餘額（信用卡則是未繳）
  const all = [...text.matchAll(/\$([\d,]+)/g)];
  return Number(all[all.length - 1][1].replace(/,/g, ""));
}

export async function phase3Transfer(a: Page, b: Page) {
  // 準備：小艾新增一個銀行帳戶（期初 $10,000）
  await go(a, "/accounts");
  await a.getByRole("button", { name: "＋ 新增帳戶" }).click();
  await a.getByLabel("類型").selectOption("BANK");
  await a.getByLabel("名稱").fill("小艾銀行");
  await a.getByLabel("目前餘額（選填）").fill("10000");
  await a.getByRole("button", { name: "新增", exact: true }).click();
  await expect(a.getByText("小艾銀行")).toBeVisible();
  const jointBefore = await accountBalance(a, "共同帳戶");

  // 1. 建立轉帳：小艾銀行 → 共同帳戶 $3,000
  await go(a, "/transactions");
  await a.getByRole("link", { name: "轉帳" }).click();
  await a.waitForURL(/\/transactions\/transfer/);
  await a.getByLabel("轉出帳戶").selectOption({ label: "我的・小艾銀行" });
  await a.getByLabel("轉入帳戶").selectOption({ label: "共同帳戶" });
  await a.getByLabel("金額").fill("3000");
  await a.getByLabel("時間").fill("09:30");
  await a.getByLabel("備註").fill("補共同帳戶");
  await shot(a, "p32-01-transfer");
  await a.getByRole("button", { name: "建立轉帳" }).click();
  await a.waitForURL(/kind=TRANSFER/);
  step("建立轉帳：小艾銀行 → 共同帳戶 $3,000");

  // 2. 查看轉帳詳細
  await a.getByTestId("tx-row").filter({ hasText: "小艾銀行" }).first().click();
  await a.waitForURL(/\/transactions\/[\w-]+$/);
  const detail = (await a.getByTestId("tx-detail").innerText()).replace(/\s+/g, " ");
  expect(detail).toContain("轉帳");
  expect(detail).toContain("不算收入也不算支出");
  expect(detail).toContain("09:30");
  expect(detail).toContain("小艾銀行");
  expect(detail).toContain("共同帳戶");
  step("轉帳詳細頁：金流兩筆、標示不算收支、有記錄時間");

  // 3. 帳戶餘額確實改變
  expect(await accountBalance(a, "小艾銀行")).toBe(7000);
  expect(await accountBalance(a, "共同帳戶")).toBe(jointBefore + 3000);
  step("轉帳後餘額：小艾銀行 $7,000、共同帳戶 +$3,000");

  // 4. 基金已指定的錢不能被轉走
  await go(a, "/transactions/transfer");
  await a.getByLabel("轉出帳戶").selectOption({ label: "共同帳戶" });
  const hint = (await a.locator("label", { hasText: "從哪個帳戶轉出" }).innerText()).replace(/\s+/g, " ");
  const free = money(hint, "可自由使用");
  const earmarked = money(hint, "已指定給基金");
  expect(earmarked).toBeGreaterThan(0);
  await a.getByLabel("轉入帳戶").selectOption({ label: "我的・小艾銀行" });
  await a.getByLabel("金額").fill(String(free + 1));
  await a.getByRole("button", { name: "建立轉帳" }).click();
  await expect(a.locator("p[role=alert]")).toContainText("已經指定給基金");
  expect(await accountBalance(a, "共同帳戶")).toBe(jointBefore + 3000);
  step(`基金指定 $${earmarked} 的錢不能轉走（可自由使用 $${free}，轉 $${free + 1} 被擋）`);

  // 5. 建立原始消費：王品 $1,000（小艾刷玉山卡，小艾 $400／阿本 $600）
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("1000");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("王品");
  await a.getByLabel("帳戶").selectOption({ label: "我的・玉山卡" });
  await a.getByRole("button", { name: "金額", exact: true }).click();
  await a.getByLabel("我負擔的金額").fill("400");
  await expect(a.getByTestId("split-effect")).toHaveText("阿本 要還你 $600");
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL(`${BASE}/`);
  const cardAfterExpense = await accountBalance(a, "玉山卡");
  step("原始消費：王品 $1,000（我 $400／阿本 $600）");

  // 6. 部分退款 $300
  await go(a, "/transactions?q=王品");
  await a.getByTestId("tx-row").first().click();
  await a.waitForURL(/\/transactions\/[\w-]+$/);
  const mealUrl = a.url();
  await expect(a.getByTestId("refund-summary")).toContainText("可退款 $1,000");
  await a.getByRole("link", { name: "退款" }).click();
  await a.waitForURL(/\/transactions\/refund\?from=/);
  await expect(a.getByTestId("refund-source").first()).toContainText("王品");
  await expect(a.getByTestId("refund-source").first()).toContainText("已退款 $0");
  await expect(a.getByTestId("refund-source").first()).toContainText("可退款 $1,000");
  await a.getByLabel("退款金額").fill("300");
  await a.getByLabel("退款時間").fill("14:05");
  await a.getByLabel("退款原因").fill("少送一份");
  await shot(a, "p32-02-refund");
  await a.getByRole("button", { name: "建立退款" }).click();
  await a.waitForURL(mealUrl);
  const summary = (await a.getByTestId("refund-summary").innerText()).replace(/\s+/g, " ");
  expect(summary).toContain("原始金額 $1,000");
  expect(summary).toContain("已退款 $300");
  expect(summary).toContain("可退款 $700");
  expect(summary).toContain("實際淨支出 $700");
  expect(await accountBalance(a, "玉山卡")).toBe(cardAfterExpense - 300);
  step("部分退款 $300：原始消費不變、可退款 $700、卡片未繳金額減少 $300");

  // 7. 查看退款詳細（分帳依比例回沖、可以回到原始消費）
  await go(a, "/transactions?kind=REFUND");
  await a.getByTestId("tx-row").filter({ hasText: "王品" }).first().click();
  const refundDetail = (await a.getByTestId("tx-detail").innerText()).replace(/\s+/g, " ");
  expect(refundDetail).toContain("退款");
  expect(refundDetail).toContain("不會修改原始消費");
  expect(refundDetail).toContain("退款減少的負擔");
  expect(refundDetail).toContain("$120"); // 我 400/1000 × 300
  expect(refundDetail).toContain("$180"); // 阿本 600/1000 × 300
  expect(refundDetail).toContain("原始消費");
  expect(refundDetail).toContain("14:05");
  step("退款詳細：我少負擔 $120、阿本少負擔 $180，可回到原始消費");

  // 欠款：阿本原本欠 $600 → 少負擔 $180 → 欠 $420（相對於記王品之前 +$420）
  await go(b, "/settle");
  const debt = (await b.locator("main").first().innerText()).replace(/\s+/g, " ");
  expect(debt).toMatch(/你要還|要還你/);
  step("退款後欠款自動重算");

  // 8. 再次退款：超額被擋、$200 成功
  await go(a, `/transactions/refund?from=${mealUrl.split("/").pop()}`);
  await a.getByLabel("退款金額").fill("701");
  await expect(a.getByText("退款金額不能超過可退款的 $700")).toBeVisible();
  await expect(a.getByRole("button", { name: "建立退款" })).toBeDisabled();
  await a.getByLabel("退款金額").fill("200");
  await a.getByLabel("退款時間").fill("16:00"); // 比第一筆晚，列表排序才固定
  await a.getByRole("button", { name: "建立退款" }).click();
  await a.waitForURL(mealUrl);
  await expect(a.getByTestId("refund-summary")).toContainText("已退款 $500");
  await expect(a.getByTestId("refund-summary")).toContainText("可退款 $500");
  step("第二次退款 $200（超過 $700 會被擋）→ 已退款 $500");

  // 9 + 10. 搜尋結果與統計
  await go(a, "/transactions?q=王品");
  await expect(a.getByTestId("tx-row")).toHaveCount(3); // 1 筆消費 + 2 筆退款
  const totals = (await a.getByTestId("search-totals").innerText()).replace(/\s+/g, " ");
  expect(totals).toContain("3 筆");
  expect(await a.getByTestId("search-net-expense").innerText()).toBe("$500");
  expect(totals).toContain("支出 $1,000 − 退款 $500");
  await go(a, "/transactions?kind=TRANSFER");
  const tTotals = (await a.getByTestId("search-totals").innerText()).replace(/\s+/g, " ");
  expect(tTotals).toContain("不算收支");
  expect(await a.getByTestId("search-net-expense").innerText()).toBe("$0");
  await shot(a, "p32-03-search");
  step("搜尋統計：實際淨支出 $500（支出 $1,000 − 退款 $500）、轉帳不算收支");

  // 11. 另一半看得到
  await go(b, "/transactions?q=王品");
  await expect(b.getByTestId("tx-row")).toHaveCount(3);
  await b.getByTestId("tx-row").filter({ hasText: "退款：王品" }).first().click();
  await expect(b.getByTestId("tx-detail")).toContainText("退款");
  await go(b, "/transactions?kind=TRANSFER");
  await expect(b.getByTestId("tx-row").filter({ hasText: "小艾銀行" }).first()).toBeVisible();
  step("阿本（另一半）看得到同一筆轉帳與退款");

  // 12. 另一個帳本完全看不到
  const browser = a.context().browser()!;
  const outsider = await browser.newContext({ ...devices["iPhone 13"], locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const c = await outsider.newPage();
  await go(c, "/register");
  await c.getByLabel("暱稱").fill("路人");
  await c.getByLabel("Email").fill(`outsider-${Date.now().toString(36)}@example.com`);
  await c.getByLabel("密碼").fill("password123");
  await c.getByRole("button", { name: "建立帳號" }).click();
  await c.waitForURL(/\/onboarding/);
  await c.getByLabel("帳本名稱").fill("路人的帳本");
  await c.getByRole("button", { name: "建立帳本" }).click();
  await c.waitForURL(/\/more/);
  await go(c, "/transactions?q=王品");
  await expect(c.getByTestId("tx-row")).toHaveCount(0);
  // 直接開別的帳本的網址：看到「找不到」畫面，而且畫面上不會出現任何對方的資料
  await c.goto(mealUrl);
  await expect(c.getByText("找不到這筆資料")).toBeVisible();
  const leaked = (await c.locator("body").innerText()).replace(/\s+/g, " ");
  expect(leaked).not.toContain("王品");
  expect(leaked).not.toContain("$1,000");
  await expect(c.getByTestId("tx-detail")).toHaveCount(0);
  // 連原始 HTML／RSC payload 都不能出現對方的資料
  const raw = await (await c.request.get(mealUrl)).text();
  for (const secret of ["王品", "少送一份", "玉山卡", "小艾銀行"]) expect(raw).not.toContain(secret);
  await go(c, "/transactions/refund");
  await expect(c.getByText("目前沒有可以退款的消費")).toBeVisible();
  await outsider.close();
  step("另一個帳本：搜不到、開網址只看到「找不到這筆資料」、也沒有可退款的消費");

  // 作廢退款後可退款金額恢復
  await go(a, "/transactions?kind=REFUND");
  await a.getByTestId("tx-row").filter({ hasText: "王品" }).first().click();
  await a.getByRole("button", { name: "作廢這筆退款" }).click();
  await a.waitForURL(/\/transactions$/);
  await a.goto(mealUrl);
  await expect(a.getByTestId("refund-summary")).toContainText("已退款 $300");
  await expect(a.getByTestId("refund-summary")).toContainText("可退款 $700");
  step("作廢退款：已退款回到 $300、可退款回到 $700");
}
