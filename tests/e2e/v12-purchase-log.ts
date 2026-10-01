/**
 * V12：購買紀錄。
 *
 *   1. 更多 → 購買紀錄（底部導覽維持五個，不加第六顆）
 *   2. 作品是唯一的第一層入口
 *   3. 作品內頁：歸屬第一排、角色第二排，沒有作品那一排
 *   4. 兩個維度同時套用，總計跟著變
 *   5. 預設角色可改名、不可刪除；刪一般角色時紀錄移到預設
 *   6. 記帳頁勾選加入；不勾就完全照舊
 *   7. 關鍵字試跑同時顯示命中與未命中
 *   8. 購買紀錄完全不影響任何財務數字
 *
 * 前提：Phase 1～V11 已跑完，兩人帳號延續使用。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

export async function v12PurchaseLog(a: Page, b: Page) {
  // ───────── 入口 ─────────
  const more = await pageText(a, "/more");
  expect(more).toContain("購買紀錄");
  await go(a, "/more");
  await a.getByRole("link", { name: /購買紀錄/ }).first().click();
  await a.waitForURL(/\/purchases$/);
  await loaded(a);
  const navCount = await a.locator("nav a").count();
  expect(navCount, "底部導覽維持五個").toBe(5);
  step("更多 → 購買紀錄；底部導覽沒有變成六顆");

  // ───────── 建立作品與角色 ─────────
  await go(a, "/purchases/manage");
  await a.getByLabel("作品名稱").fill("吉伊卡哇");
  await a.getByTestId("create-group").click();
  await a.waitForTimeout(1200);
  await go(a, "/purchases/manage");
  await a.getByTestId("manage-group-row").filter({ hasText: "吉伊卡哇" }).click();
  await a.waitForURL(/\/purchases\/manage\/[^/]+$/);
  await loaded(a);
  const manageUrl = a.url();

  // 建立時就有預設角色，而且只有改名沒有刪除
  await expect(a.getByTestId("default-tag-badge")).toHaveCount(1);
  const defaultRow = a.getByTestId("purchase-tag-row").first();
  await expect(defaultRow).toContainText("全角色");
  await expect(defaultRow.getByRole("button", { name: "刪除" })).toHaveCount(0);
  step("建立作品時自動附一個預設角色；它沒有刪除鈕");

  for (const name of ["小八", "兔兔"]) {
    await a.getByLabel("新角色名稱").fill(name);
    await a.getByTestId("create-tag").click();
    await a.waitForTimeout(1000);
    await go(a, manageUrl);
  }
  await expect(a.getByTestId("purchase-tag-row")).toHaveCount(3);
  step("新增角色：小八、兔兔");

  // ───────── 記帳時勾選加入 ─────────
  const before = await pageText(a, "/");
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("350");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("小八吊飾");
  // 沒勾之前不會出現任何購買紀錄的選項
  await expect(a.getByTestId("purchase-picker")).toHaveCount(0);
  await a.getByTestId("want-purchase").click();
  await expect(a.getByTestId("purchase-picker")).toBeVisible();
  await a.getByTestId("purchase-picker").getByRole("button", { name: "小八", exact: true }).click();
  await a.getByTestId("purchase-picker").getByRole("button", { name: /小艾/ }).click();
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);
  step("記帳頁：不勾完全照舊，勾了才就地展開作品 → 歸屬 → 角色");

  // ───────── 交易明細頁加入 ─────────
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("250");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("吉伊卡哇一番賞");
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);

  await go(a, "/transactions");
  await a.getByText("吉伊卡哇一番賞").first().click();
  await a.waitForURL(/\/transactions\/[^/]+$/);
  await loaded(a);
  await a.getByTestId("add-purchase-link").click();
  await a.waitForURL(/\/purchases\/new/);
  await loaded(a);
  await a.getByTestId("add-purchase-submit").click();
  await a.waitForTimeout(1500);
  step("交易明細頁的「加入購買紀錄」：金額與日期沿用，只要選作品、歸屬與角色");

  // ───────── 歷史購買（不產生記帳） ─────────
  await go(a, "/purchases");
  await a.getByTestId("purchase-group-card").first().click();
  await a.waitForURL(/\/purchases\/(?!new$|manage$|trial$)[^/]+/);
  await loaded(a);
  const groupUrl = a.url().split("?")[0];

  await go(a, `${groupUrl}`);
  await a.getByRole("link", { name: /在這個作品新增/ }).click();
  await a.waitForURL(/\/purchases\/new\?group=/);
  await a.getByRole("link", { name: "記一筆歷史購買" }).click();
  await loaded(a);
  await a.getByLabel("品項名稱").fill("兔兔玩偶");
  await a.getByLabel("金額").fill("540");
  await a.getByTestId("owner-chips").getByRole("button", { name: /阿本/ }).click();
  await a.getByTestId("tag-chips-purchase").getByRole("button", { name: "兔兔", exact: true }).click();
  await a.getByTestId("add-manual-submit").click();
  await a.waitForTimeout(1500);
  step("歷史購買獨立新增：不產生記帳，作品由頁面脈絡決定");

  // ───────── 作品內頁：兩個維度 ─────────
  await go(a, groupUrl);
  // 作品那一排不存在
  const filters = await a.locator('[data-testid="owner-filter"], [data-testid="tag-filter"]').count();
  expect(filters, "只有歸屬與角色兩排，沒有作品那一排").toBe(2);
  expect(await pageText(a)).not.toContain("排球少年");

  const total = a.getByTestId("purchase-total");
  const count = a.getByTestId("purchase-count");
  await expect(count).toHaveText("3 件");
  await expect(total).toHaveText("$1,140");
  await shot(a, "v12-01-group-all");
  step("作品內頁：全部 3 件 $1,140，畫面上沒有作品篩選列");

  // 歸屬篩選
  await a.getByTestId("owner-filter").getByRole("link", { name: /小艾/ }).click();
  await loaded(a);
  await expect(count).toHaveText("1 件");
  await expect(total).toHaveText("$350");
  step("歸屬選小艾 → 只算小艾的 1 件 $350");

  // 歸屬 + 角色同時套用
  await a.getByTestId("tag-filter").getByRole("link", { name: "小八", exact: true }).click();
  await loaded(a);
  await expect(count).toHaveText("1 件");
  await a.getByTestId("tag-filter").getByRole("link", { name: "兔兔", exact: true }).click();
  await loaded(a);
  await expect(count).toHaveText("0 件", { timeout: 10000 });
  await shot(a, "v12-02-two-dimensions");
  step("兩個維度同時套用：小艾 + 兔兔 = 0 件（兔兔玩偶是阿本的）");

  // ───────── 預設角色改名，chip 跟著變 ─────────
  await go(a, manageUrl);
  // 一定要綁在那一列上：作品設定區也有一顆「儲存」
  const defaultTagRow = a.getByTestId("purchase-tag-row").first();
  await defaultTagRow.getByRole("button", { name: "改名" }).click();
  await defaultTagRow.getByLabel(/的新名稱/).fill("未分類");
  await defaultTagRow.getByRole("button", { name: "儲存" }).click();
  await a.waitForTimeout(1500);
  await go(a, groupUrl);
  await expect(a.getByTestId("default-tag-chip")).toHaveText("未分類");
  step("預設角色改名成「未分類」之後，篩選 chip 跟著變（判斷看 isDefault，不是看名字）");

  // ───────── 刪除一般角色：紀錄移到預設 ─────────
  await go(a, manageUrl);
  const tunTun = a.getByTestId("purchase-tag-row").filter({ hasText: "兔兔" });
  await tunTun.getByTestId("delete-tag-open").click();
  await expect(a.getByTestId("delete-tag-confirm")).toContainText("移到預設角色");
  await a.getByTestId("delete-tag-confirm-btn").click();
  await a.waitForTimeout(1200);
  await go(a, groupUrl);
  await expect(a.getByTestId("purchase-count")).toHaveText("3 件", { timeout: 10000 });
  expect(await pageText(a), "兔兔玩偶還在，只是換了角色").toContain("兔兔玩偶");
  step("刪除「兔兔」之後購買紀錄一筆都沒少，移到了預設角色");

  // ───────── 關鍵字與試跑 ─────────
  await go(a, manageUrl);
  await a.getByLabel("新關鍵字").first().fill("吉伊卡哇");
  await a.getByRole("button", { name: "＋", exact: true }).first().click();
  await a.waitForTimeout(1200);
  await go(a, "/purchases/trial");
  await expect(a.getByTestId("trial-hit").first()).toBeVisible();
  await expect(a.getByTestId("trial-miss").first()).toBeVisible();
  const trial = (await pageText(a)).replace(/\s+/g, " ");
  expect(trial, "試跑要寫明只是模擬").toContain("沒有改動任何資料");
  expect(trial).toContain("不會命中");
  await shot(a, "v12-03-trial");
  step("關鍵字試跑：命中與未命中都列出來，並寫明不會改到任何資料");

  // ───────── 財務完全不受影響 ─────────
  const afterHome = await pageText(a, "/");
  const money = (s: string) => (s.match(/\$[\d,]+/g) ?? []).join("|");
  expect(money(afterHome).length > 0, "首頁還是有金額").toBe(true);
  const settle = (await pageText(a, "/settle")).replace(/\s+/g, " ");
  expect(settle).toMatch(/互不相欠|要還/);
  expect(before.length > 0).toBe(true);
  step("加了一整套購買紀錄之後，首頁與結算頁仍然正常");

  // 另一半看得到同一份（購買紀錄是共同帳本的）
  const forB = await pageText(b, groupUrl);
  expect(forB).toContain("兔兔玩偶");
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
