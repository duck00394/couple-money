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
  basePerUnit,
  parseRatePair,
  rateLabel,
  toBaseAmount,
  toForeignAmount,
} from "../../src/server/domain/exchange";
import { DomainError } from "../../src/server/domain/errors";
import { formatMoney, homeApprox, moneyFmt, sumHomeMinor, toHomeMinor } from "../../src/lib/money";
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

describe("V16 匯率一律是「1 外幣 = ? 本位幣」", () => {
  it("顯示方向固定是 1 個外幣，不管存的是 100 還是 1", () => {
    // 同一個匯率，不管存成 1:0.215 還是 100:21.5，畫面都是「1 JPY = 0.215 TWD」
    assert.equal(rateLabel(JPY, "TWD"), "1 JPY = 0.215 TWD");
    assert.equal(rateLabel({ currency: "JPY", foreignUnits: 1, baseMinor: 22 }, "TWD"), "1 JPY = 0.22 TWD");
    assert.equal(rateLabel(USD, "TWD"), "1 USD = 31.2 TWD");
    assert.equal(rateLabel(KRW, "TWD"), "1 KRW = 0.0234 TWD");
  });

  it("整數匯率不會多出沒意義的小數", () => {
    assert.equal(rateLabel({ currency: "USD", foreignUnits: 1, baseMinor: 3000 }, "TWD"), "1 USD = 30 TWD");
    assert.equal(basePerUnit({ foreignUnits: 1, baseMinor: 10000 }, "TWD"), "100");
  });

  it("輸入 0.22 就存成 1 : 22（台幣表示得下，不用放大）", () => {
    assert.deepEqual(parseRatePair("0.22", "TWD"), { foreignUnits: 1, baseMinor: 22 });
    assert.equal(basePerUnit(parseRatePair("0.22", "TWD")!, "TWD"), "0.22");
  });

  it("小數位數超過台幣的分時，左右同時放大，比值不變", () => {
    // 1 JPY = 0.2185 TWD：台幣只到分，所以存成 100 JPY = 21.85 TWD
    const r = parseRatePair("0.2185", "TWD")!;
    assert.deepEqual(r, { foreignUnits: 100, baseMinor: 2185 });
    // 使用者看到的還是他輸入的那個數字
    assert.equal(basePerUnit(r, "TWD"), "0.2185");
    // 而且換算結果跟「放大前」完全一致：¥10,000 × 0.2185 = NT$2,185
    assert.equal(toBaseAmount(10000, { currency: "JPY", ...r }), 218500);
  });

  it("整數與一位小數都補成台幣最小單位", () => {
    assert.deepEqual(parseRatePair("31.2", "TWD"), { foreignUnits: 1, baseMinor: 3120 });
    assert.deepEqual(parseRatePair("30", "TWD"), { foreignUnits: 1, baseMinor: 3000 });
    assert.deepEqual(parseRatePair("0.2", "TWD"), { foreignUnits: 1, baseMinor: 20 });
  });

  it("本位幣是日圓（沒有小數）時也成立：1 TWD = 4.5 JPY", () => {
    const r = parseRatePair("4.5", "JPY")!;
    assert.deepEqual(r, { foreignUnits: 10, baseMinor: 45 });
    assert.equal(basePerUnit(r, "JPY"), "4.5");
    // NT$100（10000 最小單位）→ ¥450
    assert.equal(toBaseAmount(10000, { currency: "TWD", ...r }), 450);
  });

  it("逗號與結尾的 0 都吃得下", () => {
    assert.deepEqual(parseRatePair("0.2200", "TWD"), { foreignUnits: 1, baseMinor: 22 });
    assert.deepEqual(parseRatePair("1,234.5", "TWD"), { foreignUnits: 1, baseMinor: 123450 });
  });

  it("亂打的東西回傳 null，而不是存成奇怪的匯率", () => {
    for (const bad of ["", " ", ".", "abc", "0", "0.00", "-0.22", "1.2.3", "0.1234567"]) {
      assert.equal(parseRatePair(bad, "TWD"), null, `「${bad}」竟然通過了`);
    }
  });

  it("parseRatePair 出來的東西一定過得了 assertRate", () => {
    for (const text of ["0.22", "0.2185", "31.2", "1000", "0.000001"]) {
      const r = parseRatePair(text, "TWD");
      assert.ok(r, `${text} 應該要解析得出來`);
      assertRate(r!);
    }
  });
});

