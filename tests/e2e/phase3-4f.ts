/**
 * Phase 3-4 F：批次操作（改分類／加標籤／刪除）。
 * 前提：Phase 1～3-4 B 的流程已經跑完，帳本裡已經有各種類型的紀錄。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

const boxOf = (p: Page, title: string) => p.getByRole("checkbox", { name: `選取 ${title}` });
const rowOf = (p: Page, title: string) => p.getByTestId("tx-row").filter({ hasText: title });

async function addExpense(p: Page, title: string, amount: string, category: RegExp) {
  await go(p, "/transactions/new");
  await p.getByLabel("金額").fill(amount);
  await p.getByLabel("名稱（選填）").fill(title);
  await p.getByRole("button", { name: category }).click();
  await p.getByRole("button", { name: "記下來" }).click();
  await p.waitForURL(/\/$/);
}

/** 進入選取模式（每次換頁後都要重新進入，因為選取狀態不會留下來）。 */
async function selectMode(p: Page, query: string) {
  await go(p, query);
  await p.getByTestId("batch-toggle").click();
}

/** confirm() 對話框由 couple-flow.ts 統一自動按「確定」。 */
export async function phase3Batch(a: Page, b: Page) {
  {
    // 1. 準備三筆同樣前綴的消費
    for (const [title, amount] of [["批次-早餐", "120"], ["批次-午餐", "240"], ["批次-晚餐", "360"]] as const) {
      await addExpense(a, title, amount, /餐飲/);
    }
    await go(a, "/transactions?q=批次-");
    await expect(a.getByTestId("tx-row")).toHaveCount(3);
    step("準備三筆「批次-」開頭的消費，搜尋得到");

    // 2. 預設沒有選取框；按「選取多筆」才出現
    await expect(a.getByTestId("batch-checkbox")).toHaveCount(0);
    await expect(a.getByTestId("batch-bar")).toHaveCount(0);
    await a.getByTestId("batch-toggle").click();
    await expect(a.getByTestId("batch-checkbox")).toHaveCount(3);
    expect(await pageText(a)).toContain("一次最多 50 筆");
    // 只是進入選取模式、還沒勾任何一筆時，不會出現操作列（不會把「搜尋結果全部」當成已選）
    await expect(a.getByTestId("batch-bar")).toHaveCount(0);
    step("搜尋結果上按「選取多筆」才出現選取框；沒勾任何一筆就沒有操作列");

    // 3. 勾兩筆 → 操作列顯示「已選 2 筆」
    await boxOf(a, "批次-早餐").check();
    await boxOf(a, "批次-午餐").check();
    await expect(a.getByTestId("batch-count")).toHaveText("已選 2 筆");
    await shot(a, "30-batch-selected");
    step("勾選兩筆之後出現操作列與「已選 2 筆」");

    // 4. 重新整理：選取狀態不會殘留
    await go(a, "/transactions?q=批次-");
    await expect(a.getByTestId("batch-bar")).toHaveCount(0);
    await expect(a.getByTestId("batch-checkbox")).toHaveCount(0);
    step("重新整理後選取狀態自動清空，不會誤操作到上一次勾的紀錄");

    // 5. 批次改分類：只有勾到的兩筆會變
    await a.getByTestId("batch-toggle").click();
    await boxOf(a, "批次-早餐").check();
    await boxOf(a, "批次-午餐").check();
    await a.getByRole("button", { name: "改分類" }).click();
    const value = await a.evaluate(() => {
      const sel = document.querySelector('select[aria-label="批次改成的分類"]') as HTMLSelectElement;
      return [...sel.options].find((o) => (o.textContent ?? "").includes("娛樂"))!.value;
    });
    await a.getByLabel("批次改成的分類").selectOption(value);
    await a.getByRole("button", { name: "套用" }).click();
    await expect(a.getByTestId("toast")).toContainText("已改好 2 筆的分類");
    await expect(a.getByTestId("batch-bar")).toHaveCount(0);
    await expect(a.getByTestId("batch-checkbox")).toHaveCount(0);
    step("批次改分類成功後出現提示，選取狀態與選取模式都自動結束");

    // 6. 確認真的只改了勾到的那兩筆（而且金額沒變）
    const ring = async (title: string, cat: string) => {
      await go(a, "/transactions?q=批次-");
      await rowOf(a, title).first().click();
      await a.waitForURL(/\/transactions\/[\w-]+$/);
      await loaded(a);
      await expect(a.getByRole("button", { name: new RegExp(cat) })).toHaveClass(/ring-brand-500/);
    };
    await ring("批次-早餐", "娛樂");
    await ring("批次-晚餐", "餐飲");
    await go(a, "/transactions?q=批次-");
    const listed = await pageText(a);
    expect(listed).toContain("$120");
    expect(listed).toContain("$360");
    step("只有勾到的兩筆換了分類，沒勾的那筆與所有金額都沒被動到");

    // 7. 批次加標籤（原本的標籤會保留、搜尋得到）
    await selectMode(a, "/transactions?q=批次-");
    await boxOf(a, "批次-早餐").check();
    await boxOf(a, "批次-晚餐").check();
    await a.getByRole("button", { name: "加標籤" }).click();
    await a.getByLabel("要加上的標籤").fill("#批次測試");
    await a.getByRole("button", { name: "加上" }).click();
    await expect(a.getByTestId("toast")).toContainText("已為 2 筆加上標籤");
    await go(a, "/transactions?tag=批次測試");
    await expect(a.getByTestId("tx-row")).toHaveCount(2);
    const tagged = await pageText(a);
    expect(tagged).toContain("批次-早餐");
    expect(tagged).toContain("批次-晚餐");
    expect(tagged).not.toContain("批次-午餐");
    step("批次加標籤之後，用 #批次測試 搜尋剛好找到那兩筆");

    // 8. 期初餘額（與餘額調整同一條規則）不能批次刪除，而且整批都不會動
    await selectMode(a, "/transactions?kind=OPENING_BALANCE");
    const openings = await a.getByTestId("tx-row").count();
    expect(openings).toBeGreaterThan(0);
    await a.getByTestId("batch-checkbox").first().locator("input").check();
    await a.getByTestId("batch-delete").click();
    const alert = a.getByTestId("batch-bar").locator("p[role=alert]");
    await expect(alert).toContainText("不能刪除");
    await expect(alert).toContainText("整批都沒有刪除");
    await shot(a, "31-batch-blocked");
    await go(a, "/transactions?kind=OPENING_BALANCE");
    await expect(a.getByTestId("tx-row")).toHaveCount(openings);
    step("期初餘額與餘額調整不能透過批次刪除，錯誤顯示在操作列上，紀錄一筆都沒少");

    // 9. 批次刪除成功：只有勾到的不見，沒勾的還在
    await selectMode(a, "/transactions?q=批次-");
    await boxOf(a, "批次-早餐").check();
    await boxOf(a, "批次-晚餐").check();
    await a.getByTestId("batch-delete").click();
    await expect(a.getByTestId("toast")).toContainText("已刪除 2 筆");
    await go(a, "/transactions?q=批次-");
    await expect(a.getByTestId("tx-row")).toHaveCount(1);
    expect(await pageText(a)).toContain("批次-午餐");
    step("批次刪除只刪勾到的兩筆，沒勾的「批次-午餐」還在");

    // 10. 另一半看得到結果，也在最近動態看得到批次操作
    await go(b, "/transactions?q=批次-");
    const hers = await pageText(b);
    expect(hers).toContain("批次-午餐");
    expect(hers).not.toContain("批次-早餐");
    await go(b, "/activity");
    expect(await pageText(b)).toMatch(/批次/);
    step("另一半看到的是同一份結果，動態也記得住批次操作");

    // 11. 手機版面
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 664 }]) {
      await a.setViewportSize(size);
      await selectMode(a, "/transactions?q=批次-");
      await boxOf(a, "批次-午餐").check();
      await expect(a.getByTestId("batch-count")).toBeVisible();
      await expect(a.getByTestId("batch-delete")).toBeVisible();
      const o = await a.evaluate(() => ({ w: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(o.w, `${size.width}px 不該水平溢出`).toBeLessThanOrEqual(o.inner + 1);
      if (size.width === 320) await shot(a, "32-batch-320");
    }
    await a.setViewportSize({ width: 390, height: 664 });
    step("批次操作列在 320px 與 390px 都不破版，按鈕都點得到");
  }
}
