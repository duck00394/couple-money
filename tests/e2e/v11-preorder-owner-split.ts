/**
 * V11：預購的「依『誰的』」要真的依每個品項的「誰的」。
 *
 * 回歸測試。之前的 bug：整張單選「共同」時，不管每件東西標給誰，
 * 「依『誰的』」都算成一人一半。
 *
 * 前提：Phase 1～V10 已跑完，兩人帳號延續使用。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

export async function v11PreorderOwnerSplit(a: Page, b: Page) {
  await go(a, "/preorders/new");
  await a.getByLabel("品名").fill("V11 各買各的");
  await a.getByLabel("運費（選填）").fill("400");
  // 整張單是「共同」—— 這正是原本會退化成平分的情境
  await a.getByLabel("誰的").selectOption({ label: "共同" });

  await a.getByTestId("add-item").click();
  await a.getByLabel("品項 1 名稱").fill("小艾的");
  await a.getByLabel("品項 1 單價").fill("3000");
  await a.getByLabel("品項 1 誰的").selectOption({ label: "小艾" });

  await a.getByTestId("add-item").click();
  await a.getByLabel("品項 2 名稱").fill("阿本的");
  await a.getByLabel("品項 2 單價").fill("1000");
  await a.getByLabel("品項 2 誰的").selectOption({ label: "阿本" });

  await a.getByTestId("add-item").click();
  await a.getByLabel("品項 3 名稱").fill("一起用的");
  await a.getByLabel("品項 3 單價").fill("600");
  await a.getByLabel("品項 3 誰的").selectOption({ label: "共同" });

  await expect(a.getByLabel("商品金額")).toHaveValue("4600");

  // 小艾 3000 + 共同池（共同品項 600 + 運費 400 = 1000）的一半 → 3500
  // 阿本 1000 + 500 → 1500
  const preview = a.getByTestId("preorder-due-preview");
  await expect(preview).toContainText("$3,500");
  await expect(preview).toContainText("$1,500");
  const both = (await preview.innerText()).replace(/\s+/g, " ");
  expect(both, "不可以再變成一人一半 $2,500").not.toContain("$2,500");
  await shot(a, "v11-01-preorder-owner-split");
  step("表單預覽：依「誰的」→ 小艾 $3,500、阿本 $1,500，不是一人一半");

  await a.getByRole("button", { name: "建立預購" }).click();
  await a.waitForURL(/\/preorders\/(?!new$)[^/]+$/);
  await loaded(a);
  const url = a.url();

  // 詳細頁算出來的要跟表單預覽一致（同一個 domain 函式）
  const detail = (await pageText(a)).replace(/\s+/g, " ");
  expect(detail).toContain("$3,500");
  expect(detail).toContain("$1,500");
  step("詳細頁的「應負擔」跟表單預覽一致：存進資料庫之後數字沒有變");

  // 對方看到的是同一份
  await go(b, url);
  const forB = (await pageText(b)).replace(/\s+/g, " ");
  expect(forB).toContain("$3,500");
  expect(forB).toContain("$1,500");
  step("另一半看到的應負擔是同一份，不會因為誰在看而不同");

  // 改成「平分」時，使用者自己的選擇優先
  await go(a, `${url}`);
  await a.getByText("編輯預購").click();
  await a.getByTestId("preorder-split").getByRole("button", { name: "平分" }).click();
  await expect(a.getByTestId("preorder-due-preview")).toContainText("$2,500");
  step("自己切到「平分」時規則優先，兩個人各 $2,500");

  // 切回「依『誰的』」要回到依品項的分法
  await a.getByTestId("preorder-split").getByRole("button", { name: "依「誰的」" }).click();
  await expect(a.getByTestId("preorder-due-preview")).toContainText("$3,500");
  step("切回「依『誰的』」就回到依品項的分法，兩個模式切換不會互相汙染");
}
