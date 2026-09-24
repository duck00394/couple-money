/** Phase 2 端到端：基金 → 目標 → 基金支出 → 任務打卡（照片、確認、共同任務、取消）→ 首頁。前提：A、B 已綁定且登入。 */
import { expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { go, pageText, shot, step } from "./lib";

/** 產生一張 64x64 的 PNG（打卡照片用）。 */
function pngBuffer() {
  const w = 64, h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([x * 4, y * 4, 180], y * (w * 3 + 1) + 1 + x * 3);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function openFund(page: Page, name: string) {
  await go(page, "/goals");
  await page.getByTestId("fund-row").filter({ hasText: name }).click();
  await page.waitForURL(/\/funds\/c/);
}

async function fundEntry(page: Page, amount: string, type: "投入" | "取回" = "投入", storagePrefix?: string) {
  await page.getByRole("button", { name: type, exact: true }).click();
  await page.getByLabel("基金金額").fill(amount);
  if (storagePrefix) {
    const option = page.getByLabel("存放帳戶").locator("option", { hasText: storagePrefix }).first();
    await page.getByLabel("存放帳戶").selectOption(await option.getAttribute("value"));
  }
  await page.getByRole("button", { name: type === "投入" ? "投入基金" : "從基金取回" }).click();
}

async function createTask(page: Page, opts: { title: string; who?: string; reward?: string; approval?: boolean; photo?: boolean; penaltyText?: string }) {
  await go(page, "/tasks/new");
  await page.getByLabel("任務名稱").fill(opts.title);
  if (opts.who) await page.getByLabel("執行者").selectOption({ label: opts.who });
  await page.getByLabel("獎金基金").selectOption({ label: "日本旅遊基金" });
  if (opts.reward) await page.getByLabel("完成獎金").fill(opts.reward);
  if (opts.approval) await page.getByText("需要對方確認").click();
  if (opts.photo) await page.getByText("需要上傳照片").click();
  if (opts.penaltyText) await page.getByLabel("非金錢懲罰").fill(opts.penaltyText);
  await page.getByRole("button", { name: "建立任務" }).click();
  await page.waitForURL(/\/tasks\/c/);
}

export async function phase2(a: Page, b: Page) {
  // 先有真的錢：小艾把 $30,000 存進共同帳戶、阿本現金收入 $10,000
  for (const [page, amount, account, title] of [[a, "30000", "共同帳戶", "兩人存入共同帳戶"], [b, "10000", "我的・現金", "薪水"]] as const) {
    await go(page, "/transactions/new");
    await page.getByRole("button", { name: "收入", exact: true }).click();
    await page.getByLabel("金額").fill(amount);
    await page.getByLabel("名稱（選填）").fill(title);
    await page.getByLabel("帳戶").selectOption({ label: account });
    await page.getByRole("button", { name: "記下來" }).click();
    await page.waitForURL(/\/$|\/transactions$/);
  }
  step("收入：共同帳戶 +$30,000、阿本現金 +$10,000");

  // 基金：投入必須是帳戶裡「可自由使用」的錢
  await go(a, "/funds/new");
  await a.getByLabel("基金名稱").fill("日本旅遊基金");
  await a.getByLabel("目標金額（選填）").fill("30000");
  await a.getByRole("button", { name: "建立基金" }).click();
  await a.waitForURL(/\/funds\/c/);
  await fundEntry(a, "99999", "投入", "共同・共同帳戶");
  await expect(a.locator("p[role=alert]")).toContainText("可自由使用的金額只剩 $29,500");
  await fundEntry(a, "10000", "投入", "共同・共同帳戶");
  await expect(a.getByTestId("fund-balance")).toHaveText("$10,000");
  await openFund(b, "日本旅遊基金");
  await fundEntry(b, "8000", "投入", "我・現金");
  await expect(b.getByTestId("fund-balance")).toHaveText("$18,000");
  step("基金：超過可自由使用被擋；共同帳戶投入 $10,000、阿本現金投入 $8,000");

  await go(a, "/accounts");
  const jointRow = a.getByTestId("account-row").filter({ hasText: "共同帳戶" });
  await expect(jointRow).toContainText("$29,500");
  await expect(jointRow.getByTestId("account-earmark")).toContainText("已指定給基金 $10,000");
  await expect(jointRow.getByTestId("account-earmark")).toContainText("可自由使用 $19,500");
  await expect(a.getByTestId("account-row").filter({ hasText: "玉山卡" })).toContainText("$1,620");
  await a.getByText("帳戶、基金、目標有什麼不同？").click();
  await expect(a.getByTestId("money-concepts")).toContainText("尚未入金獎金");
  step("帳戶頁：實際餘額 $29,500、已指定給基金 $10,000、可自由使用 $19,500");

  // 目標
  await go(a, "/goals/new");
  await a.getByLabel("目標名稱").fill("日本旅行");
  await a.getByLabel("目標金額").fill("30000");
  await a.getByLabel("連結基金").selectOption({ label: "日本旅遊基金" });
  await a.getByRole("button", { name: "建立目標" }).click();
  await a.waitForURL(/\/goals\/c/);
  await expect(a.getByTestId("goal-current")).toHaveText("$18,000");
  await expect(a.getByTestId("goal-remaining")).toHaveText("$12,000");
  await expect(a.getByText("60%").first()).toBeVisible();
  await shot(a, "p2-01-goal");
  step("目標：目前 $18,000（實際基金金額）、剩餘 $12,000、60%");

  // 基金支出：付款帳戶只扣一次、基金用途減少、欠款照分帳
  await openFund(a, "日本旅遊基金");
  await a.getByRole("link", { name: "記一筆基金支出" }).click();
  await a.waitForURL(/\/transactions\/new\?fund=/);
  await a.getByLabel("金額").fill("500");
  await a.getByLabel("名稱（選填）").fill("行李箱");
  expect(await a.getByLabel("帳戶").locator("option:checked").innerText()).toContain("共同帳戶"); // 預設用基金額度最多的帳戶
  await expect(a.getByTestId("fund-hint")).toContainText("不會扣兩次");
  await expect(a.getByTestId("fund-personal-warning")).toHaveCount(0);
  await a.getByLabel("帳戶").selectOption({ label: "我的・現金" }); // 改用個人帳戶付
  await expect(a.getByTestId("fund-personal-warning")).toContainText("欠款照常產生");
  // 產品規則：一定要自己選動用哪個帳戶的基金額度，沒選不能送出
  await expect(a.getByRole("button", { name: "記下來" })).toBeDisabled();
  await a.getByLabel("基金動用來源").selectOption({ index: 1 }); // 第 1 項是共同帳戶的額度（唯一有額度的帳戶）
  await expect(a.getByTestId("fund-hint")).toContainText("動用「共同・共同帳戶」");
  await shot(a, "p2-00-fund-expense-form");
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL(/\/funds\/c/);
  await expect(a.getByTestId("fund-balance")).toHaveText("$17,500");
  await expect(a.getByTestId("fund-entry").filter({ hasText: "行李箱" })).toContainText("實際付款：我・現金");
  expect(await pageText(a, "/")).toContain("阿本 要還你 $310");
  step("基金支出 $500：小艾現金付款（只扣一次）、基金 −$500、欠款 +$250");

  // 任務獎金：先記為尚未入金
  await createTask(a, { title: "英文 30 分鐘", reward: "50", penaltyText: "洗碗一次" });
  await a.getByLabel("打卡備註").fill("Unit 3");
  await a.getByRole("button", { name: "完成打卡" }).click();
  await expect(a.getByTestId("checkin-status")).toContainText("今天已完成");
  await shot(a, "p2-02-task-detail");
  await openFund(a, "日本旅遊基金");
  await expect(a.getByTestId("fund-balance")).toHaveText("$17,500");
  await expect(a.getByTestId("fund-pending")).toHaveText("+$50");
  step("打卡「英文 30 分鐘」→ 尚未入金獎金 +$50，實際基金金額不變");

  // 需要照片＋對方確認
  await createTask(b, { title: "早睡", reward: "30", approval: true, photo: true });
  await expect(b.getByRole("button", { name: "完成打卡" })).toBeDisabled();
  await b.getByLabel("上傳照片", { exact: true }).setInputFiles({ name: "sleep.png", mimeType: "image/png", buffer: pngBuffer() });
  await expect(b.getByAltText("打卡照片預覽")).toBeVisible();
  await b.getByRole("button", { name: "完成打卡" }).click();
  await expect(b.getByTestId("checkin-status")).toContainText("等另一半確認");
  await go(a, "/tasks");
  await expect(a.getByText("等你確認")).toBeVisible();
  await a.getByAltText("打卡照片縮圖").click();
  await a.waitForURL(/\/tasks\/c/);
  const partnerPhoto = a.getByTestId("partner-checkins").getByRole("img");
  await expect(partnerPhoto).toBeVisible();
  expect(await partnerPhoto.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await a.getByTestId("partner-checkins").getByRole("button", { name: "確認完成" }).click();
  await expect(a.getByTestId("partner-checkins")).toContainText("已完成");
  step("照片打卡 → 小艾看照片後確認 → 獎金 +$30（尚未入金）");

  // 共同任務
  await createTask(a, { title: "一起散步", who: "共同任務（一人完成就算）", reward: "20" });
  await go(b, "/tasks");
  await b.getByRole("button", { name: "打卡 一起散步" }).first().click();
  await expect(b.getByTestId("toast")).toContainText("完成！連續 1 天");
  await go(a, "/tasks");
  await expect(a.getByTestId("task-row").filter({ hasText: "一起散步" }).first().getByTestId("task-status")).toContainText("已完成");
  await expect(a.getByTestId("today-rewards")).toHaveText("+$100");
  await shot(a, "p2-03-tasks");
  step("共同任務完成；今日獲得獎金 +$100（尚未入金）");

  // 取消與重新打卡
  await a.getByTestId("task-row").filter({ hasText: "英文 30 分鐘" }).first().getByRole("link").first().click();
  await a.getByRole("button", { name: "取消打卡" }).click();
  await expect(a.getByRole("button", { name: "完成打卡" })).toBeVisible();
  await openFund(a, "日本旅遊基金");
  await expect(a.getByTestId("fund-pending")).toHaveText("+$50");
  await go(a, "/tasks");
  await a.getByRole("button", { name: "打卡 英文 30 分鐘" }).first().click();
  await expect(a.getByTestId("toast")).toContainText("完成！連續 1 天");
  step("取消打卡收回獎金、重新打卡再獲得");

  // 獎金入金 → 實際金額增加
  await openFund(a, "日本旅遊基金");
  await expect(a.getByTestId("fund-pending")).toHaveText("+$100");
  await a.getByRole("button", { name: "入金 $100" }).click();
  await expect(a.getByTestId("fund-balance")).toHaveText("$17,600");
  await expect(a.getByTestId("fund-pending")).toHaveText("+$0");
  await expect(a.getByTestId("fund-entry").filter({ hasText: "任務獎金入金" })).toContainText("+$100");
  await shot(a, "p2-04-fund");
  await go(a, "/accounts");
  await expect(a.getByTestId("account-row").filter({ hasText: "共同帳戶" }).getByTestId("account-earmark")).toContainText("已指定給基金 $9,600");
  step("獎金入金 $100 到共同帳戶：實際基金 $17,600、尚未入金歸零、共同帳戶已指定 $9,600");

  // 權限：阿本不能改小艾建立的任務金額、不能刪除
  await go(b, "/tasks");
  await b.getByTestId("task-row").filter({ hasText: "英文 30 分鐘" }).first().getByRole("link").first().click();
  await b.getByText("編輯任務").click();
  await expect(b.getByTestId("task-locked-note")).toContainText("只有建立者（小艾）");
  await expect(b.getByLabel("完成獎金")).toBeDisabled();
  await expect(b.getByRole("button", { name: "刪除任務" })).toHaveCount(0);
  step("權限：阿本看得到但不能改小艾任務的獎金，也沒有刪除按鈕");

  // 刪除目標要另一半確認
  await go(a, "/goals");
  await a.getByTestId("goal-row").filter({ hasText: "日本旅行" }).click();
  await a.getByText("編輯或刪除目標").click();
  await a.getByRole("button", { name: /申請刪除目標/ }).click();
  await expect(a.getByTestId("delete-request")).toContainText("等 阿本 確認");
  await go(b, "/goals");
  await expect(b.getByText("等你確認的刪除")).toBeVisible();
  await b.getByRole("button", { name: "不要刪除" }).click();
  await expect(b.getByText("等你確認的刪除")).toHaveCount(0);
  await expect(b.getByTestId("goal-row").filter({ hasText: "日本旅行" })).toBeVisible();
  step("刪除目標：小艾申請 → 阿本拒絕 → 目標保留");

  const home = await pageText(a, "/");
  expect(home).toContain("阿本 要還你 $310");
  expect(home).toContain("日本旅行");
  expect(home).toContain("58.6%");
  expect(home).toContain("+$100");
  await shot(a, "p2-05-home");
  await go(a, "/goals");
  await shot(a, "p2-06-goals");
  step("首頁：欠款 $310、主要目標 58.6%、今日獎金 +$100");
}
