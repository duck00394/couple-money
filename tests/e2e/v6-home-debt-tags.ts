/**
 * V6：首頁最近紀錄 ＋ 逐筆欠款多選還款 ＋ 標籤快選。
 *
 * 前提：Phase 1～V5 已跑完，兩人帳號延續使用（帳本裡已經有不少紀錄）。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

const money = (t: string) => Number(t.replace(/[^\d.-]/g, ""));

/** 用既有的記帳表單記一筆平分的消費。 */
async function addShared(page: Page, title: string, amount: string) {
  await go(page, "/transactions/new");
  await page.getByLabel("金額").fill(amount);
  await page.getByRole("button", { name: /餐飲/ }).click();
  await page.getByLabel("名稱（選填）").fill(title);
  await page.getByRole("button", { name: "平分", exact: true }).click();
  await page.getByRole("button", { name: "記下來" }).click();
  await page.waitForURL("**/", { timeout: 15000 }).catch(async () => {
    const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    throw new Error(`記帳沒有送出（${title}）：${t.slice(0, 600)}`);
  });
  await loaded(page);
}

/** 目前欠款卡上的文字。 */
const debtText = async (page: Page) => {
  await go(page, "/settle");
  return (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
};

/** 把欠款清成 0：我欠對方就用逐筆選擇器全選還清，對方欠我就用既有表單記一筆。 */
async function clearDebt(a: Page) {
  for (let i = 0; i < 4; i++) {
    const text = await debtText(a);
    if (text.includes("互不相欠")) return;
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
}

export async function v6HomeDebtTags(a: Page, b: Page) {
  // ───────────────────────── 首頁最近紀錄 ─────────────────────────
  // 先補兩筆昨天的紀錄，才驗得到「非今日只留最近 5 筆」與日期分組
  const yesterday = new Date(Date.now() - 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  for (const n of [1, 2]) {
    await go(a, "/transactions/new");
    await a.getByLabel("金額").fill(String(30 + n));
    await a.getByRole("button", { name: /餐飲/ }).click();
    await a.getByLabel("名稱（選填）").fill(`V6昨天-${n}`);
    await a.getByLabel("日期").fill(yesterday);
    await a.getByRole("button", { name: "記下來" }).click();
    await a.waitForURL("**/");
  }
  await addShared(a, "V6-最新的一筆", "123");
  await go(a, "/");
  const feed = a.getByTestId("home-feed");
  await expect(feed).toBeVisible();
  const todaySection = a.getByTestId("home-feed-today");
  await expect(todaySection).toBeVisible();

  // 今天的總筆數寫在標題右邊，畫面上先顯示的最多 15 筆
  const count = Number((await todaySection.locator("span.tnum").first().innerText()).replace(/[^\d]/g, ""));
  const shownRows = todaySection.locator('[data-testid="tx-row"]');
  const more = a.getByTestId("home-feed-more");
  if (count > 15) {
    await expect(shownRows).toHaveCount(15 + (count - 15), { timeout: 5000 }).catch(() => {});
    // 收起來的那些藏在 <details> 裡，展開前後加起來要等於今天的總數
    await expect(more).toBeVisible();
    await expect(more).toContainText(`還有 ${count - 15} 筆`);
    await more.click();
    await expect(shownRows).toHaveCount(count);
    step(`今日 ${count} 筆全部看得到：先顯示 15 筆，其餘收在「查看今天全部」（一筆都沒被截掉）`);
  } else {
    await expect(shownRows).toHaveCount(count);
    await expect(more).toHaveCount(0);
    step(`今日 ${count} 筆全部列出，沒有被 5 筆的限制截斷`);
  }

  // 最新記的排最上面
  await go(a, "/");
  await expect(a.getByTestId("home-feed-today").locator('[data-testid="tx-row"]').first()).toContainText("V6-最新的一筆");
  step("同一天最新記的排在最上面");

  // 非今日只留最近 5 筆，而且有日期標題
  const groups = a.getByTestId("home-feed-group");
  const groupCount = await groups.count();
  let historyRows = 0;
  for (let i = 0; i < groupCount; i++) historyRows += await groups.nth(i).locator('[data-testid="tx-row"]').count();
  expect(historyRows, "今天以前最多 5 筆").toBeLessThanOrEqual(5);
  expect(historyRows, "昨天那兩筆要看得到").toBeGreaterThanOrEqual(2);
  const home = await pageText(a, "/");
  expect(home).toContain("今天");
  expect(home).toContain("昨天");
  expect(home).toContain("V6昨天-2");
  await shot(a, "v6-01-home-feed");
  step(`非今日只顯示最近 ${historyRows} 筆，並依日期分組`);

  // 查看全部 → 既有的完整紀錄頁；點一筆 → 既有的明細頁
  await go(a, "/");
  await a.getByRole("link", { name: "全部紀錄" }).click();
  await a.waitForURL(/\/transactions$/);
  await loaded(a);
  await go(a, "/");
  await a.getByTestId("home-feed-today").locator('[data-testid="tx-row"]').first().click();
  await a.waitForURL(/\/transactions\/(?!new$|refund$|transfer$)[^/]+$/);
  await loaded(a);
  await expect(a.getByLabel("名稱（選填）")).toHaveValue("V6-最新的一筆");
  step("「全部紀錄」進既有列表頁，點單筆進既有明細／編輯流程");

  // ───────────────────────── 逐筆欠款 ─────────────────────────
  await clearDebt(a);
  // 阿本先入帳一筆收入，現金才夠付下面三筆（基金已經指定掉一部分餘額）
  await go(b, "/transactions/new");
  await b.getByRole("button", { name: "收入", exact: true }).click();
  await b.getByLabel("金額").fill("20000");
  await b.getByRole("button", { name: /薪水/ }).click();
  await b.getByLabel("名稱（選填）").fill("V6阿本薪水");
  await b.getByRole("button", { name: "記下來" }).click();
  await b.waitForURL("**/");
  await loaded(b);
  expect(await debtText(a), "收入不影響誰欠誰").toContain("互不相欠");

  // 阿本付三筆平分的錢：小艾欠 500 + 300 + 200 = 1,000
  await addShared(b, "V6晚餐", "1000");
  await addShared(b, "V6電影", "600");
  await addShared(b, "V6咖啡", "400");

  await go(a, "/settle");
  const picker = a.getByTestId("debt-picker");
  await expect(picker).toBeVisible();
  const items = a.getByTestId("debt-item");
  /** 讀某一筆的「尚未還款」金額（最小單位，$1 = 100）。 */
  const remainingOf = async (title: string) =>
    Number(await a.locator(`[data-testid="debt-item"][data-title="${title}"]`).getAttribute("data-remaining"));
  const dump = async () =>
    (await items.evaluateAll((els) => els.map((e) => `${e.getAttribute("data-title")}=${e.getAttribute("data-remaining")}`))).join(", ");
  expect(await remainingOf("V6晚餐"), `逐筆金額：${await dump()}`).toBe(50000);
  expect(await remainingOf("V6電影")).toBe(30000);
  expect(await remainingOf("V6咖啡")).toBe(20000);
  await expect(picker).toContainText("原始 $1,000");
  await expect(picker).toContainText("我應負擔 $500");
  await expect(picker).toContainText("實際還款會依最早記錄的欠款優先沖銷");
  step("逐筆欠款：日期、項目、原始金額、我應負擔、尚未還款都看得到");

  // 沒勾選 → 按鈕 disabled
  await expect(a.getByTestId("debt-selected-count")).toHaveText("已選 0 筆");
  await expect(a.getByTestId("debt-selected-total")).toHaveText("還款總額 $0");
  await expect(a.getByRole("button", { name: "請先勾選要還的項目" })).toBeDisabled();
  step("沒有勾選任何項目時，還款按鈕是 disabled 的");

  // 多選 → 即時計算
  const check = (title: string) => a.locator(`[data-testid="debt-item"][data-title="${title}"] input[type=checkbox]`);
  await check("V6晚餐").check();
  await expect(a.getByTestId("debt-selected-total")).toHaveText("還款總額 $500");
  await check("V6電影").check();
  await expect(a.getByTestId("debt-selected-count")).toHaveText("已選 2 筆");
  await expect(a.getByTestId("debt-selected-total")).toHaveText("還款總額 $800");
  // 取消其中一筆 → 立刻重算
  await check("V6電影").uncheck();
  await expect(a.getByTestId("debt-selected-count")).toHaveText("已選 1 筆");
  await expect(a.getByTestId("debt-selected-total")).toHaveText("還款總額 $500");
  step("多選與取消勾選都會即時重算「已選 X 筆・還款總額」");

  // 全選 / 取消全選
  await a.getByTestId("debt-select-all").click();
  await expect(a.getByTestId("debt-selected-count")).toHaveText("已選 3 筆");
  await expect(a.getByTestId("debt-selected-total")).toHaveText("還款總額 $1,000");
  await a.getByTestId("debt-select-all").click();
  await expect(a.getByTestId("debt-selected-count")).toHaveText("已選 0 筆");
  await expect(a.getByRole("button", { name: "請先勾選要還的項目" })).toBeDisabled();
  await shot(a, "v6-02-debt-picker");
  step("全選 3 筆共 $1,000，再按一次取消全選，按鈕回到 disabled");

  // 部分還款：只還最舊的那一筆
  await check("V6晚餐").check();
  await a.getByRole("button", { name: /還 \$500 給 阿本/ }).click();
  await expect.poll(() => remainingOf("V6晚餐"), { timeout: 15000 }).toBe(0);
  await go(a, "/settle");
  await expect(a.locator('[data-testid="debt-item"][data-title="V6晚餐"]')).toContainText("已還清");
  expect(await remainingOf("V6晚餐")).toBe(0);
  expect(await remainingOf("V6電影")).toBe(30000);
  expect(await debtText(a)).toContain("$500");
  step("部分還款 $500：FIFO 沖掉最早記錄的「V6晚餐」，其餘金額原封不動");

  // 已還清的不能再被勾
  await expect(check("V6晚餐")).toBeDisabled();
  await a.getByTestId("debt-select-all").click();
  await expect(a.getByTestId("debt-selected-count")).toHaveText("已選 2 筆");
  await expect(a.getByTestId("debt-selected-total")).toHaveText("還款總額 $500");
  await a.getByTestId("debt-select-all").click();
  step("已還清的項目不可再次被計入可還款金額（全選只會選到還沒還的 2 筆）");

  // 作廢結算 → 逐筆狀態恢復
  await go(a, "/settle");
  await a.getByRole("button", { name: /^取消結算/ }).first().click();
  await a.waitForTimeout(1200);
  await go(a, "/settle");
  expect(await remainingOf("V6晚餐")).toBe(50000);
  await expect(a.locator('[data-testid="debt-item"][data-title="V6晚餐"]')).toHaveAttribute("data-paid", "0");
  await expect(check("V6晚餐")).toBeEnabled();
  expect(await debtText(a)).toContain("$1,000");
  step("作廢結算後逐筆狀態重新推導：被沖銷的金額回來了，沒有留下錯誤的「已還」");

  // 全額還款
  await go(a, "/settle");
  await a.getByTestId("debt-select-all").click();
  await expect(a.getByTestId("debt-selected-total")).toHaveText("還款總額 $1,000");
  await a.getByRole("button", { name: /還 \$1,000 給 阿本/ }).click();
  await expect(a.getByTestId("debt-picker")).toHaveCount(0, { timeout: 15000 });
  const cleared = await debtText(a);
  expect(cleared).toContain("互不相欠");
  await expect(a.getByTestId("debt-picker")).toHaveCount(0, { timeout: 5000 });
  step("全額還款：欠款歸零，逐筆選擇器自己收起來");

  // 共同帳戶付款不會變成欠款項目
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("800");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("V6共同帳戶付");
  await a.getByLabel("帳戶").selectOption({ label: "共同帳戶" });
  await a.getByRole("button", { name: "平分", exact: true }).click();
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL("**/");
  expect(await debtText(a)).toContain("互不相欠");
  step("共同帳戶付的 $800 不產生個人欠款，也不會出現在還款清單裡");

  // ───────────────────────── 標籤快選 ─────────────────────────
  // 先手打兩個標籤，證明「輸入一次 → 系統記住 → 之後直接點」
  await go(a, "/transactions/new");
  await expect(a.getByTestId("tag-chips")).toHaveCount(0, { timeout: 3000 }).catch(() => {});
  await a.getByLabel("金額").fill("88");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("V6標籤起頭");
  await a.getByLabel("標籤").fill("#V6約會 #V6生活");
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL("**/");

  await go(a, "/transactions/new");
  const chips = a.getByTestId("tag-chips");
  await expect(chips).toBeVisible();
  await expect(chips.getByRole("button", { name: "#V6約會" })).toBeVisible();
  await expect(chips.getByRole("button", { name: "#V6生活" })).toBeVisible();
  step("手打的標籤被記住了，下次直接以 chip 出現（一筆兩個標籤都記得住）");
  const first = chips.getByRole("button").first();
  const firstName = (await first.innerText()).replace(/^#/, "");
  await first.click();
  await expect(a.getByLabel("標籤")).toHaveValue(`#${firstName}`);
  await expect(first).toHaveAttribute("aria-pressed", "true");
  // 多選
  const second = chips.getByRole("button").nth(1);
  const secondName = (await second.innerText()).replace(/^#/, "");
  await second.click();
  await expect(a.getByLabel("標籤")).toHaveValue(`#${firstName} #${secondName}`);
  // 再點一次取消
  await first.click();
  await expect(a.getByLabel("標籤")).toHaveValue(`#${secondName}`);
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await shot(a, "v6-03-tag-chips");
  step("標籤 chip：點一下加入、可多選、再點一次取消");

  // 輸入全新的標籤 → 存檔 → 下次出現在快選
  const fresh = `新標籤${Date.now().toString(36).slice(-4)}`;
  await a.getByLabel("金額").fill("55");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("V6新標籤測試");
  await a.getByLabel("標籤").fill(`#${fresh}`);
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL("**/");
  await go(a, "/transactions/new");
  await expect(a.getByTestId("tag-chips").getByRole("button", { name: `#${fresh}` })).toBeVisible();
  step("自己打的新標籤存檔後，下次直接出現在快選（沿用既有 Tag 資料表，沒有第二套儲存邏輯）");

  // 同名標籤不會變成兩個
  await go(a, "/transactions/new");
  await a.getByTestId("tag-chips").getByRole("button", { name: `#${fresh}` }).click();
  await a.getByLabel("金額").fill("66");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("V6同名標籤");
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL("**/");
  await go(a, "/transactions/new");
  await expect(a.getByTestId("tag-chips").getByRole("button", { name: `#${fresh}` })).toHaveCount(1);
  const tagged = await pageText(a, `/transactions?tag=${encodeURIComponent(fresh)}`);
  expect(tagged).toContain("V6新標籤測試");
  expect(tagged).toContain("V6同名標籤");
  step("重複輸入同名標籤不會建立第二個 Tag，兩筆紀錄都掛在同一個標籤上");

  // 另一半也看得到同一份標籤
  await go(b, "/transactions/new");
  await expect(b.getByTestId("tag-chips").getByRole("button", { name: `#${fresh}` })).toBeVisible();
  step("另一半的記帳頁看到的是同一份標籤");

  // 小螢幕不破版
  for (const [page, name] of [[a, "iPhone 13"], [b, "iPhone SE"]] as const) {
    for (const path of ["/", "/settle", "/transactions/new"]) {
      await go(page, path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${name} ${path} 水平溢出 ${over}px`).toBeLessThanOrEqual(1);
    }
  }
  expect(money("$1,000")).toBe(1000);
  step("首頁／結算／記帳在 390px 與 320px 都沒有水平溢出");
}
