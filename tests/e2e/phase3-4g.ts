/**
 * Phase 3-4 G：CSV 匯出（兩支手機）。
 * 前提：Phase 1～3-4 E 的流程已經跑完，帳本裡有各種類型的紀錄。
 */
import { expect, type Page } from "@playwright/test";
import { go, pageText, shot, step } from "./lib";

const BOM = "﻿";

/** 很小的 CSV 解析（引號內的逗號與換行要正確處理）。 */
function parseCsv(csv: string): string[][] {
  const text = csv.startsWith(BOM) ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const asObjects = (csv: string) => {
  const [headers, ...body] = parseCsv(csv);
  return body.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])) as Record<string, string>);
};

export async function phase3Export(a: Page, b: Page) {
  const origin = new URL(a.url()).origin;

  // 1. 記帳頁看得到匯出入口
  await go(a, "/transactions");
  await expect(a.getByTestId("export-all")).toBeVisible();
  await shot(a, "20-export-link");
  step("記帳頁有「⤓ 匯出 CSV」");

  // 2. 下載全部：檔名、編碼、標題列
  const all = await a.request.get(`${origin}/api/export/transactions`);
  expect(all.status()).toBe(200);
  expect(all.headers()["content-type"]).toContain("text/csv");
  expect(all.headers()["content-disposition"]).toContain("attachment");
  expect(all.headers()["content-disposition"]).toContain(".csv");
  const csv = await all.text();
  expect(csv.startsWith(BOM), "要有 UTF-8 BOM，Excel 才不會亂碼").toBe(true);
  const rows = asObjects(csv);
  expect(rows.length).toBeGreaterThan(5);
  const headers = parseCsv(csv)[0];
  for (const h of ["交易ID", "日期", "類型", "算收支", "金額", "收支金額", "分類", "名稱", "備註", "付款帳戶", "收據張數"]) {
    expect(headers, `缺少欄位 ${h}`).toContain(h);
  }
  // 中文沒有亂碼
  expect(csv).toContain("火鍋");
  expect(headers.join(",")).toContain("付款");
  step(`匯出全部：${rows.length} 列、有 BOM、標題與中文都正常`);

  // 3. 數字適合試算表：沒有 $ 與千分位，金額固定兩位小數
  for (const r of rows) {
    expect(r["金額"], `金額格式：${r["金額"]}`).toMatch(/^-?\d+\.\d{2}$/);
    expect(r["收支金額"]).toMatch(/^-?\d+\.\d{2}$/);
    expect(r["日期"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
  expect(csv).not.toContain("$");
  // 支出是負的、收入是正的
  const expense = rows.find((r) => r["類型"] === "支出")!;
  expect(Number(expense["收支金額"])).toBeLessThan(0);
  const income = rows.find((r) => r["類型"] === "收入");
  if (income) expect(Number(income["收支金額"])).toBeGreaterThan(0);
  // 不算收支的類型一律 0
  for (const r of rows.filter((x) => x["算收支"] === "否")) expect(Number(r["收支金額"])).toBe(0);
  step("金額是純數字、兩位小數，支出為負、收入為正，轉帳／結算／調整為 0");

  // 4. 餘額調整看得出來
  const adjust = rows.find((r) => r["類型"] === "餘額調整");
  if (adjust) {
    expect(adjust["算收支"]).toBe("否");
    expect(adjust["分類"]).toBe("");
    step("餘額調整在 CSV 裡看得出來，且不算收支");
  }

  // 5. 依篩選匯出：筆數與畫面一致
  await go(a, "/transactions?q=火鍋");
  await expect(a.getByTestId("export-filtered")).toBeVisible();
  const shown = Number((await a.getByTestId("search-totals").innerText()).match(/(\d+)\s*筆/)![1]);
  const link = (await a.getByTestId("export-filtered").getAttribute("href"))!;
  expect(link).toContain("q=");
  const filtered = asObjects(await (await a.request.get(`${origin}${link}`)).text());
  expect(filtered.length).toBe(shown);
  expect(filtered.every((r) => JSON.stringify(r).includes("火鍋"))).toBe(true);
  expect(await pageText(a)).toContain(`把這 ${shown} 筆匯出成 CSV`);
  step(`依搜尋條件匯出：畫面顯示 ${shown} 筆，CSV 也是 ${shown} 列`);

  // 6. 日期區間（與 /stats 同一套日期邏輯）
  const month = (await a.request.get(`${origin}/api/export/transactions?from=2026-09-01&to=2026-09-30`)).text();
  const monthRows = asObjects(await month);
  expect(monthRows.every((r) => r["日期"] >= "2026-09-01" && r["日期"] <= "2026-09-30")).toBe(true);
  step("日期區間匯出只含區間內的紀錄");

  // 7. 空結果只有標題列
  const empty = await (await a.request.get(`${origin}/api/export/transactions?q=這個字串不存在xyz`)).text();
  expect(asObjects(empty).length).toBe(0);
  expect(empty.startsWith(BOM)).toBe(true);
  step("查無資料時只有標題列，不會壞掉");

  // 8. 另一半匯出的是同一個帳本
  const partner = asObjects(await (await b.request.get(`${origin}/api/export/transactions`)).text());
  expect(partner.length).toBe(rows.length);
  step("阿本匯出的是同一個帳本的同一批資料");

  // 9. 沒登入拿不到；別的帳本拿不到我們的資料
  const browser = a.context().browser()!;
  const anon = await browser.newContext();
  expect((await anon.request.get(`${origin}/api/export/transactions`)).status()).toBe(401);
  await anon.close();

  const outsider = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const c = await outsider.newPage();
  await go(c, "/register");
  await c.getByLabel("暱稱").fill("路人戊");
  await c.getByLabel("Email").fill(`outsider36-${Date.now().toString(36)}@example.com`);
  await c.getByLabel("密碼").fill("password123");
  await c.getByRole("button", { name: "建立帳號" }).click();
  await c.waitForURL(/\/onboarding/);
  await c.getByLabel("帳本名稱").fill("路人戊的帳本");
  await c.getByRole("button", { name: "建立帳本" }).click();
  await c.waitForURL(/\/more/);
  const theirs = await (await c.request.get(`${origin}/api/export/transactions`)).text();
  for (const secret of ["火鍋", "玉山卡", "小艾銀行", "日本旅遊"]) expect(theirs).not.toContain(secret);
  // 就算把我們的帳戶 id 塞進網址也拿不到
  const spoof = await (await c.request.get(`${origin}/api/export/transactions?account=${rows[0]["交易ID"]}`)).text();
  expect(spoof).not.toContain("火鍋");
  await outsider.close();
  step("沒登入回 401；別的帳本匯出不到我們的任何資料（即使塞我們的 id）");

  // 10. 匯出不會改動任何資料
  await go(a, "/");
  const homeBefore = await pageText(a);
  await a.request.get(`${origin}/api/export/transactions`);
  await go(a, "/");
  expect(await pageText(a)).toBe(homeBefore);
  step("匯出之後首頁數字完全沒變");
}
