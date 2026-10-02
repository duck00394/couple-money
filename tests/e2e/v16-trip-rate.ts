/**
 * V16：旅遊帳本的匯率就在首頁。
 *
 * 這一支走的是規格裡那個情境，整段只有「看一眼匯率、記一筆」兩件事：
 *
 *   在韓國打開 App → 首頁就看到「1 KRW ≈ 0.023 TWD」→ 按記一筆 → 輸入 ₩30,000
 *   → 立刻看到「約 NT$690」→ 存起來。
 *
 * 全程不用進設定頁、不用選幣別、不用自己算。
 *
 * 另外三件要守住的事：
 *   * 原帳本（台幣）首頁完全沒有匯率 UI（規格點 10）
 *   * 韓國帳本只出現 KRW 與 TWD，不會冒出 USD / EUR / JPY 那一長串（規格點 12）
 *   * 改韓國的匯率不會動到日本帳本（規格點 11）
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, mainText, pageText, shot, step } from "./lib";

const MAIN_NAME = "艾與本的帳本";
/** v15 留下來的那本日圓帳本 */
const JP_NAME = "日本旅遊";
/** 這本旅遊帳本用不到、也不該出現在畫面上的幣別 */
const OTHERS = ["USD", "EUR", "GBP", "HKD", "SGD", "THB", "CNY"];

async function switchTo(p: Page, name: string) {
  await go(p, "/");
  await p.getByTestId("book-switcher").click();
  await p.getByTestId("book-menu").getByText(name, { exact: true }).first().click();
  await expect(p.getByTestId("book-switcher")).toContainText(name, { timeout: 15000 });
  await loaded(p);
}

