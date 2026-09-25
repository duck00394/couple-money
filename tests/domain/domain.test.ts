import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocate, formatMoney, parseAmount, sum } from "../../src/lib/money";
import { computeSplit, resolveDefaultRule } from "../../src/server/domain/split";
import {
  buildBalanceLines,
  buildFlowLines,
  buildSettlementLines,
  buildTransferLines,
} from "../../src/server/domain/ledger";
import {
  accountBalances,
  maxSettleAmount,
  netPositions,
  suggestSettlements,
  type LedgerTx,
} from "../../src/server/domain/balance";
import { DomainError } from "../../src/server/domain/errors";

const $ = (n: number) => n * 100;
const ME = "me";
const YOU = "you";
const meCash = { id: "a-me", ownerId: ME };
const youCard = { id: "a-you", ownerId: YOU };
const joint = { id: "a-joint", ownerId: null };
const half = { method: "EQUAL" as const, participants: [{ userId: ME }, { userId: YOU }] };

describe("money", () => {
  it("parseAmount", () => {
    assert.equal(parseAmount("1,234"), 123400);
    assert.equal(parseAmount("$1,234.5"), 123450);
    assert.equal(parseAmount("0.01"), 1);
    assert.equal(parseAmount("12.345"), null);
    assert.equal(parseAmount("-5"), null);
    assert.equal(parseAmount("abc"), null);
    assert.equal(parseAmount(""), null);
  });
  it("formatMoney", () => {
    assert.equal(formatMoney(123400), "$1,234");
    assert.equal(formatMoney(123450), "$1,234.50");
    assert.equal(formatMoney(-5000), "-$50");
    assert.equal(formatMoney(5000, { sign: true }), "+$50");
  });
  it("allocate 總和永遠等於 total（隨機 2,000 次）", () => {
    for (let k = 0; k < 2000; k++) {
      const total = Math.floor(Math.random() * 10_000_000) * (k % 5 === 0 ? -1 : 1);
      const n = 1 + Math.floor(Math.random() * 6);
      const w = Array.from({ length: n }, () => Math.floor(Math.random() * 100));
      if (sum(w) === 0) w[0] = 1;
      const r = allocate(total, w);
      assert.equal(sum(r), total);
      w.forEach((wi, i) => wi === 0 && assert.equal(r[i], 0));
    }
  });
  it("allocate 尾差：$100 三人平分 = 33.34 / 33.33 / 33.33", () => {
    assert.deepEqual(allocate(10000, [1, 1, 1]), [3334, 3333, 3333]);
  });
});

describe("split", () => {
  it("50/50", () => {
    assert.deepEqual(computeSplit($(1001), half), [
      { userId: ME, amount: 50050 },
      { userId: YOU, amount: 50050 },
    ]);
  });
  it("自訂比例 70/30、比例總和錯誤會擋", () => {
    const r = computeSplit($(1000), { method: "RATIO", participants: [{ userId: ME, value: 70 }, { userId: YOU, value: 30 }] });
    assert.deepEqual(r.map((x) => x.amount), [$(700), $(300)]);
    assert.throws(
      () => computeSplit($(1000), { method: "RATIO", participants: [{ userId: ME, value: 70 }, { userId: YOU, value: 20 }] }),
      (e: unknown) => e instanceof DomainError && e.code === "SPLIT_RATIO_SUM",
    );
    const third = computeSplit($(100), { method: "RATIO", participants: [{ userId: ME, value: 33.33 }, { userId: YOU, value: 66.67 }] });
    assert.equal(sum(third.map((x) => x.amount)), $(100));
  });
  it("自訂金額必須等於總額", () => {
    const r = computeSplit($(1000), { method: "AMOUNT", participants: [{ userId: ME, value: $(300) }, { userId: YOU, value: $(700) }] });
    assert.deepEqual(r.map((x) => x.amount), [$(300), $(700)]);
    assert.throws(() => computeSplit($(1000), { method: "AMOUNT", participants: [{ userId: ME, value: $(300) }, { userId: YOU, value: $(600) }] }));
  });
  it("一方全付、份數", () => {
    assert.deepEqual(computeSplit($(500), { method: "FULL", participants: [{ userId: YOU }] }), [{ userId: YOU, amount: $(500) }]);
    const r = computeSplit($(900), { method: "SHARES", participants: [{ userId: ME, value: 2 }, { userId: YOU, value: 1 }] });
    assert.deepEqual(r.map((x) => x.amount), [$(600), $(300)]);
  });
  it("預設規則：分類規則優先，成員不符則退回平均", () => {
    const rent = { method: "RATIO" as const, participants: [{ userId: ME, value: 40 }, { userId: YOU, value: 60 }] };
    assert.equal(resolveDefaultRule([null, rent], [ME, YOU]), rent);
    const stale = { method: "FULL" as const, participants: [{ userId: "ex" }] };
    assert.equal(resolveDefaultRule([stale], [ME, YOU]).method, "EQUAL");
  });
});

function tx(type: LedgerTx["type"], lines: { payments: LedgerTx["payments"]; splits: LedgerTx["splits"] }): LedgerTx {
  return { type, ...lines };
}

