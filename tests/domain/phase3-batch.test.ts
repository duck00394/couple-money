import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertBatchAction, BATCH_ACTIONS, BATCH_ACTION_LABEL, MAX_BATCH, normalizeSelection } from "../../src/server/domain/batch";
import { DomainError } from "../../src/server/domain/errors";

const fails = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof DomainError && e.code === code);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `tx${i}`);

describe("Phase 3-4 F：批次操作（純邏輯）", () => {
  it("一次最多 50 筆，超過由 server 端擋下來", () => {
    assert.equal(MAX_BATCH, 50);
    assert.equal(normalizeSelection(ids(MAX_BATCH)).length, MAX_BATCH);
    fails(() => normalizeSelection(ids(MAX_BATCH + 1)), "BATCH_TOO_MANY");
    fails(() => normalizeSelection(ids(500)), "BATCH_TOO_MANY");
  });

  it("沒有選取任何一筆會被擋下來", () => {
    fails(() => normalizeSelection([]), "BATCH_EMPTY");
    fails(() => normalizeSelection(undefined), "BATCH_EMPTY");
    fails(() => normalizeSelection(null), "BATCH_EMPTY");
    fails(() => normalizeSelection(["", "  ", "\t"]), "BATCH_EMPTY");
  });

  it("重複的 id 只算一次，順序保留第一次出現的位置", () => {
    assert.deepEqual(normalizeSelection(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
    // 去重之後剛好 50 筆是可以的
    assert.equal(normalizeSelection([...ids(MAX_BATCH), ...ids(MAX_BATCH)]).length, MAX_BATCH);
  });

  it("格式不對的 id 會被擋下來（不會直接丟進資料庫查詢）", () => {
    fails(() => normalizeSelection(["a", "../../etc/passwd"]), "BATCH_ID");
    fails(() => normalizeSelection(["a", "' OR 1=1 --"]), "BATCH_ID");
    fails(() => normalizeSelection(["a", "x".repeat(65)]), "BATCH_ID");
    fails(() => normalizeSelection(["a b"]), "BATCH_ID");
    // 一般的 cuid 與含底線、減號的 id 可以
    assert.deepEqual(normalizeSelection([" cmu8nzxek002v7d9tz8gwkvx7 ", "a-b_c"]), ["cmu8nzxek002v7d9tz8gwkvx7", "a-b_c"]);
  });

  it("只支援刪除、改分類、加標籤三種批次操作", () => {
    assert.deepEqual([...BATCH_ACTIONS], ["DELETE", "CATEGORY", "TAGS"]);
    for (const a of BATCH_ACTIONS) {
      assert.equal(assertBatchAction(a), a);
      assert.ok(BATCH_ACTION_LABEL[a].length > 0);
    }
    // 金額、日期、帳戶、分帳、型別都不可以批次改
    for (const bad of ["AMOUNT", "DATE", "ACCOUNT", "SPLIT", "TYPE", "PAYMENT", "", "delete"]) {
      fails(() => assertBatchAction(bad), "BATCH_ACTION");
    }
  });
});
