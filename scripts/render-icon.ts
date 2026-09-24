/**
 * 把一個 lucide 圖形描邊渲染成 public/assets/icons/<key>.png。
 *
 * 這些 PNG 是「可替換的插槽」：檔名就是用途，你隨時可以用自己的圖蓋掉。
 * 這支腳本只是用來補上還沒有圖的那幾格，讓畫面不會出現破圖。
 *
 * 用法：
 *   npx tsx scripts/render-icon.ts check-circle '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve("public/assets/icons");
const INK = "#4A3B32"; // 手帳風的深咖啡，跟其他圖示一致
const SIZE = 256;

const [key, body] = process.argv.slice(2);
if (!key || !body) {
  console.error("用法：npx tsx scripts/render-icon.ts <key> '<svg 內容>'");
  process.exit(1);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24"
  fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`, { waitUntil: "load" });
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${key}.png`, omitBackground: true });
  await browser.close();
  console.log(`已產生 ${OUT}/${key}.png`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
