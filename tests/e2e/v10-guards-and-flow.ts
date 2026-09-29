/**
 * V10：財務防護與日常操作。
 *   1. 結算不會吃掉基金指定的錢（UI 上看得到錯誤訊息）
 *   2. 已結清／已取消的預購不再提供「記錄付款」
 *   3. 預購改小到低於已付金額會提醒，但不阻擋
 *   4. 任務頁：完成的只在佈告欄，不再重複出現在「今天」
 *   5. 首頁順序：今日任務 → 最近紀錄 → 需要處理 → 可以花的錢 → 基金 → 本月
 *   6. 記帳「再記一筆」可以連續記
 *   7. 基金詳細頁返回基金列表、更多頁不再有「共同目標」
 *
 * 前提：Phase 1～V9 已跑完，兩人帳號延續使用。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

/** 目前的欠款文字。 */
const settleText = async (p: Page) => {
  await go(p, "/settle");
  return (await p.locator("main").first().innerText()).replace(/\s+/g, " ");
};

export async function v10GuardsAndFlow(a: Page, b: Page) {
  // ───────── 7. 資訊架構的兩個小修正 ─────────
  await go(a, "/goals");
  await a.getByTestId("fund-row").first().click();
  await a.waitForURL(/\/funds\/(?!new$)[^/]+$/);
  await loaded(a);
  await a.getByRole("link", { name: "返回" }).click();
  await a.waitForURL(/\/funds$/);
  step("基金詳細頁的返回回到基金列表，不再跳到共同目標");

  const more = await pageText(a, "/more");
  expect(more, "共同目標不是『紀錄』，已從更多頁移除").not.toContain("共同目標");
  const funds = await pageText(a, "/funds");
  expect(funds, "基金頁仍然有目標的入口").toContain("共同目標");
  step("「共同目標」只留在基金頁的合理入口，更多 → 紀錄 裡不再重複出現");

  // ───────── 5. 首頁順序 ─────────
  await go(a, "/");
  const order = await a.evaluate(() => {
    const ids = ["today-tasks", "home-feed", "available-card", "home-funds", "month-expense"];
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return { id, y: el ? el.getBoundingClientRect().top + window.scrollY : -1 };
    });
  });
  const y = (id: string) => order.find((o) => o.id === id)!.y;
  expect(y("today-tasks"), "今日任務要在最近紀錄前面").toBeLessThan(y("home-feed"));
  expect(y("home-feed"), "最近紀錄要在「可以花的錢」前面").toBeLessThan(y("available-card"));
  expect(y("available-card"), "「可以花的錢」要在基金前面").toBeLessThan(y("home-funds"));
  expect(y("home-funds"), "基金要在本月前面").toBeLessThan(y("month-expense"));
  await shot(a, "v10-01-home-order");
  step("首頁順序：今日任務 → 最近紀錄 →（欠款／提醒）→ 可以花的錢 → 基金 → 本月");

  // ───────── 6. 再記一筆 ─────────
  await go(a, "/transactions/new");
  await expect(a.getByTestId("save-and-more")).toBeVisible();
  await a.getByLabel("金額").fill("111");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("V10連記一");
  await a.getByTestId("save-and-more").click();
  // 留在同一頁，金額與名稱清空，帳戶與日期留著
  await expect(a.getByTestId("toast")).toContainText("已記下來");
  await expect(a).toHaveURL(/\/transactions\/new$/);
  await expect(a.getByLabel("名稱（選填）")).toHaveValue("");
  expect(await a.getByLabel("金額").inputValue()).toBe("");
  step("「再記一筆」：留在記帳頁、清空金額與名稱，帳戶與日期留著");

  // 第二筆真的記得下去（clientRequestId 有換，不會被防重複送出吃掉）
  await a.getByLabel("金額").fill("222");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("V10連記二");
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);
  const txs = await pageText(a, "/transactions");
  expect(txs).toContain("V10連記一");
  expect(txs).toContain("V10連記二");
  step("連續記兩筆都有進去（第二筆沒有被 idempotency key 吃掉），按「記下來」才離開");

  // 從基金頁進來的特殊流程不給「再記一筆」，記完要回基金頁
  await go(a, "/goals");
  await a.getByTestId("fund-row").first().click();
  await a.waitForURL(/\/funds\/(?!new$)[^/]+$/);
  await loaded(a);
  const fundUrl = a.url();
  await a.getByRole("link", { name: "記一筆基金支出" }).click();
  await a.waitForURL(/\/transactions\/new\?fund=/);
  await expect(a.getByTestId("save-and-more"), "特殊入口只給單一送出鈕").toHaveCount(0);
  await go(a, fundUrl);
  step("從基金頁進來的記帳不給「再記一筆」，避免卡在表單回不去");

  // ───────── 4. 任務頁不重複顯示 ─────────
  await go(a, "/tasks/new");
  await a.getByLabel(/名稱/).first().fill("V10每日任務");
  await a.getByRole("button", { name: /建立/ }).first().click();
  await a.waitForTimeout(1200);
  await go(a, "/tasks");
  // 完成前：在「今天」待做清單裡
  await expect(a.getByRole("button", { name: /打卡 V10每日任務/ })).toBeVisible();
  await expect(a.getByTestId("task-note").filter({ hasText: "V10每日任務" })).toHaveCount(0);
  await a.getByRole("button", { name: /打卡 V10每日任務/ }).first().click();
  await a.waitForTimeout(1200);
  await go(a, "/tasks");
  // 完成後：只在佈告欄，待做清單裡找不到打卡鈕
  await expect(a.getByTestId("task-note").filter({ hasText: "V10每日任務" })).toHaveCount(1);
  await expect(a.getByRole("button", { name: /打卡 V10每日任務/ })).toHaveCount(0);
  await shot(a, "v10-02-tasks");
  step("任務完成後只留在佈告欄，不再重複出現在「今天」待做清單");

  // 「每次」任務刻意例外：做過了也還留著「再一次」
  const tasksText = await pageText(a, "/tasks");
  expect(tasksText, "每次任務仍然可以再做一次").toContain("再一次");
  step("「每次」任務是刻意的例外：佈告欄看得到成果，待做清單仍留著「再一次」");

  // ───────── 2＋3. 預購的付款防護 ─────────
  await go(a, "/preorders/new");
  await a.getByLabel("品名").fill("V10預購");
  await a.getByLabel("商品金額").fill("1000");
  await a.getByRole("button", { name: "建立預購" }).click();
  await a.waitForURL(/\/preorders\/(?!new$)[^/]+$/);
  await loaded(a);
  const poUrl = a.url();

  await a.getByLabel("付款金額").fill("1000");
  await a.getByRole("button", { name: "記錄這次付款" }).click();
  await expect(a.getByTestId("preorder-remaining")).toHaveText("$0", { timeout: 10000 });
  await go(a, poUrl);
  await expect(a.getByLabel("付款金額"), "已結清就不再提供記錄付款").toHaveCount(0);
  expect((await pageText(a)).replace(/\s+/g, " ")).toContain("已經付清");
  step("預購付清之後畫面不再提供「記錄付款」，改成說明目前狀態");

  // 改小到低於已付：允許，但會提醒
  await a.getByText("編輯預購").click();
  await a.getByLabel("商品金額").fill("600");
  await expect(a.getByTestId("preorder-overpaid-warning")).toContainText("高於預購總額");
  await a.getByRole("button", { name: "儲存" }).click();
  await expect(a.getByText("已儲存")).toBeVisible({ timeout: 10000 });
  await go(a, poUrl);
  expect((await pageText(a)).replace(/\s+/g, " ")).toContain("多付了");
  step("預購改小到低於已付金額不會被擋，但會明確提醒會變成超付");

  // 取消之後也不給記錄付款
  await a.getByRole("button", { name: "取消這張預購" }).click();
  await a.waitForTimeout(1200);
  await go(a, poUrl);
  await expect(a.getByLabel("付款金額")).toHaveCount(0);
  expect((await pageText(a)).replace(/\s+/g, " ")).toContain("已經取消，不能再記錄付款");
  step("已取消的預購也不再提供「記錄付款」");

  // ───────── 1. 結算的基金防護 ─────────
  // 規則本身在 service 層（tests/integration/v10-financial-guards.ts 有 6 個案例），
  // 這裡只確認畫面沒有因為新增檢查而壞掉：欠款頁仍然正常、該結算的仍然結算得了。
  const settle = await settleText(a);
  expect(settle).toMatch(/互不相欠|要還/);
  step("加了基金防護之後，結算頁仍然正常運作");

  // 小螢幕不破版
  for (const [page, name] of [[a, "iPhone 13"], [b, "iPhone SE"]] as const) {
    for (const path of ["/", "/tasks", "/settle", "/preorders", "/transactions/new"]) {
      await go(page, path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${name} ${path} 水平溢出 ${over}px`).toBeLessThanOrEqual(1);
    }
  }
  step("首頁／任務／結算／預購／記帳在 390px 與 320px 都沒有水平溢出");
}
