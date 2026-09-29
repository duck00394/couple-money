/**
 * V8：預購的「誰付多少」與「明細品項」。
 *
 * 前提：Phase 1～V7 已跑完，兩人帳號延續使用。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

export async function v8PreorderSplitItems(a: Page, b: Page) {
  // ───────────── 明細品項 ─────────────
  await go(a, "/preorders/new");
  await a.getByLabel("品名").fill("V8 開學裝備");
  await a.getByLabel("運費（選填）").fill("150");

  // 沒有品項時，商品金額是自己填的
  await expect(a.getByTestId("preorder-items")).toContainText("加了品項之後");
  await a.getByTestId("add-item").click();
  await a.getByLabel("品項 1 名稱").fill("主機");
  await a.getByLabel("品項 1 單價").fill("12000");
  await a.getByLabel("品項 1 誰的").selectOption({ label: "共同" });

  await a.getByTestId("add-item").click();
  await a.getByLabel("品項 2 名稱").fill("保護貼");
  await a.getByLabel("品項 2 單價").fill("150");
  await a.getByLabel("品項 2 數量").fill("2");
  await a.getByLabel("品項 2 誰的").selectOption({ label: "小艾" });

  // 商品金額自動變成品項加總，而且不能手動改
  await expect(a.getByLabel("商品金額")).toHaveValue("12300");
  await expect(a.getByLabel("商品金額")).toHaveAttribute("readonly", "");
  await expect(a.getByTestId("preorder-items")).toContainText("品項合計 $12,300");
  await expect(a.getByText(/應付總額/)).toContainText("$12,450");
  step("明細品項：主機 $12,000 + 保護貼 $150×2 = $12,300，商品金額自動加總（含運費 $12,450）");

  // ───────────── 誰付多少 ─────────────
  const split = a.getByTestId("preorder-split");
  await expect(split).toBeVisible();
  // 預設「依誰的」：這張是我的 → 全部算我的
  await expect(split.getByRole("button", { name: "依「誰的」" })).toBeVisible();

  await split.getByRole("button", { name: "平分" }).click();
  await expect(a.getByTestId("preorder-due-preview")).toContainText("$6,225");
  step("誰付多少：切到「平分」→ 兩個人各 $6,225");

  await split.getByRole("button", { name: "比例" }).click();
  await a.getByLabel("比例").fill("70");
  await expect(a.getByTestId("preorder-due-preview")).toContainText("$8,715");
  await expect(a.getByTestId("preorder-due-preview")).toContainText("$3,735");
  step("切到「比例」70% → $8,715 / $3,735，不再是一人一半");

  // 依明細品項自動帶入金額
  await split.getByRole("button", { name: "金額", exact: true }).click();
  await a.getByTestId("fill-from-items").click();
  // 主機 12,000 共同 + 運費 150 共同 → 各 6,075；保護貼 300 是小艾的
  await expect(a.getByLabel("小艾 負擔金額")).toHaveValue("6375");
  await expect(a.getByLabel("阿本 負擔金額")).toHaveValue("6075");
  await shot(a, "v8-01-preorder-form");
  step("「依明細品項的『誰的』自動帶入金額」：小艾 $6,375（含自己的保護貼）、阿本 $6,075");

  await a.getByRole("button", { name: "建立預購" }).click();
  await a.waitForURL(/\/preorders\/(?!new$)[^/]+$/);
  await loaded(a);
  const poId = a.url().split("/").pop()!;

  // ───────────── 詳細頁 ─────────────
  await expect(a.getByTestId("preorder-item-list")).toContainText("主機");
  await expect(a.getByTestId("preorder-item-list")).toContainText("保護貼");
  await expect(a.getByTestId("preorder-item-list")).toContainText("×2");
  const shares = a.getByTestId("preorder-shares");
  await expect(shares).toContainText("依這張單設定的「誰付多少」");
  await expect(shares).toContainText("$6,375");
  await expect(shares).toContainText("$6,075");
  await shot(a, "v8-02-preorder-detail");
  step("詳細頁看得到明細品項，「每個人還需付」用的是自己設定的金額而不是一人一半");

  // ───────────── 依預購分法付款 ─────────────
  await a.getByLabel("付款金額").fill("2000");
  await a.getByRole("button", { name: "依預購分法", exact: true }).click();
  await a.getByRole("button", { name: "記錄這次付款" }).click();
  await expect(a.getByTestId("preorder-paid")).toHaveText("$2,000", { timeout: 10000 });
  // $2,000 依 6,375 : 6,075 的比例分 → 已負擔 $1,024 / $976
  await expect(shares).toContainText("已負擔 $1,024");
  await expect(shares).toContainText("已負擔 $976");
  await expect(shares).toContainText("$5,351"); // 6,375 − 1,024
  await expect(shares).toContainText("$5,099"); // 6,075 − 976
  step("付款可以「依預購分法」分攤：$2,000 按 $6,375:$6,075 的比例分給兩個人，而不是各半");

  // 兩個人的「還需付」加起來 = 待付
  const remainAfter = await a.getByTestId("preorder-remaining").innerText();
  expect(remainAfter).toBe("$10,450");
  step("已付 $2,000、待付 $10,450，數字對得起來");

  // ───────────── 記帳頁的面板也吃同一套規則 ─────────────
  await go(a, "/transactions/new");
  await a.getByTestId("preorder-select").selectOption(poId);
  await a.getByLabel("金額").fill("1000");
  await a.getByRole("button", { name: /餐飲/ }).click();
  const panel = a.getByTestId("preorder-hint-form");
  await expect(panel).toContainText("應負擔 $6,375");
  await expect(panel).toContainText("應負擔 $6,075");
  step("記帳頁的預購面板用的是同一套「誰付多少」，不是一人一半");

  // ───────────── 編輯：品項與規則都留著、都能改 ─────────────
  await go(a, `/preorders/${poId}`);
  await a.getByText("編輯預購").click();
  await expect(a.getByLabel("品項 1 名稱")).toHaveValue("主機");
  await expect(a.getByLabel("品項 2 數量")).toHaveValue("2");
  await a.getByLabel("品項 2 數量").fill("3");
  await expect(a.getByLabel("商品金額")).toHaveValue("12450");
  // 品項改了之後金額規則對不起來，會直接擋住並說原因
  await expect(a.getByRole("button", { name: "儲存" })).toBeDisabled();
  await expect(a.getByText(/算不出來/)).toBeVisible();
  await a.getByTestId("fill-from-items").click();
  await expect(a.getByRole("button", { name: "儲存" })).toBeEnabled();
  await a.getByRole("button", { name: "儲存" }).click();
  await expect(a.getByText("已儲存")).toBeVisible({ timeout: 10000 });
  await go(a, `/preorders/${poId}`);
  await expect(a.getByTestId("preorder-item-list")).toContainText("×3");
  step("編輯時品項與「誰付多少」都帶得回來；金額對不起來會擋住送出並說明原因");

  // 另一半看到同一份
  const bText = (await pageText(b, `/preorders/${poId}`)).replace(/\s+/g, " ");
  expect(bText).toContain("主機");
  expect(bText).toContain("每個人還需付");
  step("另一半看到的是同一份明細品項與誰付多少");

  // 小螢幕不破版
  for (const [page, name] of [[a, "iPhone 13"], [b, "iPhone SE"]] as const) {
    for (const path of ["/preorders/new", `/preorders/${poId}`]) {
      await go(page, path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${name} ${path} 水平溢出 ${over}px`).toBeLessThanOrEqual(1);
    }
  }
  step("預購新增與詳細頁在 390px 與 320px 都沒有水平溢出");
}
