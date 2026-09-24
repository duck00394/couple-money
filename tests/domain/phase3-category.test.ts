import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCategoryKind, assertCategoryName, CATEGORY_ICONS, CATEGORY_KINDS, CATEGORY_NAME_MAX,
  categoryNameKey, normalizeCategoryIcon, normalizeCategoryName,
} from "../../src/server/domain/category";
import { DomainError } from "../../src/server/domain/errors";

const fails = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof DomainError && e.code === code);

describe("Phase 3-4 D：分類管理（純邏輯）", () => {
  it("名稱去掉前後空白，中間連續空白收成一個", () => {
    assert.equal(normalizeCategoryName("  寵物  "), "寵物");
    assert.equal(normalizeCategoryName("寵物　用品"), "寵物 用品");
    assert.equal(normalizeCategoryName("寵物   用品"), "寵物 用品");
    assert.equal(normalizeCategoryName("\n外食\t"), "外食");
  });

  it("空白名稱與超長名稱會被擋下來", () => {
    fails(() => assertCategoryName(""), "CATEGORY_NAME");
    fails(() => assertCategoryName("   "), "CATEGORY_NAME");
    fails(() => assertCategoryName("　　"), "CATEGORY_NAME");
    fails(() => assertCategoryName("\t\n"), "CATEGORY_NAME");
    fails(() => assertCategoryName("超".repeat(CATEGORY_NAME_MAX + 1)), "CATEGORY_NAME");
    assert.equal(assertCategoryName("超".repeat(CATEGORY_NAME_MAX)).length, CATEGORY_NAME_MAX);
    assert.equal(assertCategoryName("  寵物 "), "寵物");
  });

  it("重複判斷忽略大小寫與空白差異", () => {
    assert.equal(categoryNameKey("寵物"), categoryNameKey(" 寵物 "));
    assert.equal(categoryNameKey("寵 物"), categoryNameKey("寵物"));
    assert.equal(categoryNameKey("Pet"), categoryNameKey("pet"));
    assert.equal(categoryNameKey("PET  "), categoryNameKey("pet"));
    assert.notEqual(categoryNameKey("寵物"), categoryNameKey("寵物用品"));
  });

  it("類型只有支出與收入", () => {
    assert.deepEqual([...CATEGORY_KINDS], ["EXPENSE", "INCOME"]);
    assert.equal(assertCategoryKind("EXPENSE"), "EXPENSE");
    assert.equal(assertCategoryKind("INCOME"), "INCOME");
    fails(() => assertCategoryKind("TRANSFER"), "CATEGORY_KIND");
    fails(() => assertCategoryKind(""), "CATEGORY_KIND");
  });

  it("圖示只接受清單裡的，其他一律用預設值（不會變成任意字串）", () => {
    assert.equal(normalizeCategoryIcon("utensils"), "utensils");
    assert.equal(normalizeCategoryIcon(" 🍜 "), "utensils");
    assert.equal(normalizeCategoryIcon("<script>"), CATEGORY_ICONS[0]);
    assert.equal(normalizeCategoryIcon(""), CATEGORY_ICONS[0]);
    assert.equal(normalizeCategoryIcon(null), CATEGORY_ICONS[0]);
    assert.equal(normalizeCategoryIcon(undefined), CATEGORY_ICONS[0]);
    // 圖示存的是 lucide 的 icon key（不是 emoji），所以只檢查數量與格式
    assert.ok(CATEGORY_ICONS.length >= 20 && CATEGORY_ICONS.every((i) => /^[a-z][a-z-]*$/.test(i)));
  });
});
