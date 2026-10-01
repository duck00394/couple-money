/**
 * V12：購買紀錄。四層逐層點進去：作品 → 商品分類 → 共同/A/B → 角色。
 *
 *   1. 更多 → 購買紀錄（底部導覽維持五個）
 *   2. 一鍵建立預設分類（吉伊卡哇、排球少年＋六種商品分類）
 *   3. 記帳時勾選加入（作品 → 商品分類 → 歸屬 → 角色）
 *   4. 逐層點進去，每層都看得到件數與金額
 *   5. 歷史購買獨立新增（不產生記帳）
 *   6. 從既有交易加入
 *   7. 關鍵字只給建議，使用者按「加入」才建立
 *   8. 編輯分類、移除購買紀錄，原交易仍在、財務數字不變
 *
 * 前提：Phase 1～V11 已跑完，兩人帳號延續使用。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

export async function v12PurchaseLog(a: Page, b: Page) {
  // ───────── 入口 ─────────
  expect(await pageText(a, "/more")).toContain("購買紀錄");
  await go(a, "/more");
  await a.getByRole("link", { name: /購買紀錄/ }).first().click();
  await a.waitForURL(/\/purchases$/);
  await loaded(a);
  expect(await a.locator("nav a").count(), "底部導覽維持五個").toBe(5);
  step("更多 → 購買紀錄；底部導覽沒有變成六顆");

  // ───────── 一鍵建立預設分類 ─────────
  await a.getByTestId("seed-starter").click();
  await a.waitForTimeout(1800);
  await go(a, "/purchases");
  const home = await pageText(a);
  expect(home).toContain("吉伊卡哇");
  expect(home).toContain("排球少年");
  await shot(a, "v12-01-works");
  step("一鍵建立：吉伊卡哇、排球少年與各自的角色，外加六種商品分類");

  // ───────── 記帳時勾選加入（B / 小八 / 吊娃）─────────
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("350");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("小八吊娃");
  await expect(a.getByTestId("purchase-picker")).toHaveCount(0);
  await a.getByTestId("want-purchase").click();
  const picker = a.getByTestId("purchase-picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "吉伊卡哇", exact: true }).click();
  await picker.getByRole("button", { name: "吊娃", exact: true }).click();
  await picker.getByRole("button", { name: /阿本/ }).click();
  await picker.getByRole("button", { name: "小八", exact: true }).click();
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);
  step("記帳頁勾選加入：作品 → 商品分類 → 歸屬 → 角色，四個都在同一頁選完");

  // ───────── 歷史購買：共同 / 全角色 / 一番賞 ─────────
  await go(a, "/purchases");
  await a.getByTestId("purchase-group-card").filter({ hasText: "吉伊卡哇" }).click();
  await a.waitForURL(/\/purchases\/(?!new$|manage$|trial$)[^/?]+/);
  await loaded(a);
  const groupUrl = a.url().split("?")[0];

  await a.getByRole("link", { name: /在這個作品新增/ }).click();
  await a.waitForURL(/\/purchases\/new\?group=/);
  await a.getByRole("link", { name: "記一筆歷史購買" }).click();
  await loaded(a);
  await a.getByLabel("品項名稱").fill("吉伊卡哇一番賞");
  await a.getByLabel("金額").fill("250");
  await a.getByTestId("category-chips").getByRole("button", { name: "一番賞", exact: true }).click();
  await a.getByTestId("owner-chips").getByRole("button", { name: "共同", exact: true }).click();
  await a.getByTestId("add-manual-submit").click();
  await a.waitForTimeout(1800);
  step("歷史購買獨立新增：共同 / 全角色 / 一番賞，不產生記帳");

  // ───────── 從既有交易加入：A / 吉伊 / 吊娃 ─────────
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("300");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("吉伊娃娃");
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);
  await go(a, "/transactions");
  await a.getByText("吉伊娃娃").first().click();
  await a.waitForURL(/\/transactions\/[^/]+$/);
  await loaded(a);
  const txUrl = a.url();
  await a.getByTestId("add-purchase-link").click();
  await a.waitForURL(/\/purchases\/new/);
  await loaded(a);
  await a.getByTestId("category-chips").getByRole("button", { name: "吊娃", exact: true }).click();
  await a.getByTestId("owner-chips").getByRole("button", { name: /小艾/ }).click();
  await a.getByTestId("tag-chips-purchase").getByRole("button", { name: "吉伊", exact: true }).click();
  await a.getByTestId("add-purchase-submit").click();
  await a.waitForTimeout(1800);
  step("從既有交易加入：金額與日期沿用，只選作品、商品分類、歸屬、角色");

  // ───────── 逐層點進去 ─────────
  await go(a, groupUrl);
  await expect(a.getByTestId("purchase-count")).toHaveText("3 件");
  await expect(a.getByTestId("purchase-total")).toHaveText("$900");
  await shot(a, "v12-02-categories");
  step("作品內第一層：商品分類，總計 3 件 $900");

  // 第二層 → 吊娃
  await a.getByTestId("purchase-level-row").filter({ hasText: "吊娃" }).first().click();
  await loaded(a);
  await expect(a.getByTestId("purchase-count")).toHaveText("2 件");
  await expect(a.getByTestId("purchase-crumb")).toContainText("吊娃");
  step("點進「吊娃」：2 件，麵包屑跟著收斂");

  // 第三層 → 共同 / A / B
  const owners = (await a.getByTestId("purchase-level-row").allInnerTexts()).join(" ").replace(/\s+/g, " ");
  expect(owners).toContain("共同");
  expect(owners).toContain("小艾");
  expect(owners).toContain("阿本");
  await a.getByTestId("purchase-level-row").filter({ hasText: "阿本" }).click();
  await loaded(a);
  await expect(a.getByTestId("purchase-count")).toHaveText("1 件");
  await expect(a.getByTestId("purchase-total")).toHaveText("$350");
  await shot(a, "v12-03-owner");
  step("點進「阿本」：吊娃底下阿本的只有 1 件 $350");

  // 第四層 → 角色
  await expect(a.getByTestId("tag-filter")).toBeVisible();
  await a.getByTestId("tag-filter").getByRole("link", { name: /小八/ }).click();
  await loaded(a);
  await expect(a.getByTestId("purchase-count")).toHaveText("1 件");
  expect(await pageText(a)).toContain("小八吊娃");
  step("第四層角色篩選：阿本的吊娃裡，小八有 1 件");

  // ───────── 關鍵字只給建議 ─────────
  await go(a, `/purchases/manage/${groupUrl.split("/").pop()}`);
  await a.getByLabel("新關鍵字").first().fill("吉伊卡哇");
  await a.getByRole("button", { name: "＋", exact: true }).first().click();
  await a.waitForTimeout(1500);

  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("480");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("吉伊卡哇展覽門票");
  await a.getByTestId("save-and-done").click();
  // 關鍵字命中時會帶 ?suggest= 回首頁問一次，所以這裡不能只等 "/"
  await a.waitForURL(/\/(\?suggest=.+)?$/);
  // 關鍵字命中 → 只是「問」，沒有直接建立
  await expect(a.getByTestId("purchase-suggest")).toBeVisible();
  await shot(a, "v12-04-suggest");
  const before = await pageText(a, groupUrl);
  expect(before, "按「加入」之前不會有這筆").not.toContain("展覽門票");
  step("關鍵字命中只會跳出詢問，沒有自己建立任何購買紀錄");

  await a.goBack();
  await loaded(a);
  await expect(a.getByTestId("purchase-suggest")).toBeVisible();
  await a.getByTestId("suggest-no").click();
  await expect(a.getByTestId("purchase-suggest")).toHaveCount(0);
  step("按「不要」就只是把提示關掉，一行資料都沒寫");

  // ───────── 編輯分類 ─────────
  await go(a, groupUrl);
  await a.getByTestId("purchase-level-row").filter({ hasText: "一番賞" }).first().click();
  await loaded(a);
  await a.getByTestId("purchase-level-row").filter({ hasText: "共同" }).click();
  await loaded(a);
  await a.getByTestId("purchase-entry-row").first().click();
  await a.waitForURL(/\/purchases\/entry\//);
  await loaded(a);
  await a.getByTestId("category-chips").getByRole("button", { name: "景品", exact: true }).click();
  await a.getByRole("button", { name: "儲存" }).click();
  await a.waitForTimeout(1500);
  expect(await pageText(a, groupUrl)).toContain("景品");
  step("編輯購買紀錄：商品分類改成景品");

  // ───────── 移除購買紀錄，原交易仍在 ─────────
  const settleBefore = (await pageText(a, "/settle")).replace(/\s+/g, " ");
  // 從那筆交易的「已在購買紀錄裡」直接進去，確定刪到的就是這一筆
  await go(a, txUrl);
  await loaded(a);
  await a.getByTestId("purchase-link").click();
  await a.waitForURL(/\/purchases\/entry\//);
  await loaded(a);
  await expect(a.getByTestId("from-tx-note"), "這筆來自記帳，金額與日期是唯讀的").toBeVisible();
  await a.getByTestId("remove-entry-open").click();
  await expect(a.getByTestId("remove-entry-confirm")).toContainText("記帳會留著");
  await a.getByTestId("remove-entry-confirm-btn").click();
  await a.waitForTimeout(1800);

  await go(a, txUrl);
  await loaded(a);
  // 名稱在 <input> 裡，pageText 讀不到，所以直接看欄位值
  await expect(a.getByLabel("名稱（選填）"), "原本那筆記帳還在").toHaveValue("吉伊娃娃");
  const tx = (await pageText(a)).replace(/\s+/g, " ");
  expect(tx, "金額一分都沒變").toContain("$300");
  expect(tx, "購買紀錄解除了，所以又出現「加入購買紀錄」").toContain("加入購買紀錄");
  const settleAfter = (await pageText(a, "/settle")).replace(/\s+/g, " ");
  expect(settleAfter, "移除購買紀錄不影響欠款").toBe(settleBefore);
  step("移除購買紀錄：原交易完好、欠款一個字都沒變");

  // 另一半看得到同一份
  expect(await pageText(b, groupUrl)).toContain("吉伊卡哇");
  step("購買紀錄兩人共用：另一半看得到同一份");

  // 小螢幕不破版
  for (const [page, name] of [[a, "iPhone 13"], [b, "iPhone SE"]] as const) {
    for (const path of ["/purchases", groupUrl, "/purchases/manage", "/purchases/trial"]) {
      await go(page, path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${name} ${path} 水平溢出 ${over}px`).toBeLessThanOrEqual(1);
    }
  }
  step("購買紀錄的四個頁面在 390px 與 320px 都沒有水平溢出");
}
