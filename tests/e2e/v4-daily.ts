/**
 * V4：日常使用（兩支手機）。
 *
 * 1. 底部導覽是 首頁｜任務｜記帳｜基金｜統計
 * 2. 建立「每次」任務 → 同一天做兩次 → 累計次數與獎金看得到
 * 3. 「每次」任務的週期在畫面上是白話，不是 PER_TIME
 * 4. 複製任務：新任務、設定一樣、歷史沒有跟過來
 * 5. 新增基金（含初始金額）→ 立刻看到目前／目標／尚差／進度
 * 6. 新增帳戶 → 立刻可以用來記帳
 * 7. 「更多」只剩低頻管理
 *
 * 前提：Phase 1～Phase 4 已跑完，兩人帳號延續使用。
 */
import { expect, type Page } from "@playwright/test";
import { go, loaded, pageText, shot, step } from "./lib";

const NAV = ["首頁", "任務", "記帳", "基金", "統計"];

export async function v4Daily(a: Page, b: Page) {
  // 1. 底部導覽
  await go(a, "/");
  const nav = a.locator("nav").last();
  await expect(nav.getByRole("link")).toHaveCount(5);
  for (const label of NAV) await expect(nav.getByRole("link", { name: label })).toBeVisible();
  await nav.getByRole("link", { name: "基金" }).click();
  await a.waitForURL(/\/funds$/);
  await loaded(a);
  step(`底部導覽是 ${NAV.join("｜")}，每一格都連得到`);

  // 2. 新增基金（含初始金額）
  await a.getByTestId("new-fund").click();
  await a.waitForURL(/\/funds\/new$/);
  await a.getByLabel("基金名稱").fill("養貓基金");
  await a.getByLabel("目標金額（選填）").fill("20000");
  await a.getByTestId("fund-opening").fill("5000");
  await a.getByLabel("這筆錢放在").selectOption({ label: "共同・共同帳戶" });
  await a.getByRole("button", { name: "建立基金" }).click();
  await a.waitForURL(/\/funds\/(?!new$)[^/]+$/);
  await loaded(a);
  const detail = await pageText(a);
  expect(detail, "建立後就看得到目前金額").toContain("$5,000");
  const fundsText = await pageText(a, "/funds");
  expect(fundsText).toContain("養貓基金");
  expect(fundsText, "目標與尚差都要看得到").toContain("目標 $20,000・還差 $15,000");
  await shot(a, "50-funds");
  step("新增基金（初始金額 $5,000）→ 目前 $5,000、目標 $20,000、還差 $15,000");

  // 3. 新增帳戶 → 立刻可以記帳
  await go(a, "/accounts");
  await a.getByRole("button", { name: "＋ 新增帳戶" }).click();
  await a.getByLabel("類型").selectOption("E_WALLET");
  await a.getByLabel("名稱").fill("街口支付");
  await a.getByLabel("目前餘額（選填）").fill("800");
  await a.getByRole("button", { name: "新增", exact: true }).click();
  await expect(a.getByTestId("account-row").filter({ hasText: "街口支付" })).toContainText("$800");
  await go(a, "/transactions/new");
  await expect(a.getByLabel("帳戶")).toContainText("街口支付");
  step("新增帳戶（初始餘額 $800）→ 馬上可以在記帳頁選到");

  // 4. 建立「每次」任務
  await go(a, "/tasks/new");
  await a.getByLabel("任務名稱").fill("倒垃圾");
  await a.getByLabel("執行者").selectOption("EACH");
  await a.getByRole("button", { name: "每次", exact: true }).click();
  await expect(a.getByText("做一次賺一次，同一天可以重複完成")).toBeVisible();
  await expect(a.getByLabel("漏做扣款"), "「每次」不該有懲罰欄位").toHaveCount(0);
  await a.getByLabel("獎金基金").selectOption({ label: "養貓基金" });
  await a.getByLabel("完成獎金").fill("30");
  await a.getByRole("button", { name: "建立任務" }).click();
  await a.waitForURL(/\/tasks\/(?!new$)[^/]+$/);
  await loaded(a);
  const taskUrl = a.url();
  await expect(a.getByTestId("task-frequency")).toHaveText("做一次賺一次，同一天可以重複完成");
  step("建立「每次」任務：畫面寫「做一次賺一次」，沒有懲罰欄位");

  // 5. 同一天做兩次
  await a.getByRole("button", { name: "完成一次" }).click();
  await expect(a.getByTestId("checkin-status")).toContainText("今天已完成 1 次");
  await a.getByRole("button", { name: "＋ 再完成一次" }).click();
  await expect(a.getByTestId("checkin-status")).toContainText("今天已完成 2 次・+$60");
  await expect(a.getByTestId("per-time-list").getByRole("listitem")).toHaveCount(2);
  await shot(a, "51-per-time");
  step("同一天完成兩次：兩筆獨立紀錄、累計 +$60");

  // 5b. 防連點：手機上很容易把「再完成一次」連按兩下，只能算一次
  // 同一個 tick 內連按兩下（真正的手殘情境）：用 evaluate 直接連續 dispatch 兩次
  await a.getByRole("button", { name: "＋ 再完成一次" }).evaluate((el) => {
    (el as HTMLButtonElement).click();
    (el as HTMLButtonElement).click();
  });
  await expect(a.getByTestId("checkin-status")).toContainText("今天已完成 3 次・+$90");
  await expect(a.getByTestId("per-time-list").getByRole("listitem")).toHaveCount(3);
  // 上一次回來之後，要再完成一次仍然完全正常
  await a.getByRole("button", { name: "＋ 再完成一次" }).click();
  await expect(a.getByTestId("checkin-status")).toContainText("今天已完成 4 次・+$120");
  step("連按兩下只會算一次（3 次），但之後還是可以正常再完成一次（4 次）");

  // 6. 首頁與任務頁都看得到累計與「再完成一次」
  const home = await pageText(a, "/");
  expect(home).toContain("今天 4 次・共 $120");
  expect(home, "首頁不該出現程式用語").not.toMatch(/PER_TIME|DAILY|WEEKLY/);
  await expect(a.getByRole("button", { name: /再一次 倒垃圾/ }).first()).toBeVisible();
  await a.getByRole("button", { name: /再一次 倒垃圾/ }).first().click();
  await expect(a.getByText("今天 5 次・共 $150").first()).toBeVisible();
  await shot(a, "52-home-dashboard");
  step("首頁 Dashboard：不用進詳細頁就能再完成一次（5 次・+$150）");

  // 7. 每次 × EACH：阿本自己做自己的
  await go(b, "/tasks");
  const benRow = b.getByTestId("task-row").filter({ hasText: "倒垃圾" }).first();
  await benRow.getByRole("button", { name: /打卡 倒垃圾/ }).click();
  await expect(b.getByText("今天 1 次・共 $30").first()).toBeVisible();
  const amyTasks = await pageText(a, "/tasks");
  expect(amyTasks, "小艾自己還是 5 次").toContain("今天 5 次・共 $150");
  step("每次 × 各自完成：小艾 5 次 $150、阿本 1 次 $30，互不影響");

  // 8. 複製任務
  await go(a, taskUrl);
  await a.getByTestId("duplicate-task").click();
  await a.waitForURL((u) => /\/tasks\/[^/]+$/.test(u.pathname) && u.href !== taskUrl);
  await loaded(a);
  expect(a.url(), "是一個新的任務").not.toBe(taskUrl);
  await expect(a.getByRole("heading", { name: "倒垃圾 (複製)" })).toBeVisible();
  const copyText = await pageText(a);
  expect(copyText).toContain("做一次賺一次");
  expect(copyText).toContain("+$30");
  expect(copyText, "歷史不會跟過來").toContain("今天還沒有完成過");
  await shot(a, "53-duplicate");
  step("複製任務：新的任務、設定一樣、打卡與獎勵紀錄沒有跟過來");

  // 9. 每週任務：一週內任一天完成一次，完成後本週不能再做
  await go(a, "/tasks/new");
  await a.getByLabel("任務名稱").fill("每週運動");
  await a.getByLabel("執行者").selectOption("EACH");
  await a.getByRole("button", { name: "每週", exact: true }).click();
  await expect(a.getByText("一週內完成一次即可")).toBeVisible();
  await expect(a.getByRole("button", { name: "週一" }), "每週不該再要求選星期幾").toHaveCount(0);
  await a.getByLabel("完成獎金").fill("100");
  await a.getByRole("button", { name: "建立任務" }).click();
  await a.waitForURL(/\/tasks\/(?!new$)[^/]+$/);
  await loaded(a);
  await expect(a.getByTestId("task-frequency")).toHaveText("一週內完成一次即可");
  await expect(a.getByTestId("checkin-status")).toContainText("本週還可以完成一次");
  step("建立每週任務：不用選星期幾，畫面寫「一週內完成一次即可」");

  await a.getByRole("button", { name: "完成本週" }).click();
  await expect(a.getByTestId("checkin-status")).toContainText("本週已完成");
  await expect(a.getByTestId("checkin-status")).toContainText("下週才能再做一次");
  await expect(a.getByRole("button", { name: "完成本週" }), "本週不能再做一次").toHaveCount(0);
  const weekTasks = await pageText(a, "/tasks");
  expect(weekTasks).toContain("本週已完成");
  expect(weekTasks, "不該出現程式用語").not.toMatch(/WEEKLY/);
  await shot(a, "55-weekly-done");
  step("本週完成一次後：顯示「本週已完成」，本週不能再完成");

  // 阿本這週還沒做，仍然可以完成（EACH 各自獨立）
  await go(b, "/tasks");
  const benWeek = b.getByTestId("task-row").filter({ hasText: "每週運動" }).first();
  await expect(benWeek.getByRole("button", { name: /打卡 每週運動/ })).toBeVisible();
  await benWeek.getByRole("button", { name: /打卡 每週運動/ }).click();
  await expect(b.getByTestId("task-row").filter({ hasText: "每週運動" }).first()).toContainText("本週已完成");
  step("每週 × 各自完成：小艾本週已完成不影響阿本，阿本仍然可以完成");

  // 8b. 獎勵提列 → 在記帳明細找得到那筆收入 → 作廢後獎勵回到「我的獎勵」
  await go(a, "/tasks");
  const before = await a.getByTestId("reward-balance").innerText();
  expect(before, "前面完成了不少任務，應該有餘額").not.toBe("$0");
  await a.getByTestId("reward-withdraw-open").click();
  await a.getByLabel("收款帳戶").selectOption({ index: 0 });
  await a.getByTestId("reward-withdraw-submit").click();
  await expect(a.getByTestId("reward-balance")).toHaveText("$0", { timeout: 15000 });
  step(`提列 ${before}：獎勵餘額歸零，錢進到帳戶`);

  // 找得到那筆收入（使用者會來這裡找）
  const list = await pageText(a, "/transactions");
  expect(list, "提列後在記帳明細看得到「任務獎勵提列」").toContain("任務獎勵提列");
  await a.getByText("任務獎勵提列").first().click();
  await a.waitForURL(/\/transactions\/[^/]+$/);
  await loaded(a);
  await expect(a.getByTestId("reward-withdrawal-note")).toContainText("這是一筆任務獎勵提列");
  await shot(a, "56-withdrawal-detail");
  step("記帳明細找得到「任務獎勵提列」，點進去會說明它是什麼、作廢會怎樣");

  await a.getByRole("button", { name: "作廢這筆提列" }).click();
  await a.waitForURL(/\/transactions$/, { timeout: 15000 });
  const after = await pageText(a, "/tasks");
  expect(after, "作廢後獎勵要回到「我的獎勵」，不是人間蒸發").toContain(before);
  expect(await pageText(a, "/transactions"), "那筆收入不見了").not.toContain("任務獎勵提列");
  step(`作廢提列：帳戶的錢退回去，獎勵 ${before} 回到「我的獎勵」，可以重新提列`);

  // 9. 「更多」只剩低頻管理
  const more = await pageText(a, "/more");
  for (const label of ["帳戶管理", "分類管理", "固定支出", "最近動態", "記帳明細與 CSV"]) {
    expect(more, `更多頁應該有「${label}」`).toContain(label);
  }
  await shot(a, "54-more");
  step("「更多」只放帳戶、分類、固定支出、明細/CSV、動態這類低頻管理");
}
