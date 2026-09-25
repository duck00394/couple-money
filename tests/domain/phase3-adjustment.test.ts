import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBalanceLines, DEBT_TYPES, INCOME_EXPENSE_TYPES, TX_TYPE_LABEL, TX_TYPES } from "../../src/server/domain/ledger";
import { accountBalances, netPositions } from "../../src/server/domain/balance";
import { SEARCH_KINDS, SEARCH_KIND_LABEL, totalsFromGroups } from "../../src/server/domain/search";
import { categoryShares } from "../../src/server/domain/stats";
import { DomainError } from "../../src/server/domain/errors";
import { parseAmount, parseSignedAmount } from "../../src/lib/money";

const $ = (n: number) => n * 100;
const acc = { id: "acc1", ownerId: "amy" };

describe("Phase 3-4 C：餘額調整（純邏輯）", () => {
  it("往上調整：帳戶餘額增加，payment 是負的", () => {
    const lines = buildBalanceLines("ADJUSTMENT", $(500), acc);
    assert.equal(lines.splits.length, 0, "餘額調整不該有分帳");
    assert.deepEqual(lines.payments, [{ accountId: "acc1", userId: "amy", amount: -$(500) }]);
    assert.equal(accountBalances([{ type: "ADJUSTMENT", ...lines }]).get("acc1"), $(500));
  });

  it("往下調整：帳戶餘額減少", () => {
    const lines = buildBalanceLines("ADJUSTMENT", -$(300), acc);
    assert.deepEqual(lines.payments, [{ accountId: "acc1", userId: "amy", amount: $(300) }]);
    assert.equal(accountBalances([{ type: "ADJUSTMENT", ...lines }]).get("acc1"), -$(300));
  });

  it("調整金額不可以是 0，也不接受小數或非法數字", () => {
    for (const bad of [0, 1.5, NaN, Infinity]) {
      assert.throws(() => buildBalanceLines("ADJUSTMENT", bad, acc), (e: unknown) => e instanceof DomainError && e.code === "TX_AMOUNT");
    }
  });

  it("餘額調整不影響誰欠誰（不在 DEBT_TYPES）", () => {
    const lines = buildBalanceLines("ADJUSTMENT", $(9999), acc);
    assert.ok(!DEBT_TYPES.includes("ADJUSTMENT"));
    const net = netPositions([{ type: "ADJUSTMENT", ...lines }], ["amy", "ben"]);
    assert.equal(net.get("amy"), 0);
    assert.equal(net.get("ben"), 0);
  });

  it("餘額調整不算收支（不在 INCOME_EXPENSE_TYPES，也不進 totalsFromGroups 的金額）", () => {
    assert.ok(!INCOME_EXPENSE_TYPES.includes("ADJUSTMENT"));
    const t = totalsFromGroups([
      { type: "EXPENSE", count: 1, amount: $(1000) },
      { type: "ADJUSTMENT", count: 2, amount: $(50000) },
    ]);
    assert.equal(t.expense, $(1000));
    assert.equal(t.netExpense, $(1000));
    assert.equal(t.income, 0);
    assert.equal(t.transferCount, 0, "餘額調整不是轉帳");
    assert.equal(t.transferAmount, 0);
    assert.equal(t.count, 3, "筆數仍然照實算");
  });

  it("餘額調整不會被 /stats 的分類佔比算成一般消費", () => {
    const shares = categoryShares([
      { categoryId: "food", type: "EXPENSE", amount: $(300) },
      { categoryId: null, type: "ADJUSTMENT", amount: $(99999) },
    ]);
    assert.deepEqual(shares.map((c) => [c.categoryId, c.amount]), [["food", $(300)]]);
  });

  it("ADJUSTMENT 是既有型別，且看得懂、搜尋得到", () => {
    assert.ok(TX_TYPES.includes("ADJUSTMENT"));
    assert.equal(TX_TYPE_LABEL.ADJUSTMENT, "餘額調整");
    assert.ok(SEARCH_KINDS.includes("ADJUSTMENT"), "搜尋要找得到餘額調整");
    assert.equal(SEARCH_KIND_LABEL.ADJUSTMENT, "餘額調整");
  });

  it("實際餘額可以填負數（銀行透支、信用卡溢繳），但一般金額欄位仍然不接受負數", () => {
    assert.equal(parseSignedAmount("-8500"), -$(8500));
    assert.equal(parseSignedAmount("-1,234.56"), -123456);
    assert.equal(parseSignedAmount("$-250"), -$(250));
    assert.equal(parseSignedAmount("1234"), $(1234));
    assert.equal(parseSignedAmount("0"), 0, "調整成 0 是合法的");
    assert.equal(parseSignedAmount("abc"), null);
    assert.equal(parseSignedAmount("--1"), null);
    assert.equal(parseSignedAmount(""), null);
    assert.equal(parseAmount("-8500"), null, "既有的 parseAmount 行為不變（仍然不收負數）");
  });

  it("多筆調整可以疊加，且與其他交易一起算餘額", () => {
    const txs = [
      { type: "OPENING_BALANCE" as const, ...buildBalanceLines("OPENING_BALANCE", $(1000), acc) },
      { type: "ADJUSTMENT" as const, ...buildBalanceLines("ADJUSTMENT", -$(200), acc) },
      { type: "ADJUSTMENT" as const, ...buildBalanceLines("ADJUSTMENT", $(50), acc) },
    ];
    assert.equal(accountBalances(txs).get("acc1"), $(850));
  });
});
