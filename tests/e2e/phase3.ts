/** Phase 3-1 端到端：記帳搜尋與篩選。前提：Phase 1、Phase 2 流程已跑完（兩人帳本已有各種紀錄）。 */
import { expect, type Page } from "@playwright/test";
import { go, shot, step } from "./lib";

const rows = (page: Page) => page.getByTestId("tx-row");

async function openFilter(page: Page) {
  await page.getByRole("button", { name: "開啟篩選" }).click();
  await expect(page.getByRole("dialog", { name: "篩選條件" })).toBeVisible();
}

async function apply(page: Page) {
  await page.getByRole("button", { name: "套用" }).click();
  await page.waitForURL(/\/transactions\?/);
}

export async function phase3Search(a: Page, b: Page) {
  // 記一筆有標籤的支出
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("180");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("咖啡");
  await a.getByLabel("標籤").fill("#約會 #早午餐");
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL(/\/$/);
  step("記帳可以加標籤（#約會 #早午餐）");

  // 關鍵字
  await go(a, "/transactions");
  await a.getByLabel("搜尋關鍵字").fill("火鍋");
  await a.getByLabel("搜尋關鍵字").press("Enter");
  await a.waitForURL(/q=/);
  await expect(rows(a)).toHaveCount(1);
  await expect(rows(a).first()).toContainText("火鍋");
  await expect(a.getByTestId("search-totals")).toContainText("1 筆");
  step("關鍵字「火鍋」找到 1 筆");

  // 類型：基金支出
  await go(a, "/transactions");
  await openFilter(a);
  await shot(a, "p3-01-filter-sheet");
  await a.getByLabel("篩選類型").selectOption({ label: "基金支出" });
  await apply(a);
  await expect(rows(a)).toHaveCount(1);
  await expect(rows(a).first()).toContainText("行李箱");
  await expect(a.getByTestId("search-net-expense")).toHaveText("$500");
  step("類型「基金支出」只找到行李箱，實際淨支出 $500");

  // 付款人 + 類型
  await openFilter(a);
  await a.getByLabel("篩選類型").selectOption({ label: "支出" });
  await a.getByLabel("篩選付款人").selectOption({ label: "阿本" });
  await apply(a);
  await expect(rows(a)).toHaveCount(1);
  await expect(rows(a).first()).toContainText("電影");
  step("付款人「阿本」＋支出：電影");

  // 金額區間（保留原本條件後移除付款人）
  await go(a, "/transactions?kind=EXPENSE&min=400&max=600");
  await expect(rows(a)).toHaveCount(2);
  await expect(a.getByTestId("filter-chips")).toContainText("≥ $400");
  await a.getByRole("link", { name: "移除條件 ≥ $400" }).click();
  await a.waitForURL((u) => !u.search.includes("min="));
  expect(await rows(a).count()).toBeGreaterThan(2);
  step("金額 $400～$600 的支出 2 筆；移除單一條件後結果變多");

  // 標籤
  await go(a, "/transactions");
  await openFilter(a);
  await a.getByLabel("篩選標籤").selectOption({ label: "#約會" });
  await apply(a);
  await expect(rows(a)).toHaveCount(1);
  await expect(rows(a).first()).toContainText("#約會 #早午餐");
  await shot(a, "p3-02-results");
  step("標籤 #約會 找到咖啡");

  // 從搜尋結果查看、編輯、刪除
  await rows(a).first().click();
  await a.waitForURL(/\/transactions\/c/);
  await a.getByText("查看詳細資料").click();
  await expect(a.getByTestId("tx-detail")).toContainText("建立：我");
  await a.getByLabel("名稱（選填）").fill("手沖咖啡");
  await a.getByRole("button", { name: "儲存修改" }).click();
  await a.waitForURL(/\/transactions$/);
  await go(a, "/transactions?q=%E6%89%8B%E6%B2%96");
  await expect(rows(a)).toHaveCount(1);
  await rows(a).first().click();
  await a.getByRole("button", { name: "刪除這筆紀錄" }).click();
  await a.waitForURL(/\/transactions$/);
  await go(a, "/transactions?q=%E6%89%8B%E6%B2%96");
  await expect(a.getByText("找不到符合條件的紀錄")).toBeVisible();
  step("從搜尋結果編輯（改名手沖咖啡）與刪除");

  // 不算收支的紀錄也搜得到，並有詳細頁
  await go(a, "/transactions?kind=OPENING_BALANCE");
  await expect(rows(a).first()).toContainText("不算收支");
  await expect(a.getByTestId("search-net-expense")).toHaveText("$0");
  await rows(a).first().click();
  await expect(a.getByTestId("tx-detail")).toContainText("不算收支");
  step("期初餘額可搜尋、詳細頁說明不算收支，淨支出 $0");

  // 清除篩選、另一半看得到同一本帳
  await go(a, "/transactions?kind=EXPENSE&tag=%E7%B4%84%E6%9C%83");
  await a.getByRole("link", { name: "清除全部" }).click();
  await a.waitForURL(/\/transactions$/);
  await expect(a.getByRole("link", { name: "結算", exact: true })).toBeVisible();
  await go(b, "/transactions?q=%E8%A1%8C%E6%9D%8E%E7%AE%B1");
  await expect(rows(b)).toHaveCount(1);
  step("清除全部條件；阿本也搜得到共同帳本的行李箱");
}
