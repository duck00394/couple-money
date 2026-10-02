/**
 * V15：帳本系統。
 *
 * 走一遍你規格最後那段「最終 UX」：
 *   原帳本 → 建日本旅遊 → 自動切過去 → 記帳進旅遊帳本 → 旅行中記吉伊卡哇（回原帳本，
 *   但不把帳本切走）→ 結案 → 進歷史紀錄 → 重新開啟。
 *
 * 最重要的兩步：
 *   第 6 步：進購買紀錄再離開，**目前帳本仍然是日本旅遊**（規格點 11）
 *   第 8 步：結案後 UI 真的擋住記帳（server 端已有整合測試，這裡驗畫面）
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, mainText, pageText, shot, step } from "./lib";

/** 原帳本的名字（couple-flow.ts 的 prologue 建立的那本） */
const MAIN_NAME = "艾與本的帳本";


/**
 * 從帳本選單切到某一本，並**等到真的切過去**。
 *
 * 不要用 `waitForURL(/\/$/)` —— 切換後還是停在 `/`，那個等待會立刻通過，
 * 於是後面讀到的還是切換前的畫面（這一支第一版就是這樣誤判的）。
 * 正確的等待條件是「選擇器上的名字變了」。
 */
async function switchTo(p: Page, name: string) {
  await go(p, "/");
  await p.getByTestId("book-switcher").click();
  await p.getByTestId("book-menu").getByText(name, { exact: true }).first().click();
  await expect(p.getByTestId("book-switcher")).toContainText(name, { timeout: 15000 });
  await loaded(p);
}

/** 目前帳本選擇器上顯示的名字 */
const currentBook = async (p: Page) => {
  await go(p, "/");
  return (await p.getByTestId("book-switcher").innerText()).replace(/\s+/g, " ").trim();
};

