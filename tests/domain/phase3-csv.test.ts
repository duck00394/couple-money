import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentDisposition, csvAmount, csvCell, csvFileName, CSV_BOM, toCsv } from "../../src/server/domain/csv";

describe("Phase 3-4 G：CSV 產生（純邏輯）", () => {
  it("金額是純數字、固定兩位小數、負號在最前面", () => {
    assert.equal(csvAmount(0), "0.00");
    assert.equal(csvAmount(100), "1.00");
    assert.equal(csvAmount(123456), "1234.56");
    assert.equal(csvAmount(-123456), "-1234.56");
    assert.equal(csvAmount(-50), "-0.50", "小於一元的負數也要有負號");
    assert.equal(csvAmount(5), "0.05");
    assert.equal(csvAmount(-5), "-0.05");
    assert.equal(csvAmount(200000000), "2000000.00");
    // 沒有 $ 與千分位，試算表才算得動
    for (const v of [0, 100, -123456, 999999]) assert.ok(/^-?\d+\.\d{2}$/.test(csvAmount(v)), `${v}`);
  });

  it("逗號、雙引號、換行都依 RFC 4180 處理", () => {
    assert.equal(csvCell("火鍋"), "火鍋");
    assert.equal(csvCell("王品, 台北"), '"王品, 台北"');
    assert.equal(csvCell('他說「"好"」'), '"他說「""好""」"');
    assert.equal(csvCell("第一行\n第二行"), '"第一行\n第二行"');
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
    assert.equal(csvCell(0), "0");
  });

  it("公式注入會被擋下，但負數不受影響", () => {
    assert.equal(csvCell("=1+1"), "'=1+1");
    assert.equal(csvCell("+886912345678"), "'+886912345678");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvCell("-任務獎金"), "'-任務獎金");
    assert.equal(csvCell("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
    // 數字不會被加上單引號，否則試算表就算不動了
    assert.equal(csvCell("-1234.56"), "-1234.56");
    assert.equal(csvCell("-0.50"), "-0.50");
    assert.equal(csvCell(csvAmount(-999)), "-9.99");
  });

  it("有 UTF-8 BOM 與 CRLF（台灣的 Excel 才不會亂碼）", () => {
    const csv = toCsv(["日期", "名稱"], [["2026-09-20", "火鍋"]]);
    assert.ok(csv.startsWith(CSV_BOM), "要有 BOM");
    assert.equal(CSV_BOM, "﻿");
    assert.equal(csv, "﻿日期,名稱\r\n2026-09-20,火鍋\r\n");
    // BOM 之後就是正常的 UTF-8 中文
    assert.ok(Buffer.from(csv, "utf8").subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
    assert.ok(csv.includes("火鍋"));
  });

  it("沒有資料時只有一行標題（不是空檔）", () => {
    const csv = toCsv(["日期", "金額"], []);
    assert.equal(csv, "﻿日期,金額\r\n");
    assert.equal(csv.trimEnd().split("\r\n").length, 1);
  });

  it("每一列的欄位數都與標題一致", () => {
    const csv = toCsv(["a", "b", "c"], [["1", "王品, 台北", "3"], ["4", null, "6"]]);
    const lines = csv.replace(CSV_BOM, "").trimEnd().split("\r\n");
    assert.equal(lines.length, 3);
    // 用簡單的 CSV 解析檢查欄位數（引號內的逗號不算分隔）
    const cols = (line: string) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.length - 1;
    for (const l of lines) assert.equal(cols(l), 3, l);
  });

  it("檔名固定格式，好排序", () => {
    assert.equal(csvFileName("交易明細", "2026-09-20"), "couple-money-交易明細-2026-09-20.csv");
  });

  it("Content-Disposition 只含 ASCII（HTTP 標頭放不下中文），中文走 filename*", () => {
    const h = contentDisposition(csvFileName("transactions", "2026-09-20"), csvFileName("交易明細", "2026-09-20"));
    // 全部都必須是 Latin-1 以內的字元，否則 Response 會直接丟 TypeError
    for (const ch of h) assert.ok(ch.charCodeAt(0) <= 255, `標頭不可以有 ${ch}`);
    assert.ok(h.startsWith('attachment; filename="couple-money-transactions-2026-09-20.csv"'));
    const encoded = h.split("filename*=UTF-8''")[1];
    assert.equal(decodeURIComponent(encoded), "couple-money-交易明細-2026-09-20.csv");
  });
});
