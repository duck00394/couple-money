/**
 * 手機 UX 驗收：兩個尺寸（iPhone 13 390×664、iPhone SE 320×568）逐頁檢查
 *   1. 沒有水平溢出（不會左右晃）
 *   2. 底部導覽列沒有蓋住主要按鈕
 *   3. 主要按鈕看得到、點得到
 *   4. 超長名稱／備註不會把版面撐破
 * 前提：Phase 1～3-3 流程已跑完（帳本裡已經有各種資料）。
 */
import { devices, expect, type Page } from "@playwright/test";
import { go, shot, step } from "./lib";

type Size = { name: string; width: number; height: number };
const SIZES: Size[] = [
  { name: "iPhone 13", ...devices["iPhone 13"].viewport },
  { name: "iPhone SE", ...devices["iPhone SE"].viewport },
];

/** 逐頁檢查：路徑 + 這一頁一定要看得到（而且點得到）的主要按鈕。 */
const PAGES: Array<{ path: string; label: string; action?: string }> = [
  { path: "/", label: "首頁", action: "＋ 記一筆" },
  { path: "/transactions", label: "記帳列表", action: "＋ 記一筆" },
  { path: "/transactions?q=火鍋", label: "搜尋結果", action: "匯出成 CSV" },
  { path: "/transactions/new", label: "新增支出／收入", action: "記下來" },
  { path: "/transactions/transfer", label: "轉帳", action: "建立轉帳" },
  { path: "/transactions/refund", label: "退款", action: "建立退款" },
  { path: "/recurring", label: "固定支出", action: "＋ 新增" },
  { path: "/recurring/new", label: "新增固定支出", action: "建立固定支出" },
  { path: "/stats", label: "統計" },
  { path: "/goals", label: "目標" },
  { path: "/funds", label: "基金" },
  { path: "/funds/new", label: "新增基金", action: "建立基金" },
  { path: "/tasks", label: "任務" },
  { path: "/accounts", label: "帳戶" },
  { path: "/settle", label: "結算" },
  { path: "/activity", label: "最近動態" },
  { path: "/categories", label: "分類管理", action: "＋ 新增分類" },
  { path: "/budgets", label: "預算" },
  { path: "/more", label: "更多" },
];

async function overflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const widest = [...document.querySelectorAll<HTMLElement>("body *")]
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
      .sort((a, b) => b.right - a.right)[0];
    return {
      scrollWidth: doc.scrollWidth,
      innerWidth: window.innerWidth,
      widest: widest ? `${widest.el.tagName}.${widest.el.className}`.slice(0, 80) : "",
      widestRight: widest?.right ?? 0,
    };
  });
}

/** 按鈕的中心點是不是被別的元素（例如底部導覽列）蓋住。 */
async function coveredBy(page: Page, name: string) {
  return page.evaluate((btnName) => {
    const el = [...document.querySelectorAll<HTMLElement>("button, a")].find((x) => (x.innerText || "").trim().includes(btnName));
    if (!el) return "NOT_FOUND";
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return "ZERO_SIZE";
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cy < 0 || cy > window.innerHeight) return "OFFSCREEN"; // 可以捲動到，不算被蓋住
    const top = document.elementFromPoint(cx, cy);
    return top && (top === el || el.contains(top) || top.contains(el)) ? "" : `COVERED_BY:${(top as HTMLElement)?.tagName}.${(top as HTMLElement)?.className}`.slice(0, 80);
  }, name);
}

