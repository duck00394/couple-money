import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../../src/server/domain/errors";
import { buildFlowLines, buildTransferLines } from "../../src/server/domain/ledger";
import { assertEarmarkBacked, assertTransferable, freeAmount } from "../../src/server/domain/transfer";
import { assertRefundAmount, refundSplitRule, refundableAmount } from "../../src/server/domain/refund";
import { fromDateTime, hasTimeOfDay, toDateKey, toTimeKey } from "../../src/lib/dates";
import { sum } from "../../src/lib/money";

const $ = (n: number) => n * 100;
const acc = (over: Partial<Parameters<typeof assertTransferable>[0]> = {}) => ({
  id: "a1", name: "共同帳戶", isCard: false, balance: $(30000), earmarked: $(20000), ...over,
});
const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : "NOT_DOMAIN_ERROR";
  }
  return null;
};

describe("Phase 3-2 轉帳規則", () => {
  it("可自由使用金額 = 餘額 − 已指定給基金", () => {
    assert.equal(freeAmount({ balance: $(30000), earmarked: $(20000) }), $(10000));
    assert.equal(freeAmount({ balance: $(500), earmarked: 0 }), $(500));
  });

  it("基金指定的錢不能被轉走（餘額 $30,000、指定 $20,000 → 只能轉 $10,000）", () => {
    const from = acc();
    const to = acc({ id: "a2", name: "阿本現金", balance: 0, earmarked: 0 });
    assert.doesNotThrow(() => assertTransferable(from, to, $(10000)));
    assert.equal(code(() => assertTransferable(from, to, $(10001))), "TRANSFER_OVER_FREE");
    assert.equal(code(() => assertTransferable(from, to, $(15000))), "TRANSFER_OVER_FREE");
    // 訊息要說清楚為什麼不行
    try {
      assertTransferable(from, to, $(15000));
    } catch (e) {
      const m = (e as DomainError).message;
      assert.ok(m.includes("$20,000") && m.includes("$10,000") && m.includes("基金"), m);
    }
  });

  it("超過餘額、相同帳戶、金額 <= 0、信用卡轉出都被擋", () => {
    const from = acc({ balance: $(1000), earmarked: 0 });
    const to = acc({ id: "a2", name: "銀行", balance: 0, earmarked: 0 });
    assert.equal(code(() => assertTransferable(from, to, $(1001))), "TRANSFER_OVER_BALANCE");
    assert.doesNotThrow(() => assertTransferable(from, to, $(1000)));
    assert.equal(code(() => assertTransferable(from, from, $(1))), "TRANSFER_SAME");
    assert.equal(code(() => assertTransferable(from, to, 0)), "TX_AMOUNT");
    assert.equal(code(() => assertTransferable(from, to, -$(100))), "TX_AMOUNT");
    assert.equal(code(() => assertTransferable(from, to, 10.5)), "TX_AMOUNT");
    assert.equal(code(() => assertTransferable(acc({ isCard: true, earmarked: 0, balance: -$(1500) }), to, $(100))), "TRANSFER_FROM_CARD");
    // 轉入信用卡（繳卡費）可以
    assert.doesNotThrow(() => assertTransferable(from, acc({ id: "card", isCard: true, balance: -$(1500), earmarked: 0 }), $(1000)));
  });

  it("作廢轉帳前檢查：基金指定的金額仍要有實際餘額對應", () => {
    assert.doesNotThrow(() => assertEarmarkBacked([acc({ balance: $(20000), earmarked: $(20000) })]));
    assert.equal(code(() => assertEarmarkBacked([acc({ balance: $(19999), earmarked: $(20000) })])), "TRANSFER_EARMARK_BACKING");
    // 沒有基金指定的帳戶（例如信用卡）餘額為負也沒關係
    assert.doesNotThrow(() => assertEarmarkBacked([acc({ isCard: true, balance: -$(1500), earmarked: 0 })]));
  });

  it("轉帳分錄：Σpayment = 0、沒有分帳、不影響誰欠誰", () => {
    const lines = buildTransferLines($(5000), { id: "a1", ownerId: "u1" }, { id: "a2", ownerId: null });
    assert.equal(sum(lines.payments.map((p) => p.amount)), 0);
    assert.equal(lines.splits.length, 0);
    assert.deepEqual(lines.payments.map((p) => p.amount), [$(5000), -$(5000)]);
  });

  it("日期 + 時間：沒填時間用當地中午，填了就照時間存", () => {
    assert.equal(toDateKey(fromDateTime("2026-09-18", "")), "2026-09-18");
    assert.equal(toTimeKey(fromDateTime("2026-09-18", "")), "12:00");
    assert.equal(hasTimeOfDay(fromDateTime("2026-09-18", "")), false);
    assert.equal(toTimeKey(fromDateTime("2026-09-18", "23:30")), "23:30");
    assert.equal(toDateKey(fromDateTime("2026-09-18", "00:05")), "2026-09-18");
    assert.equal(hasTimeOfDay(fromDateTime("2026-09-18", "09:00")), true);
    assert.throws(() => fromDateTime("2026-09-18", "25:00"));
    assert.throws(() => fromDateTime("2026-13-01", "10:00"));
  });
});

