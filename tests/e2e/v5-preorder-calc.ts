/**
 * V5：預購 + 計算機鍵盤 + 最近常用 + 可以花的錢。
 *
 * 1. 預購：建立 → 首頁提醒 → 訂金 → 尾款 → 結清；待結款不扣帳戶
 * 2. 取消預購不會產生任何金流
 * 3. 計算機鍵盤真的會算，沒按「＝」不能送出
 * 4. 最近常用一鍵帶入分類／帳戶
 * 5. 首頁「可以花的錢」會扣掉預購待結
 * 6. 日期顯示成 2026/09/25
 *
 * 前提：Phase 1～V4 已跑完，兩人帳號延續使用。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

const money = (t: string) => Number(t.replace(/[^\d.-]/g, ""));
/** 讀首頁「可以花的錢」。 */
async function freeMoney(p: Page) {
  await go(p, "/");
  return money(await p.getByTestId("available-free").innerText());
}

export async function v5PreorderCalc(a: Page, b: Page) {
  // ───────────────────────── 計算機鍵盤 ─────────────────────────
  await go(a, "/transactions/new");
  const keypad = a.getByTestId("amount-keypad");
  await expect(keypad).toBeVisible();
  await shot(a, "v5-01-new-tx-keypad");

  const tap = async (...keys: string[]) => {
    for (const k of keys) await keypad.getByRole("button", { name: k, exact: true }).click();
  };
  const amountBox = a.getByLabel("金額");

  // 299 + 129 + 89 = 517
  await tap("2", "9", "9", "加", "1", "2", "9");
  await expect(a.getByTestId("calc-expr")).toHaveText("299 +");
  await tap("加");
  await expect(amountBox).toHaveValue("428");
  await tap("8", "9", "等於");
  await expect(amountBox).toHaveValue("517");
  step("計算機：299 + 129 + 89 真的算出 517，算式列看得到「299 +」");

  // 沒按「＝」不能送出
  await tap("清除", "1", "0", "0", "乘", "3");
  await expect(a.getByRole("button", { name: "先按 ＝ 算出金額" })).toBeDisabled();
  await tap("等於");
  await expect(amountBox).toHaveValue("300");
  await expect(a.getByRole("button", { name: "記下來" })).toBeEnabled();
  step("算式沒算完時送出鈕會擋住，按「＝」之後才放行");

  // 百分比與除以 0
  await tap("清除", "1", "2", "0", "0", "乘", "8", "0", "百分比", "等於");
  await expect(amountBox).toHaveValue("960");
  await tap("清除", "1", "0", "0", "除", "0", "等於");
  await expect(a.getByText("不能除以 0")).toBeVisible();
  await tap("清除");
  await expect(amountBox).toHaveValue("");
  step("百分比 1200 × 80% = 960；除以 0 給提示不會壞掉");

  // ───────────────────────── 最近常用 ─────────────────────────
  // 同一組「名稱＋分類＋帳戶」記兩次才會變成常用
  for (const n of [1, 2]) {
    await go(a, "/transactions/new");
    await a.getByLabel("金額").fill(String(60 + n));
    await a.getByRole("button", { name: /餐飲/ }).click();
    await a.getByLabel("名稱（選填）").fill("超商咖啡");
    await a.getByRole("button", { name: "記下來" }).click();
    await a.waitForURL("**/");
  }
  await go(a, "/transactions/new");
  const presets = a.getByTestId("recent-presets");
  await expect(presets).toBeVisible();
  await expect(presets.getByRole("button", { name: /超商咖啡/ })).toBeVisible();
  await presets.getByRole("button", { name: /超商咖啡/ }).click();
  await expect(a.getByLabel("名稱（選填）")).toHaveValue("超商咖啡");
  await expect(a.getByRole("button", { name: /餐飲/ })).toHaveClass(/ring-brand-500/);
  // 金額刻意不帶入：每次花的錢都不一樣，帶錯比沒帶更危險
  expect(await a.getByLabel("金額").inputValue()).toBe("");
  await shot(a, "v5-02-recent-presets");
  step("最近常用：記兩次之後出現 chip，一按帶入名稱與分類，金額仍然要自己填");

  // ───────────────────────── 預購 ─────────────────────────
  const freeBefore = await freeMoney(a);

  await go(a, "/preorders");
  await expect(a.getByTestId("preorder-remaining")).toHaveText("$0");
  await a.getByTestId("new-preorder").click();
  await a.waitForURL(/\/preorders\/new$/);
  await loaded(a);
  await a.getByLabel("品名").fill("Switch 2 主機");
  await a.getByLabel("賣家（選填）").fill("蝦皮");
  await a.getByLabel("商品金額").fill("13000");
  await a.getByLabel("運費（選填）").fill("150");
  await a.getByLabel("預計到貨（選填）").fill("2026-12-25");
  await expect(a.getByText("2026/12/25")).toBeVisible();
  await expect(a.getByText(/應付總額/)).toContainText("$13,150");
  await a.getByRole("button", { name: "建立預購" }).click();
  await a.waitForURL(/\/preorders\/(?!new$)[^/]+$/);
  await loaded(a);
  await expect(a.getByTestId("preorder-remaining")).toHaveText("$13,150");
  await expect(a.getByTestId("preorder-paid")).toHaveText("$0");
  await go(a, "/preorders");
  await expect(a.getByTestId("preorder-remaining")).toHaveText("$13,150");
  await shot(a, "v5-03-preorders");
  step("建立預購：商品 $13,000 + 運費 $150 → 待結 $13,150，日期顯示 2026/12/25");

  // 待結款不是支出：帳戶一毛都沒動，但「可以花的錢」要扣掉
  const freeAfterCreate = await freeMoney(a);
  expect(freeAfterCreate).toBe(freeBefore - 13150);
  const home = await pageText(a, "/");
  expect(home).toContain("預購待結");
  await expect(a.getByTestId("preorder-hint")).toContainText("1 筆預購待結款");
  await expect(a.getByTestId("preorder-hint")).toContainText("$13,150");
  await shot(a, "v5-04-home-preorder-hint");
  step("待結款不扣帳戶，但首頁「可以花的錢」扣掉 $13,150，提醒直接在首頁看得到");

  // 訂金 $3,000
  await go(a, "/preorders");
  await a.getByTestId("preorder-row").filter({ hasText: "Switch 2" }).click();
  await a.waitForURL(/\/preorders\/(?!new$)[^/]+$/);
  await loaded(a);
  await a.getByLabel("付款金額").fill("3000");
  await a.getByRole("button", { name: "記錄這次付款" }).click();
  await expect(a.getByTestId("preorder-paid")).toHaveText("$3,000", { timeout: 10000 });
  await expect(a.getByTestId("preorder-remaining")).toHaveText("$10,150");
  await shot(a, "v5-05-preorder-detail");
  step("訂金 $3,000：已付 $3,000、待結 $10,150（次數不固定，想付幾次就付幾次）");

  // 這筆付款是一筆真的消費，在記帳明細裡看得到
  const txs = await pageText(a, "/transactions");
  expect(txs).toContain("預購付款");
  const freeAfterDeposit = await freeMoney(a);
  expect(freeAfterDeposit).toBe(freeBefore - 13150);
  step("付款走的是既有的記帳：明細找得到，且付款不會讓「可以花的錢」再少一次（不重複計算）");

  // 尾款：帶入待結全額
  await go(a, "/preorders");
  await a.getByTestId("preorder-row").filter({ hasText: "Switch 2" }).click();
  await loaded(a);
  await a.getByRole("button", { name: /帶入待結全額/ }).click();
  await expect(a.getByLabel("付款金額")).toHaveValue("10150");
  await a.getByRole("button", { name: "記錄這次付款" }).click();
  await expect(a.getByTestId("preorder-remaining")).toHaveText("$0", { timeout: 10000 });
  await expect(a.getByTestId("preorder-paid")).toHaveText("$13,150");
  await expect(a.getByTestId("preorder-payment")).toHaveCount(2);
  step("尾款：一鍵帶入待結全額 $10,150 → 結清，兩筆付款紀錄都在");

  // 結清之後首頁提醒消失，可以花的錢回到「只被真的花掉的錢影響」
  const afterSettle = await pageText(a, "/");
  expect(afterSettle).not.toContain("筆預購待結款");
  expect(await freeMoney(a)).toBe(freeBefore - 13150);
  step("結清後首頁提醒消失；整段流程總共只少了 $13,150，沒有算成兩次");

  // ───────────────────────── 取消不產生金流 ─────────────────────────
  await go(a, "/preorders/new");
  await a.getByLabel("品名").fill("預售周邊");
  await a.getByLabel("商品金額").fill("2000");
  await a.getByRole("button", { name: "建立預購" }).click();
  await a.waitForURL(/\/preorders\/(?!new$)[^/]+$/);
  await loaded(a);
  const freeWithPending = await freeMoney(a);
  expect(freeWithPending).toBe(freeBefore - 13150 - 2000);

  await go(a, "/preorders");
  await a.getByTestId("preorder-row").filter({ hasText: "預售周邊" }).click();
  await loaded(a);
  await a.getByRole("button", { name: "取消這張預購" }).click();
  await expect(a.getByText(/這張預購已經取消/)).toBeVisible({ timeout: 10000 });
  await expect(a.getByTestId("preorder-remaining")).toHaveText("$0");
  expect(await freeMoney(a)).toBe(freeBefore - 13150);
  step("取消預購：不產生任何金流，待結歸零，「可以花的錢」自己回來");

  // ───────────────────────── 另一半看得到同一份 ─────────────────────────
  const bList = await pageText(b, "/preorders");
  expect(bList).toContain("Switch 2 主機");
  expect(bList).toContain("已取消");
  step("另一半看到的是同一份預購，狀態一致");

  // ───────────────────────── 小螢幕不破版 ─────────────────────────
  for (const [page, name] of [[a, "iPhone 13"], [b, "iPhone SE"]] as const) {
    for (const path of ["/", "/preorders", "/transactions/new"]) {
      await go(page, path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${name} ${path} 水平溢出 ${over}px`).toBeLessThanOrEqual(1);
    }
  }
  step("首頁／預購／記帳在 390px 與 320px 都沒有水平溢出");
}