export async function v15Books(a: Page, b: Page) {
  // ───────── 1. 預設在原帳本 ─────────
  expect(await currentBook(a)).toContain(MAIN_NAME);
  await expect(a.getByTestId("book-switcher")).toBeVisible();
  await shot(a, "v15-01-main");
  step("首頁頂部有帳本選擇器，預設是原帳本");

  // ───────── 2. 展開選單：只有原帳本，沒有「歷史紀錄」區 ─────────
  await a.getByTestId("book-switcher").click();
  await expect(a.getByTestId("book-menu")).toBeVisible();
  const menu1 = (await a.getByTestId("book-menu").innerText()).replace(/\s+/g, " ");
  expect(menu1).toContain(MAIN_NAME);
  expect(menu1, "還沒有結案的帳本，不該出現歷史紀錄區").not.toContain("歷史紀錄");
  expect(menu1).toContain("＋ 新增帳本");
  expect(menu1, "選單不該出現 emoji").not.toMatch(/\p{Extended_Pictographic}/u);
  step("選單列出帳本與「＋新增帳本」；沒有歷史帳本時不顯示歷史區，也沒有 emoji");

  // ───────── 3. 建立日本旅遊 ─────────
  await a.getByTestId("book-new-link").click();
  await a.waitForURL(/\/books\/new$/);
  await loaded(a);
  await a.getByLabel("帳本名稱").fill("日本旅遊");
  await a.getByLabel("旅行地區／幣別").selectOption("JPY");
  // 幣別與匯率在同一頁填完，不用再跑一趟設定頁
  await a.getByLabel("台幣金額").fill("0.215");
  await a.getByRole("button", { name: /建立並切換過去/ }).click();
  await a.waitForURL(/\/$/);
  await loaded(a);
  expect(await currentBook(a), "建立後沒有自動切換過去").toContain("日本旅遊");
  await shot(a, "v15-02-trip");
  step("建立「日本旅遊」（JPY ＋ 1 JPY = 0.215 TWD），建立後直接切換過去（規格點 12）");

  // ───────── 3b. 旅遊帳本首頁只講錢：沒有任務、沒有獎勵 ─────────
  const tripHome = await mainText(a, "/");
  expect(tripHome, "旅遊帳本首頁不該出現今日任務").not.toContain("今日任務");
  expect(tripHome, "旅遊帳本首頁不該出現今日獎勵").not.toContain("今日獎勵");
  expect(tripHome, "旅遊帳本首頁應該以最近紀錄為主").toContain("最近紀錄");
  expect(tripHome, "旅遊帳本首頁不該出現基金").not.toContain("基金");
  expect(tripHome, "旅遊帳本首頁不該出現「可以花的錢」").not.toContain("可以花的錢");
  expect(tripHome, "旅遊帳本首頁應該看得到這趟旅行的匯率").toContain("1 JPY ≈ 0.215 TWD");
  step("旅遊帳本首頁只留記帳相關：沒有任務、獎勵、基金，但有這趟旅行的匯率");

  // ───────── 4. 旅遊帳本是乾淨的：看不到原帳本的交易 ─────────
  const tripFeed = await pageText(a, "/transactions");
  expect(tripFeed, "旅遊帳本混到了原帳本的交易").not.toContain("火鍋");
  step("旅遊帳本看不到原帳本的任何交易");

  // ───────── 5. 快速記帳自動記進旅遊帳本 ─────────
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("2500");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("日本拉麵");
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);
  expect(await pageText(a, "/transactions")).toContain("日本拉麵");
  step("在旅遊帳本按記帳，不用再選帳本，直接記進日本旅遊（規格點 6、23）");

  // 原帳本沒有這筆
  await switchTo(a, MAIN_NAME);
  expect(await currentBook(a)).toContain(MAIN_NAME);
  expect(await pageText(a, "/"), "原帳本的任務區不該被連帶拿掉").toContain("今日任務");
  expect(await pageText(a, "/transactions"), "原帳本看到了旅遊帳本的交易").not.toContain("日本拉麵");
  step("切回原帳本：看不到旅遊帳本的交易，兩邊完全分開（規格點 8）");

  // 切回日本旅遊繼續
  await switchTo(a, "日本旅遊");

  // ───────── 6. ★ 購買紀錄回原帳本，但不把帳本切走 ─────────
  const purchases = await pageText(a, "/purchases");
  expect(purchases, "沒有說明購買紀錄屬於原帳本").toContain("購買紀錄屬於「原帳本」");
  expect(purchases).toContain("日本旅遊"); // 提示裡要講「離開後回到日本旅遊」
  await shot(a, "v15-03-purchases-notice");
  step("旅遊中進購買紀錄：明確顯示「此資料屬於原帳本」（規格點 10）");

  // 離開購買紀錄 → 目前帳本必須還是日本旅遊
  expect(await currentBook(a), "★ 操作購買紀錄把目前帳本切走了（規格點 11）").toContain("日本旅遊");
  step("★ 離開購買紀錄之後，目前帳本仍然是日本旅遊（規格點 11）");

  // ───────── 7. 旅遊帳本的記帳頁沒有「加入購買紀錄」 ─────────
  await go(a, "/transactions/new");
  expect(await pageText(a), "旅遊帳本不該提供加入購買紀錄").not.toContain("同時加入購買紀錄");
  step("旅遊帳本記帳時不提供「同時加入購買紀錄」（避免跨帳本外鍵）");

  // ───────── 8. 結案 ─────────
  await go(a, "/books");
  const books = await pageText(a);
  expect(books).toContain("日本旅遊");
  expect(books).toContain("原帳本");
  await a.getByTestId("close-book").click();
  expect(await pageText(a)).toContain("不會刪除任何資料");
  await a.getByTestId("close-book-confirm").click();
  await a.waitForURL(/\/books/);
  await loaded(a);
  const afterClose = await pageText(a);
  expect(afterClose).toContain("歷史紀錄");
  await shot(a, "v15-04-closed");
  step("結案：確認文字有講「不會刪除任何資料」，之後移到歷史紀錄（規格點 14、15）");

  // 結案後目前帳本自動回原帳本
  expect(await currentBook(a), "結案後應該切回原帳本").toContain(MAIN_NAME);
  step("結案後目前帳本自動切回原帳本（不會停在一本動不了的帳本上）");

  // ───────── 9. 歷史帳本可以看，但不能記帳 ─────────
  await go(a, "/");
  await a.getByTestId("book-switcher").click();
  const menu2 = (await a.getByTestId("book-menu").innerText()).replace(/\s+/g, " ");
  expect(menu2, "歷史紀錄區沒有出現").toContain("歷史紀錄");
  expect(menu2, "選單不該出現 emoji").not.toMatch(/\p{Extended_Pictographic}/u);
  await a.getByTestId("book-menu").getByText("日本旅遊", { exact: true }).first().click();
  await expect(a.getByTestId("book-switcher")).toContainText("日本旅遊", { timeout: 15000 });
  await loaded(a);
  const closedHome = await pageText(a);
  expect(closedHome).toContain("這本帳本已結案");
  step("切進已結案帳本：首頁顯示「這本帳本已結案」並提供重新開啟");

  // 資料還在
  expect(await pageText(a, "/transactions"), "結案後交易不見了").toContain("日本拉麵");
  step("Test 6：歷史帳本的交易與統計完整保留，沒有任何資料被刪除");

  // 記帳頁直接擋住，而且給得出一條路（規格點 18）
  await go(a, "/transactions/new");
  const closedNew = await pageText(a);
  expect(closedNew, "結案帳本的記帳頁沒有說明原因").toContain("這本帳本已結案");
  expect(await a.getByTestId("save-and-done").count(), "結案帳本竟然還給得出記帳表單").toBe(0);
  await expect(a.getByTestId("reopen-book")).toBeVisible();
  step("★ 結案帳本進記帳頁：顯示「這本帳本已結案」＋重新開啟，不給表單（規格點 18）");
  // server 端的擋法另外由整合測試驗（createTransaction / transfer / refund /
  // settlement / createAccount 全部丟 BOOK_READ_ONLY），不是只靠這個畫面。

  // ───────── 10. 重新開啟 ─────────
  await go(a, "/books");
  await a.getByTestId("reopen-book").first().click();
  await a.waitForURL(/\/$/);
  await loaded(a);
  expect(await currentBook(a), "重新開啟沒有自動切換過去").toContain("日本旅遊");
  expect(await pageText(a), "重新開啟後還顯示已結案").not.toContain("這本帳本已結案");
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("800");
  await a.getByRole("button", { name: /餐飲/ }).click();
  await a.getByLabel("名稱（選填）").fill("重新開啟後");
  await a.getByTestId("save-and-done").click();
  await a.waitForURL(/\/$/);
  expect(await pageText(a, "/transactions")).toContain("重新開啟後");
  await shot(a, "v15-05-reopened");
  step("Test 5：重新開啟後自動切換過去，而且可以正常記帳（規格點 17）");

  // ───────── 11. 原帳本不能結案 ─────────
  await switchTo(a, MAIN_NAME);
  await go(a, "/books");
  const mainCard = a.getByTestId("book-card").filter({ hasText: "原帳本" });
  expect(await mainCard.getByTestId("close-book").count(), "Test 7：原帳本竟然有結案按鈕").toBe(0);
  step("Test 7：原帳本沒有結案按鈕（server 端也擋，見整合測試）");

  // ───────── 12. 另一半自動是旅遊帳本的成員 ─────────
  await go(b, "/");
  await b.getByTestId("book-switcher").click();
  expect((await b.getByTestId("book-menu").innerText()).replace(/\s+/g, " "), "另一半看不到旅遊帳本").toContain("日本旅遊");
  step("另一半不用重新被邀請，自動就是旅遊帳本的成員");
}