describe("Phase 3-2 退款規則", () => {
  it("可退款金額 = 原始金額 − 已退款", () => {
    assert.equal(refundableAmount({ amount: $(1000), refunded: 0 }), $(1000));
    assert.equal(refundableAmount({ amount: $(1000), refunded: $(300) }), $(700));
    assert.equal(refundableAmount({ amount: $(1000), refunded: $(1000) }), 0);
  });

  it("退款上限：$1,000 已退 $300 → 最多再退 $700", () => {
    const s = { amount: $(1000), refunded: $(300) };
    assert.doesNotThrow(() => assertRefundAmount(s, $(700)));
    assert.equal(code(() => assertRefundAmount(s, $(701))), "REFUND_OVER_LIMIT");
    assert.equal(code(() => assertRefundAmount(s, 0)), "REFUND_AMOUNT");
    assert.equal(code(() => assertRefundAmount(s, -$(100))), "REFUND_AMOUNT");
    assert.equal(code(() => assertRefundAmount({ amount: $(1000), refunded: $(1000) }, $(1))), "REFUND_FULLY_REFUNDED");
    try {
      assertRefundAmount(s, $(800));
    } catch (e) {
      assert.ok((e as DomainError).message.includes("$700"), (e as DomainError).message);
    }
  });

  it("多次退款累計後的剩餘可退款金額", () => {
    const original = $(1000);
    let refunded = 0;
    for (const part of [$(300), $(200), $(500)]) {
      assert.doesNotThrow(() => assertRefundAmount({ amount: original, refunded }, part));
      refunded += part;
    }
    assert.equal(refundableAmount({ amount: original, refunded }), 0);
    assert.equal(code(() => assertRefundAmount({ amount: original, refunded }, $(1))), "REFUND_FULLY_REFUNDED");
  });

  it("退款分帳依原始比例回沖（我 $400 / 另一半 $600，退 $300 → $120 / $180）", () => {
    const rule = refundSplitRule([{ userId: "me", amount: $(400) }, { userId: "you", amount: $(600) }], $(300));
    assert.equal(rule.method, "AMOUNT");
    assert.deepEqual(rule.participants, [{ userId: "me", value: $(120) }, { userId: "you", value: $(180) }]);
    assert.equal(sum(rule.participants.map((p) => p.value!)), $(300));
  });

  it("一方全付的退款全部回沖給那個人；除不盡也不會多一分少一分", () => {
    const full = refundSplitRule([{ userId: "me", amount: $(200) }], $(50));
    assert.deepEqual(full.participants, [{ userId: "me", value: $(50) }]);
    const odd = refundSplitRule([{ userId: "me", amount: 1 }, { userId: "you", amount: 2 }], 100);
    assert.equal(sum(odd.participants.map((p) => p.value!)), 100);
  });

  it("退款分錄：金流與負擔都是負的，Σpayment = Σsplit = −金額", () => {
    const rule = refundSplitRule([{ userId: "me", amount: $(400) }, { userId: "you", amount: $(600) }], $(300));
    const lines = buildFlowLines("REFUND", $(300), [{ account: { id: "card", ownerId: "me" }, amount: $(300) }], rule);
    assert.equal(sum(lines.payments.map((p) => p.amount)), -$(300));
    assert.equal(sum(lines.splits.map((s) => s.amount)), -$(300));
    // 我收到 $300 但只有 $120 是我的負擔 → 欠另一半 $180
    const net = lines.payments.reduce((a, p) => a + p.amount, 0) - lines.splits.find((s) => s.userId === "me")!.amount;
    assert.equal(net, -$(180));
  });
});
