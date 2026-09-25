/**
 * Phase 3-4 E：記帳收據照片（兩支手機）。
 * 前提：Phase 1～3-4 C 的流程已經跑完，帳本裡有帳戶與記帳資料。
 */
import { expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { go, pageText, shot, step } from "./lib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** 產生一張真的解得開的 PNG（8×8 純色，瀏覽器才壓縮得動）。 */
function makePng(file: string, rgb: [number, number, number]) {
  const W = 8;
  const raw = Buffer.concat(
    Array.from({ length: W }, () =>
      Buffer.concat([Buffer.from([0]), ...Array.from({ length: W }, () => Buffer.from(rgb))]),
    ),
  );
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
  return file;
}

export async function phase3Receipts(a: Page, b: Page) {
  const dir = path.join(tmpdir(), "cm-e2e-receipts");
  mkdirSync(dir, { recursive: true });
  const photo1 = makePng(path.join(dir, "receipt-1.png"), [200, 40, 40]);
  const photo2 = makePng(path.join(dir, "receipt-2.png"), [40, 120, 200]);
  const notImage = path.join(dir, "fake.png");
  writeFileSync(notImage, Buffer.from("%PDF-1.7 這不是圖片"));

  // 0. 專門為這段流程記一筆（結束時會作廢，不影響其他階段的數字）
  await go(a, "/transactions/new");
  await a.getByLabel("金額").fill("188");
  await a.getByLabel("名稱（選填）").fill("收據測試早餐");
  await a.getByRole("button", { name: "記下來" }).click();
  await a.waitForURL(/\/$/);
  await go(a, "/transactions");
  await a.getByTestId("tx-row").filter({ hasText: "收據測試早餐" }).first().click();
  await a.waitForURL(/\/transactions\/[\w-]+$/);
  const txUrl = a.url();
  const origin = new URL(txUrl).origin;
  await expect(a.getByTestId("receipt-box")).toBeVisible();
  expect(await pageText(a)).toContain("還沒有收據");
  step("記帳詳細頁有「收據照片」區塊");

  // 1. 上傳一張
  await a.getByTestId("receipt-input").setInputFiles(photo1);
  await expect(a.getByTestId("receipt-thumb")).toHaveCount(1);
  await shot(a, "17-receipt-one");
  step("上傳收據：縮圖出現在詳細頁");

  // 2. 點一下放大，再關掉
  await a.getByTestId("receipt-thumb").first().click();
  await expect(a.getByTestId("receipt-zoom")).toBeVisible();
  await shot(a, "18-receipt-zoom");
  await a.getByRole("button", { name: "關閉" }).click();
  await expect(a.getByTestId("receipt-zoom")).toHaveCount(0);
  step("點縮圖可以全螢幕放大，關得掉");

  // 3. 第二張；記帳列表不會載入任何收據圖片
  await a.getByTestId("receipt-input").setInputFiles(photo2);
  await expect(a.getByTestId("receipt-thumb")).toHaveCount(2);
  expect(await pageText(a)).toContain("2／3");
  await go(a, "/transactions");
  expect(await a.locator('img[src^="/api/files/"]').count()).toBe(0);
  step("可以放多張；記帳列表不會載入原圖");

  // 4. 不是圖片的檔案會被伺服器擋下來
  await go(a, txUrl);
  await a.getByTestId("receipt-input").setInputFiles(notImage);
  await expect(a.getByTestId("receipt-box").locator("p[role=alert]")).toContainText("不是圖片");
  await expect(a.getByTestId("receipt-thumb")).toHaveCount(2);
  step("副檔名偽裝成 PNG 的檔案被擋下（伺服器檢查檔頭）");

  // 5. 同一張照片重複送出只會留一張
  await a.getByTestId("receipt-input").setInputFiles(photo1);
  await expect(a.getByTestId("receipt-box").locator("p[role=alert]")).toContainText("已經加過了");
  await expect(a.getByTestId("receipt-thumb")).toHaveCount(2);
  step("同一張照片重複送出會被擋，不會變兩張");

  // 6. 另一半看得到，圖片也下載得到
  await go(b, txUrl);
  await expect(b.getByTestId("receipt-thumb")).toHaveCount(2);
  const imgPath = (await b.getByTestId("receipt-thumb").first().locator("img").getAttribute("src"))!;
  expect((await b.request.get(`${origin}${imgPath}`)).status()).toBe(200);
  step("阿本看得到小艾上傳的收據，圖片也下載得到");

  // 7. 別的帳本的人打不開這筆記帳，也下載不到收據
  const browser = a.context().browser()!;
  const outsider = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const c = await outsider.newPage();
  await go(c, "/register");
  await c.getByLabel("暱稱").fill("路人丁");
  await c.getByLabel("Email").fill(`outsider35-${Date.now().toString(36)}@example.com`);
  await c.getByLabel("密碼").fill("password123");
  await c.getByRole("button", { name: "建立帳號" }).click();
  await c.waitForURL(/\/onboarding/);
  await c.getByLabel("帳本名稱").fill("路人丁的帳本");
  await c.getByRole("button", { name: "建立帳本" }).click();
  await c.waitForURL(/\/more/);
  expect((await c.request.get(`${origin}${imgPath}`)).status()).toBe(404);
  await go(c, txUrl);
  expect(await pageText(c)).toContain("找不到這筆資料");
  await outsider.close();
  step("另一個帳本的人打不開這筆記帳，也下載不到收據（404）");

  // 8. 刪除一張：記帳本身還在
  await go(a, txUrl);
  await a.getByTestId("receipt-delete").first().click();
  await expect(a.getByTestId("receipt-thumb")).toHaveCount(1);
  expect(await pageText(a)).toContain("1／3");
  await expect(a.getByRole("button", { name: "儲存修改" })).toBeVisible();
  step("刪除一張收據後記帳還在");

  // 9. 手機版面：320 與 390 都不破版
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 664 }]) {
    await a.setViewportSize(size);
    await go(a, txUrl);
    const o = await a.evaluate(() => ({ w: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(o.w, `${size.width}px 不該水平溢出`).toBeLessThanOrEqual(o.inner + 1);
    await expect(a.getByTestId("receipt-thumb").first()).toBeVisible();
    await expect(a.getByTestId("receipt-input")).toBeVisible();
    if (size.width === 320) await shot(a, "19-receipt-320");
  }
  await a.setViewportSize({ width: 390, height: 664 });
  step("收據區塊在 320px 與 390px 都不破版");

  // 10. 作廢這筆記帳之後，收據就再也讀不到
  await go(a, txUrl);
  await a.getByRole("button", { name: "刪除這筆紀錄" }).click();
  await a.waitForURL(/\/transactions$/);
  expect((await a.request.get(`${origin}${imgPath}`)).status()).toBe(404);
  step("作廢記帳後，收據圖片也讀不到了");
}
