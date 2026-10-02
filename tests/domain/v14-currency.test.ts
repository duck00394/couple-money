/**
 * V14：多幣別換算的純邏輯（不碰資料庫）。
 *
 * 這一層只驗算術與格式化；「改匯率不影響歷史交易」那條最重要的規則
 * 需要真的寫進資料庫才證明得了，所以在整合測試裡（v14-currency.test.ts）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allocateForeign,
  assertRate,
  rateLabel,
  suggestedUnits,
  toBaseAmount,
  toForeignAmount,
} from "../../src/server/domain/exchange";
import { DomainError } from "../../src/server/domain/errors";
import {
  CURRENCIES,
  currencyOf,
  formatCurrency,
  isCurrencyCode,
  minorPerUnit,
  parseCurrencyAmount,
} from "../../src/lib/currency";

/** 「100 JPY = 21.5 TWD」 */
const JPY = { currency: "JPY", foreignUnits: 100, baseMinor: 2150 };
/** 「1 USD = 31.2 TWD」 */
const USD = { currency: "USD", foreignUnits: 1, baseMinor: 3120 };
/** 「1000 KRW = 23.4 TWD」 */
const KRW = { currency: "KRW", foreignUnits: 1000, baseMinor: 2340 };

describe("V14 幣別清單", () => {
  it("規格點 1 要求的十種幣別都在", () => {
    for (const code of ["TWD", "JPY", "USD", "KRW", "CNY", "HKD", "EUR", "GBP", "THB", "SGD"]) {
      assert.ok(isCurrencyCode(code), `缺少 ${code}`);
    }
  });

  it("日圓與韓元沒有小數，台幣與美金有兩位", () => {
    assert.equal(currencyOf("JPY").decimals, 0);
    assert.equal(currencyOf("KRW").decimals, 0);
    assert.equal(currencyOf("TWD").decimals, 2);
    assert.equal(currencyOf("USD").decimals, 2);
    assert.equal(minorPerUnit("JPY"), 1);
    assert.equal(minorPerUnit("TWD"), 100);
  });

  it("未知幣別不會讓畫面壞掉（回傳合理預設，而不是丟例外）", () => {
    const c = currencyOf("XYZ");
    assert.equal(c.code, "XYZ");
    assert.equal(c.decimals, 2);
  });

  it("格式化依各幣別的小數位數", () => {
    assert.equal(formatCurrency(2500, "JPY"), "¥2,500");
    assert.equal(formatCurrency(53750, "TWD"), "NT$537.50");
    assert.equal(formatCurrency(5000, "USD"), "US$50.00");
    assert.equal(formatCurrency(-2500, "JPY"), "-¥2,500");
  });

  it("解析輸入字串時依幣別換算最小單位", () => {
    assert.equal(parseCurrencyAmount("2500", "JPY"), 2500);
    assert.equal(parseCurrencyAmount("537.5", "TWD"), 53750);
    assert.equal(parseCurrencyAmount("1,234", "JPY"), 1234);
    assert.equal(parseCurrencyAmount("abc", "TWD"), null);
    assert.equal(parseCurrencyAmount("", "TWD"), null);
  });

  it("每個幣別都有符號與中文名稱（畫面不會出現空白）", () => {
    for (const c of CURRENCIES) {
      assert.ok(c.symbol.length > 0, `${c.code} 沒有符號`);
      assert.ok(c.name.length > 0, `${c.code} 沒有名稱`);
    }
  });
});

