import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ICONS, FALLBACK_ICON, LEGACY_EMOJI_ICON, toIconKey } from "../../src/lib/icons";

/**
 * 圖示是 <img src="/assets/icons/<key>.png">，所以「程式裡登記了 key 但沒有 PNG」
 * 不會有任何編譯錯誤 —— 只會在畫面上變成一格破圖。
 * 這支測試就是在擋那件事（底部導覽的「任務」就曾經因為缺 check-circle.png 而破圖）。
 */
const DIR = resolve(import.meta.dirname, "../../public/assets/icons");
const files = new Set(readdirSync(DIR).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)));

describe("圖示素材", () => {
  it("1. 每一個登記的 icon key 都有對應的 PNG（不然畫面會破圖）", () => {
    const missing = Object.keys(ICONS).filter((k) => !files.has(k));
    assert.deepEqual(missing, [], `缺少圖檔：${missing.map((k) => `public/assets/icons/${k}.png`).join("、")}`);
  });

  it("2. 每一個 PNG 都有登記（沒登記的檔案是孤兒，換圖時會白換）", () => {
    const orphans = [...files].filter((f) => !(f in ICONS));
    assert.deepEqual(orphans, [], `沒有登記的圖檔：${orphans.join("、")}`);
  });

  it("3. fallback 與舊 emoji 對照表指到的 key 都存在", () => {
    assert.ok(files.has(FALLBACK_ICON), "fallback 圖示本身不能是破圖");
    const bad = [...new Set(Object.values(LEGACY_EMOJI_ICON))].filter((k) => !files.has(k));
    assert.deepEqual(bad, [], `舊 emoji 會對應到不存在的圖示：${bad.join("、")}`);
  });

  it("4. 任何字串經過 toIconKey 之後都指得到真的檔案（未知一律 fallback）", () => {
    const hostile = [
      "", " ", "check-circle", "utensils", "MENU",           // 正常與大小寫
      "不存在的東西", "exercise", "travel", "book-reading",    // 沒登記過的 key
      "Wallet", "CheckCircle", "ShoppingBag", "CalendarClock", // lucide 元件名（不是 key）
      "🐷", "🍜", "✅", "💰",                                  // 舊 emoji 資料
      "undefined", "null", "[object Object]", "<script>",      // 壞資料
    ];
    for (const input of hostile) {
      const key = toIconKey(input);
      assert.ok(files.has(key), `toIconKey(${JSON.stringify(input)}) → ${JSON.stringify(key)} 指到不存在的圖示`);
      assert.ok(!/[A-Z]/.test(key), `${JSON.stringify(input)} 應該被轉成小寫 key，不能原樣留著`);
    }
    // null / undefined 進來也不能爆掉
    assert.ok(files.has(toIconKey(undefined)));
    assert.ok(files.has(toIconKey(null as unknown as string)));
  });

  it("5. 沒登記過的 key 會落到 fallback，不會原樣傳出去", () => {
    assert.equal(toIconKey("完全不存在的key"), FALLBACK_ICON);
    assert.equal(toIconKey("Wallet"), "wallet", "lucide 元件名要能對回 key");
    assert.equal(toIconKey("utensils"), "utensils", "既有 key 原樣保留，舊資料不會失效");
  });
});