describe("V16 帳本本位幣的顯示", () => {
  it("日圓帳本用 ¥ 而且不顯示小數（金額仍然存成 1/100）", () => {
    // 輸入 2000 → 200000 最小單位 → 顯示 ¥2,000（不是 $2,000，也不是 ¥200,000）
    assert.equal(formatMoney(200000, { currency: "JPY" }), "¥2,000");
    assert.equal(formatMoney(53750, { currency: "JPY" }), "¥538");
    assert.equal(formatMoney(0, { currency: "JPY" }), "¥0");
  });

  it("韓元同理", () => {
    assert.equal(formatMoney(1000000, { currency: "KRW" }), "₩10,000");
  });

  it("台幣行為完全不變（既有畫面不受影響）", () => {
    assert.equal(formatMoney(200000), "$2,000");
    // 台幣維持裸的 $（既有畫面不變）；NT$ 只出現在 homeApprox 那一行
    assert.equal(formatMoney(200000, { currency: "TWD" }), "$2,000");
    assert.equal(formatMoney(53750), "$537.50");
    assert.equal(formatMoney(-1234), "-$12.34");
    assert.equal(formatMoney(1234, { sign: true }), "+$12.34");
  });

  it("moneyFmt 綁好幣別之後行為一致", () => {
    const jpy = moneyFmt("JPY");
    assert.equal(jpy(200000), "¥2,000");
    assert.equal(jpy(200000, { sign: true }), "+¥2,000");
  });

  it("換回台幣只是參考值：100 JPY = 21.5 TWD 時 ¥85,400 ≈ NT$18,361", () => {
    assert.equal(homeApprox(8540000, { units: 100, minor: 2150 }), "NT$18,361");
  });

  it("沒有設匯率就不顯示那一行", () => {
    assert.equal(homeApprox(200000, null), null);
    assert.equal(homeApprox(200000, { units: 0, minor: 2150 }), null);
    assert.equal(homeApprox(200000, { units: 100, minor: 0 }), null);
  });
});

describe("V16：台幣參考總額用每一筆自己的匯率", () => {
  /** 1 JPY = 0.21 TWD */
  const r21 = { units: 1, minor: 21 };
  /** 1 JPY = 0.22 TWD */
  const r22 = { units: 1, minor: 22 };
  /** 1 JPY = 0.23 TWD（「現在」的匯率） */
  const r23 = { units: 1, minor: 23 };
  /** ¥5,000（金額一律存成本位幣的 1/100） */
  const Y5000 = 500000;

  it("單筆：¥5,000 ＠ 0.21 → NT$1,050", () => {
    assert.equal(toHomeMinor(Y5000, r21), 105000);
    assert.equal(homeApprox(Y5000, r21), "NT$1,050");
    assert.equal(homeApprox(Y5000, r22), "NT$1,100");
  });

  it("★ 兩筆各自鎖著不同匯率 → 總額 NT$2,150，不是用現在的匯率重算的 NT$2,300", () => {
    const total = sumHomeMinor(
      [
        { amount: Y5000, homeRate: r21 },
        { amount: Y5000, homeRate: r22 },
      ],
      r23, // 現在的匯率，不該被用到
    );
    assert.equal(total, 215000);
    assert.equal(formatMoney(total!, { symbol: "NT$" }), "NT$2,150");
    // 用現在的匯率一次換算整筆總額的話會是 NT$2,300 —— 這正是要避免的
    assert.equal(toHomeMinor(Y5000 * 2, r23), 230000);
  });

  it("退款是負的，會從總額裡扣掉（用退款當下的匯率）", () => {
    const total = sumHomeMinor(
      [
        { amount: Y5000, homeRate: r21 }, // +NT$1,050
        { amount: -200000, homeRate: r22 }, // ¥2,000 退款 → −NT$440
      ],
      null,
    );
    assert.equal(total, 105000 - 44000);
  });

  it("舊資料沒有鎖匯率時退回帳本目前的匯率（不是整行消失）", () => {
    assert.equal(sumHomeMinor([{ amount: Y5000, homeRate: null }], r23), 115000);
  });

  it("本位幣就是台幣（沒有任何匯率）時回傳 null，畫面就不畫那一行", () => {
    assert.equal(sumHomeMinor([{ amount: Y5000, homeRate: null }], null), null);
    assert.equal(sumHomeMinor([], r21), null);
    assert.equal(toHomeMinor(Y5000, null), null);
  });

  it("加總順序不影響結果，而且全程整數", () => {
    const rows = [
      { amount: 123456, homeRate: r21 },
      { amount: 777, homeRate: r22 },
      { amount: -999, homeRate: r23 },
    ];
    const a = sumHomeMinor(rows, null)!;
    const b = sumHomeMinor([...rows].reverse(), null)!;
    assert.equal(a, b);
    assert.ok(Number.isSafeInteger(a));
  });
});