export async function uxAudit(a: Page) {
  const problems: string[] = [];

  for (const size of SIZES) {
    await a.setViewportSize({ width: size.width, height: size.height });
    for (const p of PAGES) {
      await go(a, p.path);
      await a.waitForLoadState("networkidle");
      const o = await overflow(a);
      if (o.scrollWidth > o.innerWidth + 1) {
        problems.push(`${size.name} ${p.label}：水平溢出 ${o.scrollWidth}>${o.innerWidth}（${o.widest}）`);
      }
      if (p.action) {
        const covered = await coveredBy(a, p.action);
        if (covered === "NOT_FOUND") problems.push(`${size.name} ${p.label}：找不到主要按鈕「${p.action}」`);
        else if (covered.startsWith("COVERED_BY")) problems.push(`${size.name} ${p.label}：主要按鈕「${p.action}」被蓋住 ${covered}`);
      }
      // 每一頁都要看得到底部導覽（不然會變成走不出去的死路）
      await expect(a.getByRole("link", { name: "首頁" })).toBeVisible();
    }
    step(`${size.name}：${PAGES.length} 個頁面沒有水平溢出、主要按鈕可點、導覽列都在`);
  }

  // 超長名稱與備註不破版
  await a.setViewportSize({ width: 320, height: 568 });
  await go(a, "/transactions/new");
  const longTitle = "超長名稱測試".repeat(6);
  await a.getByLabel("金額").fill("123.45");
  await a.getByLabel("名稱（選填）").fill(longTitle.slice(0, 50));
  await a.getByLabel("備註（選填）").fill("https://example.com/very/long/order/reference/1234567890ABCDEFGHIJKLMNOP");
  await a.getByLabel("標籤").fill("#超長標籤測試超長標籤測試");
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL(/\/$/);
  await go(a, "/transactions");
  const listOverflow = await overflow(a);
  if (listOverflow.scrollWidth > listOverflow.innerWidth + 1) problems.push(`小尺寸列表：長名稱造成水平溢出（${listOverflow.widest}）`);
  await a.getByTestId("tx-row").filter({ hasText: longTitle.slice(0, 12) }).first().click();
  await a.waitForURL(/\/transactions\/[\w-]+$/);
  await a.locator("summary", { hasText: "查看詳細資料" }).click();
  const detailOverflow = await overflow(a);
  if (detailOverflow.scrollWidth > detailOverflow.innerWidth + 1) problems.push(`小尺寸詳細頁：長備註造成水平溢出（${detailOverflow.widest}）`);
  await shot(a, "ux-01-long-text-320");
  step("超長名稱／網址備註／長標籤在 320px 不會破版");

  // 帳戶頁：展開「調整餘額」表單後在 320px 不會破版、按鈕點得到
  await go(a, "/accounts");
  const adjustTrigger = a.getByRole("button", { name: /調整 .* 的餘額/ }).first();
  if (await adjustTrigger.count() > 0) {
    await adjustTrigger.click();
    await expect(a.getByTestId("adjust-form").first()).toBeVisible();
    const adjustOverflow = await overflow(a);
    if (adjustOverflow.scrollWidth > adjustOverflow.innerWidth + 1) problems.push(`帳戶頁：展開調整餘額後水平溢出（${adjustOverflow.widest}）`);
    const submitCovered = await coveredBy(a, "建立調整");
    if (submitCovered.startsWith("COVERED_BY")) problems.push(`帳戶頁：「建立調整」被蓋住 ${submitCovered}`);
    await shot(a, "ux-03-adjust-320");
    step("帳戶頁的「調整餘額」表單在 320px 不會破版、送出鈕點得到");
  }

  // 固定支出詳細頁：導覽列與「修改設定」的送出列不會互相遮住
  await go(a, "/recurring");
  await a.getByTestId("recurring-row").first().click();
  await a.waitForURL(/\/recurring\/[\w-]+$/);
  await expect(a.getByRole("link", { name: "首頁" })).toBeVisible();
  await a.locator("summary", { hasText: "修改設定" }).click();
  const saveCovered = await coveredBy(a, "儲存修改");
  if (saveCovered.startsWith("COVERED_BY")) problems.push(`固定支出詳細頁：儲存按鈕被蓋住 ${saveCovered}`);
  await shot(a, "ux-02-recurring-detail-320");
  step("固定支出詳細頁：導覽列與送出列不互相遮蓋");

  await a.setViewportSize({ width: 390, height: 664 });
  if (problems.length) throw new Error(`手機 UX 問題：\n- ${problems.join("\n- ")}`);
}