export async function v16TripRate(a: Page, b: Page) {
  // ───────── 1. 原帳本：首頁一個匯率字都沒有 ─────────
  await switchTo(a, MAIN_NAME);
  const mainHome = await mainText(a, "/");
  // 用元素判斷而不是整頁文字 —— 文字裡可能剛好有一筆交易叫「改匯率後的日本午餐」
  expect(await a.getByTestId("home-rate").count(), "原帳本首頁不該有匯率卡").toBe(0);
  expect(await a.getByTestId("home-rate-label").count(), "原帳本首頁不該有匯率那一行").toBe(0);
  expect(await a.getByTestId("edit-home-rate").count(), "原帳本首頁不該有「修改匯率」").toBe(0);
  expect(mainHome, "原帳本首頁維持原本的樣子").toContain("今日任務");
  expect(mainHome, "原帳本首頁維持原本的樣子").toContain("基金");
  await shot(a, "v16-01-main-no-rate");
  step("規格點 10：原帳本（台幣）首頁完全沒有多出匯率 UI");

  // ───────── 2. 建立韓國旅遊：幣別與匯率在同一頁填完 ─────────
  await go(a, "/books/new");
  await a.getByLabel("帳本名稱").fill("韓國旅遊");
  await a.getByLabel("旅行地區／幣別").selectOption("KRW");
  await a.getByLabel("台幣金額").fill("0.023");
  // 一邊打就一邊把那句話寫出來，確認方向沒填反
  await expect(a.getByTestId("new-book-rate-preview")).toHaveText("1 KRW ≈ 0.023 TWD");
  await shot(a, "v16-02-new-book");
  await a.getByRole("button", { name: /建立並切換過去/ }).click();
  await a.waitForURL(/\/$/);
  await loaded(a);
  step("規格點 3：建立旅遊帳本時就選幣別、填匯率，建好直接進旅遊帳本首頁");

  // ───────── 3. ★ 匯率就在首頁，而且只有這次旅行的幣別 ─────────
  await expect(a.getByTestId("home-rate-label")).toHaveText("1 KRW ≈ 0.023 TWD");
  const krHome = await mainText(a, "/");
  for (const code of OTHERS) {
    expect(krHome, `韓國旅遊首頁冒出了 ${code}`).not.toContain(code);
  }
  expect(krHome, "韓國旅遊首頁出現了日圓").not.toContain("JPY");
  expect(krHome, "旅遊帳本首頁不該有任務").not.toContain("今日任務");
  expect(krHome, "旅遊帳本首頁不該有基金").not.toContain("基金");
  await shot(a, "v16-03-trip-home");
  step("★ 規格點 1、5、12：匯率直接在首頁，而且只有 KRW ↔ TWD 兩個幣別");

  // ───────── 4. 記一筆：不用選幣別，金額下面立刻出現台幣 ─────────
  await go(a, "/transactions/new");
  expect(await a.getByTestId("tx-currency").count(), "規格點 8：旅遊帳本記帳不該還要選幣別").toBe(0);
  await a.getByLabel("金額").fill("30000");
  await expect(a.getByTestId("tx-home-approx"), "記帳時沒有立即換算").toContainText("NT$690");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("韓國烤肉");
  await shot(a, "v16-04-record");
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);
  expect(await pageText(a, "/transactions"), "列表沒有那筆韓元消費").toContain("₩30,000");
  step("★ 規格點 7、15：輸入 ₩30,000 立刻看到「約 NT$690」，存完就回首頁");

  // ───────── 5. ★ 就地改匯率，不用進設定頁 ─────────
  await go(a, "/");
  await a.getByTestId("edit-home-rate").click();
  await a.getByLabel("1 KRW 等於多少台幣").fill("0.025");
  await a.getByRole("button", { name: "儲存" }).click();
  await expect(a.getByTestId("home-rate-label"), "首頁改匯率沒有生效").toHaveText("1 KRW ≈ 0.025 TWD", {
    timeout: 15000,
  });
  // 名稱、日期這些不會因為只送一個欄位就被清掉
  await expect(a.getByTestId("book-switcher")).toContainText("韓國旅遊");
  await shot(a, "v16-05-edit-rate");
  step("★ 規格點 6：首頁點「修改匯率」就地改完，不用進任何設定頁");

  // ───────── 6. ★ 已經記過的那筆完全不動（規格點 9） ─────────
  expect(await pageText(a, "/transactions"), "改匯率把已經記過的金額改掉了").toContain("₩30,000");
  // 台幣參考值也不能被現在的匯率重算：0.023 當初換出來的是 NT$690，不是 0.025 的 NT$750
  await go(a, "/");
  await expect(a.getByTestId("month-expense")).toHaveText("₩30,000");
  await expect(a.getByTestId("month-expense-home"), "★ 舊交易的台幣參考值被現在的匯率重算了").toHaveText(
    "約 NT$690",
  );
  step("★ 規格點 9：改匯率之後，舊那筆仍然是 ₩30,000／約 NT$690（不是 NT$750）");

  // ───────── 6b. 新交易才用新匯率 ─────────
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("30000");
  await expect(a.getByTestId("tx-home-approx")).toContainText("NT$750");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("改匯率後的韓國烤肉");
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);
  await loaded(a);
  step("改匯率之後新記的 ₩30,000 用新匯率：約 NT$750");

  // ───────── 6c. ★ 總額是兩筆各自換算再加總 ─────────
  await expect(a.getByTestId("month-expense")).toHaveText("₩60,000");
  // NT$690（＠0.023）＋ NT$750（＠0.025）= NT$1,440；用現在的匯率一次換算會是 NT$1,500
  await expect(a.getByTestId("month-expense-home"), "★ 台幣參考總額被現在的匯率重算了").toHaveText("約 NT$1,440");
  await shot(a, "v16-07-locked-total");
  const statsText = await mainText(a, "/stats");
  expect(statsText, "統計頁的正式金額應該是韓元").toContain("₩60,000");
  await expect(a.getByTestId("stats-net-home"), "★ 統計頁的台幣參考總額被重算了").toHaveText("約 NT$1,440");
  step("★ 規格點 10：₩30,000＠0.023 ＋ ₩30,000＠0.025 = 約 NT$1,440，不是用現在的匯率算的 NT$1,500");

  // ───────── 6d. 明細頁看得到那一筆當時的匯率 ─────────
  await go(a, "/transactions");
  await a.getByText("韓國烤肉", { exact: true }).first().click();
  await a.waitForURL(/\/transactions\/[^/]+$/);
  await loaded(a);
  await expect(a.getByTestId("tx-home"), "明細頁的台幣參考值被重算了").toHaveText("約 NT$690");
  await expect(a.getByTestId("tx-home-rate")).toHaveText("交易時匯率 1 KRW = 0.023 TWD");
  await shot(a, "v16-08-tx-detail");
  step("明細頁：¥ 原幣是主角，底下寫出「約 NT$690」與「交易時匯率 1 KRW = 0.023 TWD」");

  // ───────── 7. ★ 日本帳本的匯率完全沒被動到 ─────────
  await switchTo(a, JP_NAME);
  await expect(a.getByTestId("home-rate-label"), "★ 改韓國的匯率把日本帳本也改掉了").toHaveText(
    "1 JPY ≈ 0.215 TWD",
  );
  const jpHome = await mainText(a, "/");
  expect(jpHome, "日本旅遊首頁冒出了韓元").not.toContain("KRW");
  expect(jpHome, "日本旅遊首頁冒出了那筆韓國消費").not.toContain("韓國烤肉");
  await shot(a, "v16-06-jp-home");
  step("★ 規格點 11：兩本旅遊帳本各自保存自己的匯率，互不影響");

  // ───────── 8. 旅遊帳本的匯率頁也只有一種幣別 ─────────
  const ratesPage = await mainText(a, "/rates");
  expect(await a.getByTestId("rate-row").count(), "規格點 12：旅遊帳本不該列出一整排幣別").toBe(0);
  await expect(a.getByTestId("home-rate")).toBeVisible();
  for (const code of OTHERS) expect(ratesPage, `匯率頁冒出了 ${code}`).not.toContain(code);
  step("規格點 12：旅遊帳本的匯率頁只有「1 JPY = ? TWD」一張卡，沒有九種幣別的設定表");

  // ───────── 9. 另一半看到同一個匯率 ─────────
  await switchTo(b, "韓國旅遊");
  await expect(b.getByTestId("home-rate-label"), "另一半看到的匯率不一樣").toHaveText("1 KRW ≈ 0.025 TWD");
  step("另一半不用重新設定，看到的是同一個匯率");

  // ───────── 10. 原帳本的匯率頁維持原本的多幣別設定（在台灣記外幣消費用） ─────────
  await switchTo(a, MAIN_NAME);
  await go(a, "/rates");
  expect(await a.getByTestId("rate-row").count(), "原帳本的匯率設定被一起拿掉了").toBeGreaterThan(5);
  expect(await a.getByTestId("home-rate").count(), "原帳本不需要「換回台幣」那張卡").toBe(0);
  step("原帳本的「幣別與匯率」沒有被動到：在台灣記一筆外幣消費還是設定得了");

  // 收尾：留在原帳本，不影響後面的階段
  await switchTo(a, MAIN_NAME);
}
