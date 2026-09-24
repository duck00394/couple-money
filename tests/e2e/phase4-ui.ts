/**
 * V2 UI 驗收 + 使用者頭貼。
 *
 * 1. 全站不可以再出現「當成 UI icon 的 emoji」（分類、任務、目標、基金、帳本、
 *    導覽列、按鈕、空狀態、統計、預算、固定支出、動態、使用者區塊都逐頁掃過）
 * 2. 主要金額真的是最大的視覺層級
 * 3. 卡片不再靠重陰影撐起來（髮絲線 + 留白）
 * 4. 頭貼：上傳 → 圓形顯示 → 另一半看得到 → 移除後回預設
 * 5. 320px 不會水平溢出（含頭貼區塊）
 *
 * 前提：Phase 1～3-4 已跑完，兩人帳號延續使用。
 */
import { devices, expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

/**
 * 會被當成圖示用的 emoji。
 * 只掃 emoji 區段，不掃一般標點（頁面上的「‹ › ＋ ・ →」是文字不是 emoji）。
 */
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F000}-\u{1F0FF}]/gu;
// 這幾個字元是排版符號，不是 emoji：全形加號、中點、箭頭、單書名號
const ALLOWED = new Set(["＋", "・", "→", "‹", "›", "−"]);

const PAGES = [
  "/", "/transactions", "/transactions/new", "/transactions/transfer", "/transactions/refund",
  "/stats", "/budgets", "/categories", "/accounts", "/settle", "/recurring", "/recurring/new",
  "/goals", "/goals/new", "/tasks", "/tasks/new", "/funds/new", "/activity", "/more",
];

/** 一張最小但合法的 PNG（頭貼上傳用）。 */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(120, 9),
]);

async function emojiOn(page: Page, path: string) {
  await go(page, path);
  const text = await page.locator("body").innerText();
  const found = [...(text.match(EMOJI_RE) ?? [])].filter((ch) => !ALLOWED.has(ch));
  // 圖示一律是 <svg>，emoji 會留在文字節點裡，所以掃文字就抓得到
  return [...new Set(found)];
}

