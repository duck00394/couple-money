/**
 * Phase 3-4 C：餘額調整（兩支手機）。
 * 前提：Phase 1～3-4 A 的流程已經跑完，帳本裡有帳戶、消費、基金、統計資料。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

const money = (s: string) => Number(s.replace(/[^\d.-]/g, ""));

/** 帳戶頁某個帳戶那一列。 */
const rowOf = (p: Page, name: string) => p.getByTestId("account-row").filter({ hasText: name }).first();

/** 那一列顯示的餘額（最後一行；負數會顯示成 -$8,500，所以用數字比對）。 */
async function balanceOf(p: Page, name: string) {
  const text = await rowOf(p, name).innerText();
  return money(text.split("\n").at(-1) ?? "0");
}

export async function phase3Adjust(a: Page, b: Page) {
  // 1. 先記下調整前的狀態（首頁本月支出、欠款、統計淨支出）
  await go(a, "/stats");
  const beforeStats = {
    net: money(await a.getByTestId("stats-net-expense").innerText()),
    income: money(await a.getByTestId("stats-income").innerText()),
    borneMe: money(await a.getByTestId("borne-me").innerText()),
  };
  const beforeHome = await pageText(a, "/");
  const beforeExpense = money(await a.getByTestId("month-expense").innerText());

  // 2. 帳戶頁：把「小艾銀行」調成一個新的數字
  await go(a, "/accounts");
  const before = await balanceOf(a, "小艾銀行");
  await rowOf(a, "小艾銀行").getByRole("button", { name: /調整 小艾銀行 的餘額/ }).click();
  await expect(a.getByTestId("adjust-form")).toBeVisible();
  const target = before - 250;
  await a.getByLabel("實際餘額").fill(String(target));
  await a.getByLabel("調整原因").fill("對帳發現少記了早餐");
  await shot(a, "15-adjust-form");
  await a.getByRole("button", { name: "建立調整" }).click();
  await expect.poll(() => balanceOf(a, "小艾銀行")).toBe(target);
  await shot(a, "16-adjust-done");
  step(`餘額調整：小艾銀行 ${before} → ${target}（差額自動記成一筆調整）`);

  // 3. 紀錄看得到、而且標示「不算收支」
  await go(a, "/transactions?kind=ADJUSTMENT");
  const list = await pageText(a);
  expect(list).toContain("餘額調整");
  expect(list).toContain("不算收支");
  await a.getByTestId("tx-row").first().click();
  await a.waitForURL(/\/transactions\/[\w-]+$/);
  const detail = await pageText(a);
  expect(detail).toContain("餘額調整");
  expect(detail).toContain("對帳發現少記了早餐");
  expect(detail).toContain("不算收支");
  const adjustUrl = a.url();
  step("調整紀錄在記帳列表與詳細頁都看得到，並標示不算收支");

  // 4. 首頁與統計完全不受影響（不算收支、不產生欠款）
  await go(a, "/");
  expect(money(await a.getByTestId("month-expense").innerText())).toBe(beforeExpense);
  const afterHome = await pageText(a, "/");
  expect(afterHome.includes("目前互不相欠")).toBe(beforeHome.includes("目前互不相欠"));
  await go(a, "/stats");
  expect(money(await a.getByTestId("stats-net-expense").innerText())).toBe(beforeStats.net);
  expect(money(await a.getByTestId("stats-income").innerText())).toBe(beforeStats.income);
  expect(money(await a.getByTestId("borne-me").innerText())).toBe(beforeStats.borneMe);
  step("餘額調整不影響首頁本月支出、欠款、統計的淨支出與負擔");

  // 5. 另一半看得到同一筆調整與新的餘額
  await go(b, "/accounts");
  expect(await balanceOf(b, "小艾銀行")).toBe(target);
  await go(b, adjustUrl);
  expect(await pageText(b)).toContain("餘額調整");
  step("阿本看得到小艾建立的調整與調整後的餘額");

  // 6. 阿本不能調小艾的個人帳戶（畫面上不會有按鈕）
  await go(b, "/accounts");
  const bankRowForB = rowOf(b, "小艾銀行");
  await expect(bankRowForB.getByRole("button", { name: /調整 小艾銀行 的餘額/ })).toHaveCount(0);
  // 共同帳戶則兩個人都能調
  await expect(rowOf(b, "共同帳戶").getByRole("button", { name: /調整 .* 的餘額/ })).toBeVisible();
  step("個人帳戶只有自己能調；共同帳戶兩個人都能調");

  // 7. 填一樣的數字會被擋下來
  await go(a, "/accounts");
  await rowOf(a, "小艾銀行").getByRole("button", { name: /調整 小艾銀行 的餘額/ }).click();
  await a.getByRole("button", { name: "建立調整" }).click();
  await expect(a.locator("p[role=alert]")).toContainText("不需要調整");
  step("填的數字跟目前一樣會被擋下並說明原因");

  // 8. 作廢調整 → 餘額回到原本
  await go(a, adjustUrl);
  await a.getByRole("button", { name: "作廢這筆調整" }).click();
  await a.waitForURL(/\/accounts$/);
  await loaded(a);
  await expect.poll(() => balanceOf(a, "小艾銀行")).toBe(before);
  step("作廢調整後餘額回到調整前");
}
