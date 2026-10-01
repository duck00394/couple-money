import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JOINT, entryValue, matchKeywords, matchText, normalizeKeyword, ownerLabel, ownerWhere,
  toOwnerId, toOwnerValue, totals, type KeywordRule,
} from "../../src/server/domain/purchase";

const $ = (n: number) => n * 100;
const A = "amy";
const B = "ben";
const members = [{ userId: A, nickname: "小艾" }, { userId: B, nickname: "阿本" }];
const d = (s: string) => new Date(`${s}T12:00:00+08:00`);

describe("V12：歸屬（共同／A／B）", () => {
  it("1. 表單值與資料庫值互轉：JOINT ↔ null", () => {
    assert.equal(toOwnerId(JOINT), null);
    assert.equal(toOwnerId(""), null);
    assert.equal(toOwnerId(null), null);
    assert.equal(toOwnerId(A), A);
    assert.equal(toOwnerValue(null), JOINT);
    assert.equal(toOwnerValue(A), A);
  });

  it("2. 顯示名稱：null = 共同，成員離開了也不會變空白", () => {
    assert.equal(ownerLabel(null, members), "共同");
    assert.equal(ownerLabel(A, members), "小艾");
    assert.equal(ownerLabel("ghost", members), "已離開的成員");
  });

  it("3. 三種篩選狀態要分清楚：不篩 / 只看共同 / 只看某個人", () => {
    assert.deepEqual(ownerWhere(undefined), {}, "歸屬的「全部」＝不加條件");
    assert.deepEqual(ownerWhere(""), {});
    assert.deepEqual(ownerWhere(null), {});
    assert.deepEqual(ownerWhere(JOINT), { ownerId: null }, "共同 ≠ 不篩");
    assert.deepEqual(ownerWhere(A), { ownerId: A });
  });
});

describe("V12：關鍵字比對", () => {
  const rules: KeywordRule[] = [
    { word: "吉伊卡哇", groupId: "g1", tagId: null },
    { word: "chiikawa", groupId: "g1", tagId: null },
    { word: "小八", groupId: "g1", tagId: "t-hachi" },
    { word: "ハチワレ", groupId: "g1", tagId: "t-hachi" },
    { word: "日向", groupId: "g2", tagId: "t-hinata" },
  ];

  it("1. 正規化：大小寫、全形、空白都不影響比對", () => {
    assert.equal(normalizeKeyword("Chiikawa"), "chiikawa");
    assert.equal(normalizeKeyword("ｃｈｉｉｋａｗａ"), "chiikawa");
    assert.equal(normalizeKeyword(" 吉伊 卡哇 "), "吉伊卡哇");
  });

  it("2. 比對的是名稱 + 店家 + 備註，金額與分類不參與", () => {
    assert.ok(matchText({ title: "一番賞", merchant: "Chiikawa 專賣店" }).includes("chiikawa"));
    assert.ok(matchText({ note: "小八的" }).includes("小八"));
    assert.equal(matchText({}), "");
  });

  it("3. 只命中作品 → tagId 為 null，由呼叫端換成預設角色", () => {
    const hit = matchKeywords(matchText({ title: "吉伊卡哇一番賞" }), rules);
    assert.equal(hit!.groupId, "g1");
    assert.equal(hit!.tagId, null);
    assert.equal(hit!.fallback, true);
  });

  it("4. 角色關鍵字優先於作品關鍵字", () => {
    const hit = matchKeywords(matchText({ title: "吉伊卡哇 小八吊飾" }), rules);
    assert.equal(hit!.tagId, "t-hachi");
    assert.equal(hit!.fallback, false);
  });

  it("5. 同時命中兩個角色 → 用比較長的關鍵字（愈長愈明確）", () => {
    const two: KeywordRule[] = [
      { word: "小八", groupId: "g1", tagId: "t-short" },
      { word: "小八吊飾", groupId: "g1", tagId: "t-long" },
    ];
    assert.equal(matchKeywords("小八吊飾", two)!.tagId, "t-long");
  });

  it("6. 沒命中回傳 null，畫面上就不提示", () => {
    assert.equal(matchKeywords(matchText({ title: "7-11" }), rules), null);
    assert.equal(matchKeywords("", rules), null);
    assert.equal(matchKeywords("吉伊卡哇", []), null);
  });

  it("7. 關鍵字永遠不判斷歸屬：回傳的結構裡根本沒有 owner", () => {
    const hit = matchKeywords(matchText({ title: "日向立牌" }), rules)!;
    assert.deepEqual(Object.keys(hit).sort(), ["fallback", "groupId", "tagId", "word"]);
  });
});

describe("V12：金額與件數", () => {
  const fromTx = (amount: number, deleted = false) => ({
    title: null, occurredAt: null, amount: null,
    transaction: { title: "記帳的名稱", occurredAt: d("2026-09-10"), amount, deletedAt: deleted ? new Date() : null },
  });
  const manual = (amount: number) => ({
    title: "手動的", occurredAt: d("2026-09-05"), amount, transaction: null,
  });

  it("1. 有交易時金額與日期一律讀交易的，本表那三欄不參與", () => {
    const v = entryValue({ title: "舊的", occurredAt: d("2020-01-01"), amount: $(1), transaction: fromTx($(250)).transaction });
    assert.equal(v.amount, $(250));
    assert.equal(v.title, "記帳的名稱");
    assert.equal(v.fromTransaction, true);
  });

  it("2. 沒有交易時讀自己的三欄", () => {
    const v = entryValue(manual($(420)));
    assert.equal(v.amount, $(420));
    assert.equal(v.title, "手動的");
    assert.equal(v.fromTransaction, false);
    assert.equal(v.voided, false);
  });

  it("3. 原始記帳作廢 → voided，但資料還在", () => {
    const v = entryValue(fromTx($(180), true));
    assert.equal(v.voided, true);
    assert.equal(v.amount, $(180), "金額仍然讀得到，只是不計入");
  });

  it("4. 加總一律排除已作廢的", () => {
    const vs = [fromTx($(250)), fromTx($(180), true), manual($(420))].map(entryValue);
    assert.deepEqual(totals(vs), { count: 2, amount: $(670) });
  });

  it("5. 全部作廢 → 0 件 0 元，不會變成負的或 NaN", () => {
    assert.deepEqual(totals([fromTx($(100), true)].map(entryValue)), { count: 0, amount: 0 });
    assert.deepEqual(totals([]), { count: 0, amount: 0 });
  });

  it("6. 各歸屬加起來等於全部（零和，不會有紀錄掉出去）", () => {
    const rows = [
      { owner: null, v: entryValue(manual($(100))) },
      { owner: A, v: entryValue(manual($(200))) },
      { owner: B, v: entryValue(manual($(300))) },
      { owner: A, v: entryValue(fromTx($(999), true)) },
    ];
    const all = totals(rows.map((r) => r.v));
    const sum = [null, A, B]
      .map((o) => totals(rows.filter((r) => r.owner === o).map((r) => r.v)))
      .reduce((a, t) => ({ count: a.count + t.count, amount: a.amount + t.amount }), { count: 0, amount: 0 });
    assert.deepEqual(sum, all);
  });
});