export async function phase4Ui(a: Page, b: Page) {
  // 1. 全站不再有 UI emoji
  const offenders: string[] = [];
  for (const path of PAGES) {
    const found = await emojiOn(a, path);
    if (found.length) offenders.push(`${path}: ${found.join(" ")}`);
  }
  expect(offenders, `這些頁面還有 emoji：\n${offenders.join("\n")}`).toEqual([]);
  step(`${PAGES.length} 個頁面都沒有 UI emoji（圖示全部是 lucide 的 SVG）`);

  // 圖示真的有畫出來（不是把 icon key 當文字印出來）。
  // V4 起圖示改成可替換的 <img src="/assets/icons/<key>.png">，不再是 inline SVG。
  await go(a, "/categories");
  expect(await a.locator("img.art-icon").count()).toBeGreaterThan(5);
  const bad = await a.locator("img.art-icon").evaluateAll((els) =>
    els.filter((e) => !(e as HTMLImageElement).currentSrc.includes("/assets/icons/")).length);
  expect(bad, "每個圖示都要指到 /assets/icons/").toBe(0);
  expect(await pageText(a)).not.toContain("utensils");
  await go(a, "/more");
  expect(await pageText(a)).not.toMatch(/\b(piggy-bank|check-circle|calendar-clock)\b/);
  step("icon key 沒有被當成文字印出來，畫面上是真的 SVG");

  // 2. 金額是最大的視覺層級
  await go(a, "/");
  // 注意：evaluate 裡不要宣告具名函式（tsx 會插入 __name helper，瀏覽器端沒有）
  const sizes = await a.evaluate(() => {
    const amountEl = document.querySelector<HTMLElement>('[data-testid="month-expense"]');
    const h1El = document.querySelector<HTMLElement>("h1");
    return {
      amount: amountEl ? parseFloat(getComputedStyle(amountEl).fontSize) : 0,
      h1: h1El ? parseFloat(getComputedStyle(h1El).fontSize) : 0,
      body: parseFloat(getComputedStyle(document.body).fontSize),
    };
  });
  expect(sizes.amount).toBeGreaterThan(sizes.h1);
  expect(sizes.amount).toBeGreaterThan(sizes.body * 2);
  step(`本月支出 ${Math.round(sizes.amount)}px 比標題 ${Math.round(sizes.h1)}px 還大，金額是主角`);

  // 3. 手帳質感：卡片用「位移的硬陰影」而不是模糊陰影
  const shadow = await a.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".paper");
    return card ? getComputedStyle(card).boxShadow : "";
  });
  const blur = Number(/(?:-?[\d.]+px)\s+(?:-?[\d.]+px)\s+(-?[\d.]+)px/.exec(shadow)?.[1] ?? "99");
  expect(blur, `手帳風要用硬陰影（blur = 0）：${shadow}`).toBe(0);
  const border = await a.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".paper");
    return card ? getComputedStyle(card).borderStyle : "";
  });
  expect(border, "卡片要用虛線邊框").toContain("dashed");
  step("卡片是虛線邊框 + 位移硬陰影的手帳紙");

  // 4. 頭貼
  await go(a, "/more");
  const box = a.getByTestId("avatar-box");
  await expect(box).toBeVisible();
  expect(await box.locator("img").count()).toBe(0);

  await a.locator('input[type="file"][accept*="image"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  const avatar = box.locator("img");
  await expect(avatar).toBeVisible({ timeout: 15000 });
  const shape = await avatar.evaluate((el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { radius: s.borderRadius, fit: s.objectFit, w: Math.round(r.width), h: Math.round(r.height), src: el.getAttribute("src") ?? "" };
  });
  expect(shape.w).toBe(shape.h); // 正方形
  expect(shape.fit).toBe("cover"); // 不會被拉變形
  expect(parseFloat(shape.radius)).toBeGreaterThanOrEqual(shape.w / 2 - 1); // 圓形
  expect(shape.src).toMatch(/^\/api\/files\//);
  await shot(a, "40-avatar");
  step("頭貼上傳後以圓形正方裁切顯示，網址走 /api/files 權限檢查");

  // 另一半看得到
  await go(b, "/more");
  await expect(b.getByTestId("avatar-box")).toBeVisible();
  const partnerImg = b.locator(`img[src="${shape.src}"]`);
  await expect(partnerImg.first()).toBeVisible();
  step("另一半在自己的畫面上看得到我的頭貼");

  // 換一張：網址會變
  await go(a, "/more");
  await a.locator('input[type="file"][accept*="image"]').setInputFiles({ name: "me2.png", mimeType: "image/png", buffer: PNG });
  await expect(a.getByTestId("avatar-box").locator("img")).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => a.getByTestId("avatar-box").locator("img").getAttribute("src"), { timeout: 10000 })
    .not.toBe(shape.src);
  step("換頭貼會換成新的網址（舊的那張已經作廢）");

  // 移除 → 回到預設
  await a.getByTestId("avatar-remove").click();
  await expect(a.getByTestId("avatar-box").locator("img")).toHaveCount(0, { timeout: 15000 });
  await expect(a.getByTestId("avatar-box")).toContainText("小艾");
  step("移除頭貼後回到預設的色塊 + 名字，功能不會壞掉");

  // 5. 320px 不溢出（含頭貼區塊）
  const se = await a.context().browser()!.newContext({ ...devices["iPhone SE"], locale: "zh-TW", timezoneId: "Asia/Taipei", storageState: await a.context().storageState() });
  const small = await se.newPage();
  for (const path of ["/", "/more", "/budgets"]) {
    await go(small, path);
    await loaded(small);
    const { scrollWidth, innerWidth } = await small.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `${path} 在 320px 水平溢出`).toBeLessThanOrEqual(innerWidth + 1);
  }
  await shot(small, "41-avatar-320");
  await se.close();
  step("首頁、更多、預算在 320px 都沒有水平溢出");
}