describe("V14 換算", () => {
  it("Case 1：TWD 500 就是 500 TWD（本位幣不換算）", () => {
    // 本位幣根本不會進到 toBaseAmount —— service 層看到同幣別就直接用原數字。
    // 這裡驗的是「rate 為 1:1 時也不會算歪」。
    assert.equal(toBaseAmount(50000, { currency: "TWD", foreignUnits: 1, baseMinor: 100 }), 50000);
  });

  it("Case 2：2,500 JPY ＠ 100 JPY = 21.5 TWD → 537.50 TWD", () => {
    assert.equal(toBaseAmount(2500, JPY), 53750); // 53750 最小單位 = NT$537.50
  });

  it("Case 4：同一筆金額換成 100 JPY = 22 TWD → 550 TWD", () => {
    assert.equal(toBaseAmount(2500, { ...JPY, baseMinor: 2200 }), 55000);
  });

  it("精度保留到分，不是直接四捨五入成整數元", () => {
    // 537.50 要存成 53750，不能變成 53800（NT$538）
    const base = toBaseAmount(2500, JPY);
    assert.equal(base % 100, 50, "小數部分被吃掉了");
  });

  it("USD 兩位小數：50 USD ＠ 1 USD = 31.2 TWD → 1,560 TWD", () => {
    assert.equal(toBaseAmount(5000, USD), 156000);
  });

  it("KRW 以 1000 為單位：1,500 KRW ＠ 1000 KRW = 23.4 TWD → 35.10 TWD", () => {
    assert.equal(toBaseAmount(1500, KRW), 3510);
  });

  it("除不盡時只在最後一步四捨五入（不會每一步都掉精度）", () => {
    // 1234 KRW × 2340 ÷ 1000 = 2887.56 → 2888
    assert.equal(toBaseAmount(1234, KRW), 2888);
  });

  it("全程整數運算，結果一定是整數", () => {
    for (const minor of [1, 7, 33, 999, 12345, 987654]) {
      const r = toBaseAmount(minor, JPY);
      assert.ok(Number.isSafeInteger(r), `${minor} 換出來不是整數：${r}`);
    }
  });

  it("反向換算（只用在顯示）大致對得回去", () => {
    assert.equal(toForeignAmount(53750, JPY), 2500);
    assert.equal(toForeignAmount(156000, USD), 5000);
  });

  it("不合法的匯率會被擋下來", () => {
    assert.throws(() => assertRate({ foreignUnits: 0, baseMinor: 2150 }), DomainError);
    assert.throws(() => assertRate({ foreignUnits: -1, baseMinor: 2150 }), DomainError);
    assert.throws(() => assertRate({ foreignUnits: 100, baseMinor: 0 }), DomainError);
    assert.throws(() => assertRate({ foreignUnits: 1.5, baseMinor: 2150 }), DomainError);
    assert.throws(() => toBaseAmount(2500, { ...JPY, baseMinor: 0 }), DomainError);
  });

  it("金額大到會溢位時會被擋下來，而不是算出錯的數字", () => {
    assert.throws(() => toBaseAmount(Number.MAX_SAFE_INTEGER, JPY), DomainError);
  });
});

describe("V14 外幣分帳顯示", () => {
  it("Case 5：¥10,000 平分 → 各 ¥5,000", () => {
    // 本位幣分帳是 2150 / 2150（NT$21.50 each），攤回原幣應該是 5000 / 5000
    assert.deepEqual(allocateForeign(10000, [107500, 107500]), [5000, 5000]);
  });

  it("除不盡時加總仍然等於原幣總額（不會湊不回來）", () => {
    for (const total of [999, 1001, 12345, 7]) {
      const shares = allocateForeign(total, [1, 2]);
      assert.equal(shares.reduce((a, b) => a + b, 0), total, `總額 ${total} 攤不回來`);
    }
  });

  it("Case 6：A 付款 B 全額負擔 → B 的原幣份額就是全額", () => {
    assert.deepEqual(allocateForeign(2500, [0, 53750]), [0, 2500]);
  });

  it("本位幣負擔全部是 0 時不會除以 0", () => {
    assert.deepEqual(allocateForeign(2500, [0, 0]), [0, 0]);
  });

  it("結果可重現（同樣輸入永遠同樣輸出）", () => {
    const a = allocateForeign(1000, [333, 333, 334]);
    const b = allocateForeign(1000, [333, 333, 334]);
    assert.deepEqual(a, b);
    assert.equal(a.reduce((x, y) => x + y, 0), 1000);
  });
});

describe("V14 匯率的人話標示", () => {
  it("顯示成「100 JPY = 21.5 TWD」而不是「JPY 0.215」", () => {
    assert.equal(rateLabel(JPY, "TWD"), "100 JPY = 21.5 TWD");
    assert.equal(rateLabel(USD, "TWD"), "1 USD = 31.2 TWD");
    assert.equal(rateLabel(KRW, "TWD"), "1,000 KRW = 23.4 TWD");
  });

  it("整數匯率不會多出沒意義的小數", () => {
    assert.equal(rateLabel({ currency: "USD", foreignUnits: 1, baseMinor: 3000 }, "TWD"), "1 USD = 30 TWD");
  });

  it("日圓與韓元預設用 100 / 1000 當單位（避免少看一個零）", () => {
    assert.equal(suggestedUnits("JPY"), 100);
    assert.equal(suggestedUnits("KRW"), 1000);
    assert.equal(suggestedUnits("USD"), 1);
  });
});
