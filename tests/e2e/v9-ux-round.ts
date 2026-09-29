/**
 * V9：使用性優化五項。
 *   1. 預購預設分類（統計不再被「未分類」吃掉）
 *   2. 收錢的那一方也看得到逐筆明細（唯讀）
 *   3. 空狀態瘦身（首頁今日獎勵、任務頁）
 *   4. 記帳頁：標籤上移、預購／基金收進「進階（選填）」
 *   5. 明細頁捷徑瘦身、欠款卡的結算入口變成主要按鈕
 *
 * 前提：Phase 1～V8 已跑完，兩人帳號延續使用。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, openAdvanced, pageText, shot, step } from "./lib";

/** 目前的欠款文字。 */
const debtText = async (p: Page) => {
  await go(p, "/settle");
  return (await p.locator("main").first().innerText()).replace(/\s+/g, " ");
};

export async function v9UxRound(a: Page, b: Page) {
  // ───────── 4. 記帳頁：標籤上移、進階收起來 ─────────
  await go(a, "/transactions/new");
  const advanced = a.getByTestId("tx-advanced");
  await expect(advanced).toBeVisible();
  // 收起來時，裡面的預購／基金選單是看不到的
  await expect(a.getByTestId("preorder-select")).toBeHidden();
  await expect(a.getByLabel("從基金扣")).toBeHidden();
  // 標籤 chips 在分類附近，不用滑到最底下
  const chips = a.getByTestId("tag-chips");
  await expect(chips).toBeVisible();
  const chipsY = (await chips.boundingBox())!.y;
  const accountY = (await a.getByLabel("帳戶").boundingBox())!.y;
  expect(chipsY, "標籤 chips 要排在帳戶欄位前面").toBeLessThan(accountY);
  await shot(a, "v9-01-new-tx");
  step("記帳頁：標籤快選移到分類下面；預購與從基金扣收進「進階（選填）」");

  await openAdvanced(a);
  await expect(a.getByTestId("preorder-select")).toBeVisible();
  step("需要的時候展開「進階」就看得到預購與基金");

  // ───────── 1. 預購預設分類 ─────────
  await go(a, "/preorders/new");
  await a.getByLabel("品名").fill("V9 有分類的預購");
  await a.getByLabel("商品金額").fill("4000");
  await a.getByLabel("預購分類").selectOption({ label: "購物" });
  await a.getByRole("button", { name: "建立預購" }).click();
  await a.waitForURL(/\/preorders\/(?!new$)[^/]+$/);
  await loaded(a);
  const poId = a.url().split("/").pop()!;

  // 付款表單的分類已經預先選好
  await expect(a.getByLabel("付款分類")).toHaveValue(/.+/);
  const picked = await a.getByLabel("付款分類").locator("option:checked").innerText();
  expect(picked).toContain("購物");
  await a.getByLabel("付款金額").fill("1500");
  await a.getByRole("button", { name: "記錄這次付款" }).click();
  await expect(a.getByTestId("preorder-paid")).toHaveText("$1,500", { timeout: 10000 });

  // 這筆消費真的有分類，不是「未分類」
  const tagged = await pageText(a, "/transactions?categoryId=");
  expect(tagged).toBeTruthy();
  await go(a, `/preorders/${poId}`);
  await a.getByTestId("preorder-payment").first().click();
  await a.waitForURL(/\/transactions\/(?!new$|refund$|transfer$)[^/]+$/);
  await loaded(a);
  await expect(a.getByRole("button", { name: /購物/ })).toHaveClass(/ring-brand-500/);
  step("預購可以設預設分類：記錄付款時自動帶入，那筆消費不再是「未分類」");

  // 記帳頁選了這張預購，分類也會自動帶
  await go(a, "/transactions/new");
  await openAdvanced(a);
  await a.getByTestId("preorder-select").selectOption(poId);
  await expect(a.getByRole("button", { name: /購物/ })).toHaveClass(/ring-brand-500/);
  step("記帳頁選了預購之後，分類也自動帶入（還沒選分類時才帶，不會蓋掉自己選的）");

  // ───────── 5. 明細頁捷徑瘦身 ─────────
  await go(a, "/transactions");
  const shortcuts = a.getByRole("main"); // 底部導覽不算
  await expect(shortcuts.getByRole("link", { name: "轉帳", exact: true })).toBeVisible();
  await expect(shortcuts.getByRole("link", { name: "退款", exact: true })).toBeVisible();
  await expect(shortcuts.getByRole("link", { name: "固定支出", exact: true })).toBeVisible();
  await expect(shortcuts.getByRole("link", { name: "統計", exact: true })).toHaveCount(0);
  await expect(shortcuts.getByRole("link", { name: "帳戶", exact: true })).toHaveCount(0);
  await expect(shortcuts.getByRole("link", { name: "結算", exact: true })).toHaveCount(0);
  await expect(a.getByTestId("export-all")).toBeVisible();
  step("明細頁捷徑只留轉帳／退款／固定支出：統計與帳戶在底部導覽和更多頁已經有了");

  // ───────── 2. 收錢的那一方也看得到逐筆明細 ─────────
  // 先把欠款清乾淨，數字才好對
  for (let i = 0; i < 4; i++) {
    const text = await debtText(a);
    if (text.includes("互不相欠")) break;
    const picker = a.getByTestId("debt-picker");
    if (await picker.isVisible().catch(() => false)) {
      await picker.getByTestId("debt-select-all").click();
      await a.getByRole("button", { name: /還 \$/ }).click();
    } else {
      await a.getByRole("button", { name: /^確認：/ }).click();
    }
    await a.waitForTimeout(1200);
  }
  expect(await debtText(a)).toContain("互不相欠");

  // 讓阿本付兩筆平分的錢，方向變成「小艾欠阿本」
  for (const [title, amount] of [["V9甲", "600"], ["V9乙", "400"]] as const) {
    await go(b, "/transactions/new");
    await b.getByLabel("金額").fill(amount);
    await b.getByRole("button", { name: /餐飲/ }).click();
    await b.getByLabel("名稱（選填）").fill(title);
    await b.getByRole("button", { name: "平分", exact: true }).click();
    await b.getByRole("button", { name: "記下來" }).click();
    await b.waitForURL("**/");
  }

  // 欠錢的小艾：可勾選
  const aText = await debtText(a);
  expect(aText).toContain("你要還");
  await expect(a.getByTestId("debt-picker")).toBeVisible();
  await expect(a.getByTestId("debt-readonly")).toHaveCount(0);

  // 收錢的阿本：同一份明細，但只能看
  const bText = await debtText(b);
  expect(bText).toContain("要還你");
  const readonly = b.getByTestId("debt-readonly");
  await expect(readonly).toBeVisible();
  await expect(readonly).toContainText("小艾還沒還的項目");
  await expect(readonly).toContainText("V9甲");
  await expect(readonly).toContainText("V9乙");
  await expect(readonly).toContainText("小艾應負擔");
  await expect(b.getByTestId("debt-picker")).toHaveCount(0);
  await expect(b.locator('[data-testid="debt-readonly"] input[type=checkbox]')).toHaveCount(0);
  await shot(b, "v9-02-debt-readonly");
  step("收錢的那一方也看得到逐筆明細（V9甲 / V9乙），但沒有 checkbox、不能代對方還款");

  // 兩邊看到的是同一份：逐筆加總 = 欠款總額
  const remains = await b.locator('[data-testid="debt-readonly"] [data-remaining]').evaluateAll(
    (els) => els.reduce((sum, e) => sum + Number(e.getAttribute("data-remaining")), 0),
  );
  expect(remains).toBe(50000); // 600/2 + 400/2 = $500
  step("唯讀清單的金額加總 $500 跟欠款總額一致");

  // ───────── 5b. 欠款卡的結算入口 ─────────
  await go(a, "/");
  await expect(a.getByTestId("go-settle")).toContainText("去還款");
  await a.getByTestId("go-settle").click();
  await a.waitForURL(/\/settle$/);
  await go(b, "/");
  await expect(b.getByTestId("go-settle")).toContainText("看明細");
  step("首頁欠款卡的結算鈕變成主要按鈕：欠錢的寫「去還款」、收錢的寫「看明細」");

  // 還清，回到乾淨狀態
  await go(a, "/settle");
  await a.getByTestId("debt-select-all").click();
  await a.getByRole("button", { name: /還 \$500 給/ }).click();
  await expect(a.getByTestId("debt-picker")).toHaveCount(0, { timeout: 15000 });

  // ───────── 3. 空狀態瘦身 ─────────
  const home = await pageText(a, "/");
  expect(home).toContain("最近紀錄");
  // 這個帳本已經有獎勵紀錄，所以獎勵卡應該還在（只有全是 0 才收起來）
  const tasks = await pageText(a, "/tasks");
  expect(tasks).toContain("今天");
  expect(tasks, "空的分組不再佔位置").not.toContain("（0）");
  await shot(a, "v9-03-tasks");
  step("空狀態瘦身：任務頁不再列出 0 筆的分組");

  // 小螢幕不破版
  for (const [page, name] of [[a, "iPhone 13"], [b, "iPhone SE"]] as const) {
    for (const path of ["/", "/tasks", "/settle", "/transactions", "/transactions/new"]) {
      await go(page, path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${name} ${path} 水平溢出 ${over}px`).toBeLessThanOrEqual(1);
    }
  }
  step("首頁／任務／結算／明細／記帳在 390px 與 320px 都沒有水平溢出");
}
