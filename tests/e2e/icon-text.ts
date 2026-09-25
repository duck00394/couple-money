/**
 * 全站掃描：任何「應該是圖示」的位置都不可以把 icon key 當文字印出來。
 *
 * 圖示是 <img src="/assets/icons/<key>.png">，所以只要有人寫成 {task.emoji}、
 * {ACCOUNT_TYPE_ICON[a.type]}、<option>{k}</option>，畫面上就會出現
 * 「wallet」「check-circle」「Utensils」這種技術字串，而且不會有任何編譯錯誤。
 * 這支就是用真的瀏覽器把每一頁的可見文字掃過一遍，抓這件事。
 */
import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { go, loaded, step } from "./lib";

/** 從 src/lib/icons.ts 直接讀出所有 key 與 lucide 元件名，不用手動維護清單。 */
function iconVocabulary() {
  const src = readFileSync(resolve(import.meta.dirname, "../../src/lib/icons.ts"), "utf8");
  const start = src.indexOf("export const ICONS = {");
  const body = src.slice(start, src.indexOf("\n};", start));
  const pairs = [...body.matchAll(/^\s*"?([a-zA-Z][\w-]*)"?\s*:\s*([A-Za-z0-9_]+)/gm)];
  return {
    keys: [...new Set(pairs.map((m) => m[1]))],
    components: [...new Set(pairs.map((m) => m[2]))],
  };
}

/**
 * 有些 icon key 剛好是正常的英文單字，可能合法地出現在使用者輸入的名稱或備註裡
 * （例如帳戶取名 "coffee"）。測試資料不會用這些字，所以照掃；真的誤判時再加進來。
 */
const IGNORE = new Set<string>([]);

const PAGES = [
  "/", "/transactions", "/transactions/new", "/transactions/transfer", "/transactions/refund",
  "/stats", "/budgets", "/categories", "/accounts", "/settle", "/recurring", "/recurring/new",
  "/goals", "/goals/new", "/funds", "/funds/new", "/tasks", "/tasks/new", "/activity", "/more",
];

export async function iconText(a: Page) {
  const { keys, components } = iconVocabulary();
  // 整字比對：「wallet」要抓，但「wallet-ish名稱裡的 wallet」不抓
  const vocab = [...keys, ...components].filter((w) => !IGNORE.has(w));
  const pattern = new RegExp(`(?<![\\w-])(${vocab.map((w) => w.replace(/[-]/g, "\\-")).join("|")})(?![\\w-])`, "g");

  const offenders: string[] = [];
  for (const path of PAGES) {
    await go(a, path);
    await loaded(a);
    const text = await a.locator("body").innerText();
    const found = [...new Set([...text.matchAll(pattern)].map((m) => m[1]))];
    if (found.length) offenders.push(`${path}: ${found.join(" ")}`);
  }
  expect(offenders, `這些頁面把 icon key 當文字印出來：\n${offenders.join("\n")}`).toEqual([]);
  step(`${PAGES.length} 個頁面都沒有把 icon key 印成文字（${vocab.length} 個字彙全掃過）`);

  // 選單類的控制項也要掃：<select> 的選項文字不會出現在 innerText 裡
  for (const path of ["/tasks/new", "/funds/new", "/categories", "/transactions/new"]) {
    await go(a, path);
    await loaded(a);
    const bad = await a.locator("option").evaluateAll(
      (els, words) => els.map((e) => e.textContent ?? "").filter((t) => words.includes(t.trim())),
      vocab,
    );
    expect(bad, `${path} 的下拉選項直接顯示 icon key：${bad.join(" ")}`).toEqual([]);
  }
  step("下拉選單的選項也沒有把 icon key 當成選項文字");

  // 詳細頁不在固定網址清單裡，所以從列表點進去一筆再掃一次
  const details: Array<[string, string]> = [
    ["/transactions", "紀錄詳細"],
    ["/tasks", ""],
    ["/funds", ""],
  ];
  for (const [listPath] of details) {
    await go(a, listPath);
    await loaded(a);
    const first = a.locator(`a[href^="${listPath === "/tasks" ? "/tasks/" : listPath === "/funds" ? "/funds/" : "/transactions/"}"]`)
      .filter({ hasNotText: "新" }).first();
    if (await first.count() === 0) continue;
    await first.click();
    await loaded(a);
    const text = await a.locator("body").innerText();
    const found = [...new Set([...text.matchAll(pattern)].map((m) => m[1]))];
    expect(found, `${listPath} 的詳細頁把 icon key 當文字印出來：${found.join(" ")}`).toEqual([]);
  }
  step("記帳、任務、基金的詳細頁也沒有把 icon key 印成文字");

  // 每一張圖示都真的載入得到（載不到會是空白格，使用者看到的就是「圖不見了」）
  for (const path of ["/", "/tasks", "/categories", "/accounts", "/more", "/funds"]) {
    await go(a, path);
    await loaded(a);
    const broken = await a.locator("img.art-icon").evaluateAll((els) =>
      els.filter((e) => {
        const img = e as HTMLImageElement;
        return !img.complete || img.naturalWidth === 0;
      }).map((e) => (e as HTMLImageElement).getAttribute("src") ?? "?"),
    );
    expect([...new Set(broken)], `${path} 有載不到的圖示`).toEqual([]);
  }
  step("首頁、任務、分類、帳戶、更多、基金的圖示都真的載得到，沒有破圖");
}