describe("記帳 → 分帳 → 結算（需求範例）", () => {
  // 我代付 $3,000、另一半代付 $1,000，都是 50/50 共同消費
  const txs: LedgerTx[] = [
    tx("EXPENSE", buildFlowLines("EXPENSE", $(3000), [{ account: meCash, amount: $(3000) }], half)),
    tx("EXPENSE", buildFlowLines("EXPENSE", $(1000), [{ account: youCard, amount: $(1000) }], half)),
  ];

  it("另一半欠我 $1,000", () => {
    const net = netPositions(txs, [ME, YOU]);
    assert.equal(net.get(ME), $(1000));
    assert.equal(net.get(YOU), -$(1000));
    assert.deepEqual(suggestSettlements(net), [{ from: YOU, to: ME, amount: $(1000) }]);
    assert.equal(maxSettleAmount(net, YOU, ME), $(1000));
    assert.equal(maxSettleAmount(net, ME, YOU), 0, "反方向不能結算");
  });

  it("部分結算 $400 後剩 $600，全額結算後清零", () => {
    const partial = [...txs, tx("SETTLEMENT", buildSettlementLines($(400), youCard, meCash))];
    assert.equal(netPositions(partial).get(YOU), -$(600));
    const full = [...partial, tx("SETTLEMENT", buildSettlementLines($(600), youCard, meCash))];
    const net = netPositions(full, [ME, YOU]);
    assert.equal(net.get(ME), 0);
    assert.equal(net.get(YOU), 0);
    assert.deepEqual(suggestSettlements(net), []);
    // 帳戶餘額：我 -3000 + 1000 = -2000；你 -1000 - 1000 = -2000（每人實際負擔 2000）
    const bal = accountBalances(full);
    assert.equal(bal.get("a-me"), -$(2000));
    assert.equal(bal.get("a-you"), -$(2000));
  });
});

describe("退款、收入、轉帳、共同帳戶", () => {
  it("退款沖銷負擔：我付 $1,000 共同，退回 $400 到我帳戶 → 對方欠 $300", () => {
    const txs = [
      tx("EXPENSE", buildFlowLines("EXPENSE", $(1000), [{ account: meCash, amount: $(1000) }], half)),
      tx("REFUND", buildFlowLines("REFUND", $(400), [{ account: meCash, amount: $(400) }], half)),
    ];
    assert.equal(netPositions(txs).get(YOU), -$(300));
    assert.equal(accountBalances(txs).get("a-me"), -$(600));
  });

  it("個人收入不影響欠款", () => {
    const t = tx("INCOME", buildFlowLines("INCOME", $(50000), [{ account: meCash, amount: $(50000) }], { method: "FULL", participants: [{ userId: ME }] }));
    assert.equal(netPositions([t]).get(ME), 0);
    assert.equal(accountBalances([t]).get("a-me"), $(50000));
  });

  it("轉帳：Transfer Out + Transfer In，餘額移動但不影響欠款", () => {
    const t = tx("TRANSFER", buildTransferLines($(2000), meCash, joint));
    assert.equal(accountBalances([t]).get("a-me"), -$(2000));
    assert.equal(accountBalances([t]).get("a-joint"), $(2000));
    assert.equal(netPositions([t]).get(ME) ?? 0, 0);
    assert.throws(() => buildTransferLines($(1), meCash, meCash));
  });

  it("共同帳戶付款：不產生個人欠款（決策 C1）", () => {
    const t = tx("EXPENSE", buildFlowLines("EXPENSE", $(800), [{ account: joint, amount: $(800) }], { method: "RATIO", participants: [{ userId: ME, value: 70 }, { userId: YOU, value: 30 }] }));
    const net = netPositions([t], [ME, YOU]);
    assert.equal(net.get(ME), 0);
    assert.equal(net.get(YOU), 0);
    assert.throws(
      () => buildFlowLines("EXPENSE", $(800), [{ account: joint, amount: $(400) }, { account: meCash, amount: $(400) }], half),
      (e: unknown) => e instanceof DomainError && e.code === "TX_MIXED_SHARED",
    );
  });

  it("多人付款：我付 $600、你付 $400，50/50 → 你欠我 $100", () => {
    const t = tx("EXPENSE", buildFlowLines("EXPENSE", $(1000), [{ account: meCash, amount: $(600) }, { account: youCard, amount: $(400) }], half));
    assert.equal(netPositions([t]).get(YOU), -$(100));
  });

  it("期初餘額不影響欠款", () => {
    const t = tx("OPENING_BALANCE", buildBalanceLines("OPENING_BALANCE", $(3000), meCash));
    assert.equal(accountBalances([t]).get("a-me"), $(3000));
    assert.equal(netPositions([t]).get(ME) ?? 0, 0);
  });

  it("隨機交易：所有人淨額加總恆為 0", () => {
    const accts = [meCash, youCard];
    const txs: LedgerTx[] = [];
    for (let k = 0; k < 500; k++) {
      const amount = 1 + Math.floor(Math.random() * 1_000_000);
      const payer = accts[k % 2];
      const type = (["EXPENSE", "REFUND", "INCOME"] as const)[k % 3];
      const rule = { method: "RATIO" as const, participants: [{ userId: ME, value: k % 100 }, { userId: YOU, value: 100 - (k % 100) }] };
      txs.push(tx(type, buildFlowLines(type, amount, [{ account: payer, amount }], rule)));
    }
    const net = netPositions(txs);
    assert.equal((net.get(ME) ?? 0) + (net.get(YOU) ?? 0), 0);
  });
});
