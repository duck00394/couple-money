/**
 * V7：預購可以直接在記帳頁選，並看到已付／待付／每個人還需付。
 *
 * 前提：Phase 1～V6 已跑完，兩人帳號延續使用。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, openAdvanced, pageText, shot, step } from "./lib";

/** 某個人在「每個人還需付」裡的那一行。 */
const shareRow = (p: Page, name: string) =>
  p.locator('[data-testid="preorder-shares"] [data-share]').filter({ hasText: name });

export async function v7PreorderForm(a: Page, b: Page) {
  // 建一張共同預購 $10,000（沒有運費，數字好對）
  await go(a, "/preorders/new");
  await a.getByLabel("品名").fill("V7共同預購");
  await a.getByLabel("商品金額").fill("10000");
  await a.getByLabel("誰的").selectOption({ label: "共同" });
  await a.getByRole("button", { name: "建立預購" }).click();
  await a.waitForURL(/\/preorders\/(?!new$)[^/]+$/);
  await loaded(a);
  const poId = a.url().split("/").pop()!;

  // 詳細頁一開始：兩個人各要付一半
  const detailShares = a.getByTestId("preorder-shares");
  await expect(detailShares).toBeVisible();
  await expect(detailShares).toContainText("每個人還需付");
  await expect(detailShares).toContainText("$5,000");
  await shot(a, "v7-01-preorder-detail-shares");
  step("預購詳細頁：共同預購 $10,000 → 兩個人各還需付 $5,000");

  // ── 記帳頁可以直接選預購 ──
  await go(a, "/transactions/new");
  await openAdvanced(a);
  const select = a.getByTestId("preorder-select");
  await expect(select).toBeVisible();
  await expect(select).toContainText("V7共同預購");
  await select.selectOption(poId);
  const panel = a.getByTestId("preorder-hint-form");
  await expect(panel).toBeVisible();
  await expect(a.getByTestId("preorder-paid-now")).toHaveText("$0");
  await expect(a.getByTestId("preorder-remaining-after")).toHaveText("$10,000");
  step("記帳頁的下拉選單就能選預購，選完立刻看到應付總額與目前已付");

  // 打上金額 → 已付／待付／每人還需付即時試算
  await a.getByLabel("金額").fill("4000");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("V7訂金");
  await a.getByRole("button", { name: "一人負擔", exact: true }).click();
  await expect(a.getByTestId("preorder-paid-after")).toHaveText("$4,000");
  await expect(a.getByTestId("preorder-remaining-after")).toHaveText("$6,000");
  const formShares = a.getByTestId("preorder-shares");
  await expect(formShares).toContainText("每個人還需付");
  await expect(formShares).toContainText("$1,000"); // 我：應負擔 5,000 − 已負擔 4,000
  await expect(formShares).toContainText("$5,000"); // 阿本：還沒付
  await shot(a, "v7-02-new-tx-preorder");
  step("輸入金額後即時試算：記下這筆之後已付 $4,000、待付 $6,000，我還需付 $1,000、阿本還需付 $5,000");

  // 送出後真的掛上去
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL("**/");
  await go(a, `/preorders/${poId}`);
  await expect(a.getByTestId("preorder-paid")).toHaveText("$4,000");
  await expect(a.getByTestId("preorder-remaining")).toHaveText("$6,000");
  await expect(a.getByTestId("preorder-payment")).toHaveCount(1);
  const detail = await pageText(a);
  expect(detail).toContain("V7訂金");
  step("從記帳頁記的那一筆真的掛在預購上，付款紀錄看得到");

  // 這筆就是普通的記帳，明細頁也找得到，而且分類／標籤都能用
  const txs = await pageText(a, "/transactions");
  expect(txs).toContain("V7訂金");
  step("它就是一筆普通的消費，記帳明細裡看得到（沒有第二套金流）");

  // ── 兩人平分的那一筆：兩個人一起往下降 ──
  await go(a, "/transactions/new");
  await openAdvanced(a);
  await a.getByTestId("preorder-select").selectOption(poId);
  await a.getByLabel("金額").fill("2000");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("V7尾款一部分");
  await a.getByRole("button", { name: "平分", exact: true }).click();
  await expect(a.getByTestId("preorder-paid-after")).toHaveText("$6,000");
  await expect(a.getByTestId("preorder-remaining-after")).toHaveText("$4,000");
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL("**/");

  await go(a, `/preorders/${poId}`);
  await expect(a.getByTestId("preorder-paid")).toHaveText("$6,000");
  await expect(a.getByTestId("preorder-remaining")).toHaveText("$4,000");
  // 我：應負擔 5,000、已負擔 4,000 + 1,000 → 還需付 $0；阿本：已負擔 1,000 → 還需付 $4,000
  await expect(shareRow(a, "我")).toContainText("$0");
  await expect(shareRow(a, "我")).toContainText("已負擔 $5,000");
  await expect(shareRow(a, "阿本")).toContainText("$4,000");
  await expect(shareRow(a, "阿本")).toContainText("已負擔 $1,000");
  step("兩人平分的那一筆記下去之後：已付 $6,000、待付 $4,000，兩個人的「還需付」一起下降");

  // 另一半看到的是同一份
  const bText = (await pageText(b, `/preorders/${poId}`)).replace(/\s+/g, " ");
  expect(bText).toContain("每個人還需付");
  expect(bText).toContain("$6,000");
  step("另一半看到的是同一份已付／待付／每人還需付");

  // ── 編輯既有那一筆，可以改掛或解除 ──
  await go(a, "/transactions");
  await a.getByRole("link", { name: /V7尾款一部分/ }).first().click();
  await a.waitForURL(/\/transactions\/(?!new$|refund$|transfer$)[^/]+$/);
  await loaded(a);
  await expect(a.getByTestId("preorder-select")).toHaveValue(poId);
  await a.getByTestId("preorder-select").selectOption("");
  await expect(a.getByTestId("preorder-hint-form")).toHaveCount(0);
  await a.getByRole("button", { name: "儲存修改" }).click();
  await a.waitForURL(/\/transactions$/);
  await go(a, `/preorders/${poId}`);
  await expect(a.getByTestId("preorder-paid")).toHaveText("$4,000");
  await expect(a.getByTestId("preorder-remaining")).toHaveText("$6,000");
  step("編輯記帳時可以解除預購關聯，已付與待付立刻重算（紀錄本身沒有被刪掉）");

  // 從預購頁按「用完整的記帳頁」會帶著那張單過去
  await go(a, `/preorders/${poId}`);
  await a.getByRole("link", { name: /用完整的記帳頁/ }).click();
  await a.waitForURL(/\/transactions\/new\?preorder=/);
  await loaded(a);
  await expect(a.getByTestId("preorder-select")).toHaveValue(poId);
  step("預購頁的「用完整的記帳頁」會直接把那張單帶進記帳表單");

  // 小螢幕不破版
  for (const [page, name] of [[a, "iPhone 13"], [b, "iPhone SE"]] as const) {
    for (const path of ["/transactions/new", `/preorders/${poId}`]) {
      await go(page, path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${name} ${path} 水平溢出 ${over}px`).toBeLessThanOrEqual(1);
    }
  }
  step("記帳頁與預購詳細頁在 390px 與 320px 都沒有水平溢出");
}
