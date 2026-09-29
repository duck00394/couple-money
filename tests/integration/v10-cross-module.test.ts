import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as transfers from "../../src/server/services/transfers";
import * as funds from "../../src/server/services/funds";
import * as preorders from "../../src/server/services/preorders";
import * as rewards from "../../src/server/services/rewards";
import * as tasks from "../../src/server/services/tasks";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;

/**
 * V10-13：跨模組財務安全檢查。
 *
 * 每個情境做完都跑同一組不變式（invariants），確保沒有任何一條路徑
 * 可以把帳做壞。這裡檢查的是「資料庫實際長出來的樣子」，不是 service 自己回報的數字，
 * 所以任何一邊算錯都會被抓到。
 */

type Couple = Awaited<ReturnType<typeof setupCouple>>;

/**
 * 十條不變式，全部直接查資料庫原始資料驗證。
 * 回傳一些算好的數字給情境自己再做額外斷言。
 */
async function invariants(c: Couple, label: string) {
  const bookId = c.ctxA.book.id;
  const where = { deletedAt: null, status: "POSTED" as const, bookId };

  const txs = await prisma.transaction.findMany({
    where,
    select: {
      id: true, type: true, amount: true,
      payments: { select: { accountId: true, amount: true } },
      splits: { select: { userId: true, amount: true } },
    },
  });

  // 1. 複式記帳：資料庫裡實際長出來的分錄要符合 domain/ledger.ts 的 checkInvariants。
  //    消費／收入／退款：Σpayment = Σsplit（誰付的 = 誰負擔的）
  //    轉帳／結算：Σpayment = 0 且沒有 split（錢只是換位置，不改變誰負擔）
  //    開帳／調整：沒有 split —— 沒有 split 才不會被 netPositions 算成憑空的欠款
  for (const t of txs) {
    const pay = t.payments.reduce((s, p) => s + p.amount, 0);
    const spl = t.splits.reduce((s, p) => s + p.amount, 0);
    const what = `${label}：交易 ${t.id}（${t.type}）`;
    if (t.type === "EXPENSE" || t.type === "INCOME" || t.type === "REFUND") {
      assert.equal(pay, spl, `${what} Σpayment ${pay} ≠ Σsplit ${spl}`);
    } else if (t.type === "TRANSFER" || t.type === "SETTLEMENT") {
      assert.equal(pay, 0, `${what} 轉帳／結算的 Σpayment 應為 0`);
      assert.equal(t.splits.length, 0, `${what} 轉帳／結算不該有分帳`);
    } else {
      assert.equal(t.splits.length, 0, `${what} 開帳／調整不該有分帳，否則會憑空生出欠款`);
    }
  }

  // 2. 帳戶餘額只由 payment 推導（資料庫沒有 balance 欄位可以對不起來）
  const accounts = await prisma.account.findMany({ where: { bookId, deletedAt: null }, select: { id: true, name: true } });
  const balance = new Map<string, number>();
  for (const a of accounts) balance.set(a.id, 0);
  for (const t of txs) for (const p of t.payments) balance.set(p.accountId, (balance.get(p.accountId) ?? 0) - p.amount);

  const { accounts: fromService, net } = await ledger.getBalances(c.ctxA);
  for (const a of accounts) {
    assert.equal(fromService.get(a.id) ?? 0, balance.get(a.id) ?? 0, `${label}：${a.name} 的餘額 service 與原始資料不一致`);
  }

  // 3. 欠款是零和：兩個人的淨額加起來一定是 0，不會憑空多出或蒸發
  const sumNet = [...net.values()].reduce((s, v) => s + v, 0);
  assert.equal(sumNet, 0, `${label}：欠款淨額總和應為 0，實際 ${sumNet}`);

  // 4. 基金金額 = Σ FundTransaction（REAL），而且不會是負的
  const entries = await prisma.fundTransaction.findMany({
    where: { bookId, deletedAt: null, type: { in: ["DEPOSIT", "WITHDRAW", "EXPENSE", "REWARD_DEPOSIT"] } },
    select: { fundId: true, accountId: true, amount: true },
  });
  const fundSum = new Map<string, number>();
  for (const e of entries) fundSum.set(e.fundId, (fundSum.get(e.fundId) ?? 0) + e.amount);
  const fromFundService = await funds.fundBalances(prisma, bookId);
  for (const [fundId, amount] of fundSum) {
    assert.equal(fromFundService.get(fundId) ?? 0, amount, `${label}：基金 ${fundId} 的金額對不起來`);
    assert.ok(amount >= 0, `${label}：基金 ${fundId} 變成負的 ${amount}`);
  }

  // 5. 基金指定的錢一定有帳戶的錢撐著：每個帳戶餘額 ≥ 已指定給基金的金額
  const earmark = new Map<string, number>();
  for (const e of entries) if (e.accountId) earmark.set(e.accountId, (earmark.get(e.accountId) ?? 0) + e.amount);
  for (const a of accounts) {
    const e = earmark.get(a.id) ?? 0;
    if (e <= 0) continue;
    assert.ok((balance.get(a.id) ?? 0) >= e,
      `${label}：${a.name} 餘額 ${balance.get(a.id)} < 已指定給基金 ${e}`);
  }

  // 6. 沒有任何金額是小數或超出安全整數
  for (const t of txs) {
    assert.ok(Number.isSafeInteger(t.amount), `${label}：交易金額不是整數 ${t.amount}`);
    for (const p of t.payments) assert.ok(Number.isSafeInteger(p.amount));
    for (const s of t.splits) assert.ok(Number.isSafeInteger(s.amount));
  }

  return { balance, net, earmark, txs, fundSum };
}

describe("V10-13：跨模組財務安全（情境 A–P）", () => {
  let c: Couple;

  const income = (ctx: typeof c.ctxA, accountId: string, amount: number, userId: string, day = 1) =>
    ledger.createTransaction(ctx, {
      type: "INCOME", amount, accountId, categoryId: null, title: "入帳", note: "", occurredOn: D(day),
      split: { method: "FULL", participants: [{ userId }] }, clientRequestId: rid(),
    });

  before(async () => {
    await reset();
    c = await setupCouple();
  });
  after(async () => {
    await prisma.$disconnect();
  });

  it("A. 普通支出：付款人的帳戶減少，分帳決定誰負擔", async () => {
    await income(c.ctxA, c.accA, $(50000), c.aId);
    await income(c.ctxB, c.accB, $(50000), c.bId);
    const t = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(300), accountId: c.accA, categoryId: null,
      title: "早餐", note: "", occurredOn: D(2),
      split: { method: "FULL", participants: [{ userId: c.aId }] }, clientRequestId: rid(),
    });
    const r = await invariants(c, "A");
    assert.equal(r.balance.get(c.accA), $(49700));
    // 自己付、自己負擔 → 不產生欠款
    assert.equal(r.net.get(c.aId) ?? 0, 0);
    assert.ok(t.id);
  });

  it("B. 平分：付款人被欠一半，另一人欠一半", async () => {
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1000), accountId: c.accA, categoryId: null,
      title: "晚餐", note: "", occurredOn: D(3),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] }, clientRequestId: rid(),
    });
    const r = await invariants(c, "B");
    assert.equal(r.balance.get(c.accA), $(48700));
    assert.equal(r.net.get(c.aId), $(500), "小艾多付了 500");
    assert.equal(r.net.get(c.bId), -$(500), "阿本欠 500");
  });

  it("C. 共同帳戶付款：不產生個人欠款", async () => {
    await income(c.ctxA, c.joint, $(20000), c.aId, 1);
    const before = await invariants(c, "C-before");
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(2000), accountId: c.joint, categoryId: null,
      title: "共同支出", note: "", occurredOn: D(4),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] }, clientRequestId: rid(),
    });
    const r = await invariants(c, "C");
    assert.equal(r.balance.get(c.joint), $(18000), "共同帳戶餘額有減少");
    // 共同帳戶付的錢不屬於任何一個人，所以誰欠誰完全不動
    assert.equal(r.net.get(c.aId), before.net.get(c.aId), "共同帳戶付款不應改變小艾的淨額");
    assert.equal(r.net.get(c.bId), before.net.get(c.bId), "共同帳戶付款不應改變阿本的淨額");
  });

  it("D. 個人帳戶付對方的錢：全額算對方負擔", async () => {
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(600), accountId: c.accA, categoryId: null,
      title: "幫阿本買的", note: "", occurredOn: D(5),
      split: { method: "FULL", participants: [{ userId: c.bId }] }, clientRequestId: rid(),
    });
    const r = await invariants(c, "D");
    assert.equal(r.net.get(c.bId), -$(1100), "原本欠 500，再欠 600");
  });

  it("E. 退款：錢回帳戶，欠款依原比例回沖，原始消費不被改動", async () => {
    const orig = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(1000), accountId: c.accA, categoryId: null,
      title: "退貨用", note: "", occurredOn: D(6),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] }, clientRequestId: rid(),
    });
    const beforeNet = (await invariants(c, "E-before")).net;
    await transfers.createRefund(c.ctxA, {
      originalId: orig.id, amount: $(400), accountId: c.accA,
      occurredOn: D(7), note: "退一部分", clientRequestId: rid(),
    });
    const r = await invariants(c, "E");
    // 退款回沖一半一半 → 阿本的欠款減少 200
    assert.equal(r.net.get(c.bId)! - beforeNet.get(c.bId)!, $(200), "退款要讓阿本的欠款減少 200");
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: orig.id }, select: { amount: true, deletedAt: true } });
    assert.equal(after.amount, $(1000), "原始消費金額不應被退款改掉");
    assert.equal(after.deletedAt, null);
  });

  it("F. 作廢：所有推導值一起回到作廢前", async () => {
    const before = await invariants(c, "F-before");
    const t = await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(888), accountId: c.accB, categoryId: null,
      title: "等等要作廢", note: "", occurredOn: D(8),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] }, clientRequestId: rid(),
    });
    await invariants(c, "F-mid");
    await ledger.deleteTransaction(c.ctxA, t.id);
    const r = await invariants(c, "F");
    assert.equal(r.balance.get(c.accB), before.balance.get(c.accB), "作廢後帳戶餘額要完全還原");
    assert.equal(r.net.get(c.aId), before.net.get(c.aId), "作廢後欠款要完全還原");
  });

  it("G. 基金投入：帳戶餘額不變，但可自由使用金額減少", async () => {
    const f = await funds.createFund(c.ctxA, { name: "旅遊基金", targetAmount: $(50000), note: "", icon: null, color: null, dueDate: null } as never);
    const before = await invariants(c, "G-before");
    await funds.addFundEntry(c.ctxA, {
      fundId: f.id, type: "DEPOSIT", amount: $(10000), userId: c.aId, accountId: c.accA,
      note: "", occurredOn: D(9), clientRequestId: rid(),
    });
    const r = await invariants(c, "G");
    assert.equal(r.balance.get(c.accA), before.balance.get(c.accA), "指定給基金不是花掉，帳戶餘額不動");
    const free = await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.accA);
    assert.equal(free.earmarked, $(10000));
    assert.equal(free.free, free.balance - $(10000), "可自由使用 = 餘額 − 已指定");
  });

  it("H. 基金投入不得超過可自由使用金額", async () => {
    const f = await funds.createFund(c.ctxA, { name: "超投測試", targetAmount: $(1), note: "", icon: null, color: null, dueDate: null } as never);
    const free = await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.accA);
    await assert.rejects(
      funds.addFundEntry(c.ctxA, {
        fundId: f.id, type: "DEPOSIT", amount: free.free + $(1), userId: c.aId, accountId: c.accA,
        note: "", occurredOn: D(9), clientRequestId: rid(),
      }),
    );
    await invariants(c, "H");
  });

  it("I. 基金支出：真的花掉，帳戶餘額與基金金額一起減少", async () => {
    const fund = (await funds.listFunds(c.ctxA)).find((x) => x.name === "旅遊基金")!;
    const before = await invariants(c, "I-before");
    await ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(3000), accountId: c.accA, categoryId: null,
      title: "訂機票", note: "", occurredOn: D(10),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
      fundId: fund.id, fundAccountId: c.accA, clientRequestId: rid(),
    });
    const r = await invariants(c, "I");
    assert.equal(r.balance.get(c.accA), before.balance.get(c.accA)! - $(3000), "帳戶真的少了 3000");
    assert.equal(r.fundSum.get(fund.id), $(7000), "基金指定額度從 10000 降到 7000");
    // 關鍵：基金的紀錄不可以被當成第二筆金流再扣一次帳戶
    assert.equal(r.balance.get(c.accA), before.balance.get(c.accA)! - $(3000), "不能重複扣款");
  });

  it("J. 轉帳：Σpayment = 0、不算收支、不影響誰欠誰", async () => {
    const before = await invariants(c, "J-before");
    await transfers.createTransfer(c.ctxA, {
      fromAccountId: c.accA, toAccountId: c.joint, amount: $(1000),
      occurredOn: D(11), note: "補共同帳戶", clientRequestId: rid(),
    });
    const r = await invariants(c, "J");
    assert.equal(r.balance.get(c.accA), before.balance.get(c.accA)! - $(1000));
    assert.equal(r.balance.get(c.joint), before.balance.get(c.joint)! + $(1000));
    assert.equal(r.net.get(c.aId), before.net.get(c.aId), "轉帳不改變誰欠誰");
    const s = await ledger.monthSummary(c.ctxA, new Date(`${D(11)}T12:00:00+08:00`));
    assert.ok(Number.isSafeInteger(s.expense) && Number.isSafeInteger(s.income));
  });

  it("K. 轉帳不得動用已指定給基金的錢", async () => {
    const free = await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.accA);
    await assert.rejects(
      transfers.createTransfer(c.ctxA, {
        fromAccountId: c.accA, toAccountId: c.joint, amount: free.free + $(1),
        occurredOn: D(11), note: "太多", clientRequestId: rid(),
      }),
    );
    await invariants(c, "K");
  });

  it("L. 預購付款：沿用一般消費，帳戶與欠款都照常推導", async () => {
    const p = await preorders.createPreorder(c.ctxA, {
      name: "公仔", seller: "", emoji: "🎁", expectedOn: null,
      itemAmount: $(2000), shipping: $(100), ownerId: null, note: "",
      splitRule: null, items: [], categoryId: null,
    });
    const before = await invariants(c, "L-before");
    await preorders.payPreorder(c.ctxA, p.id, {
      amount: $(1000), accountId: c.accA, categoryId: null, occurredOn: D(12), title: "訂金", note: "",
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
      clientRequestId: rid(),
    });
    const r = await invariants(c, "L");
    assert.equal(r.balance.get(c.accA), before.balance.get(c.accA)! - $(1000));
    const view = await preorders.getPreorder(c.ctxA, p.id);
    assert.equal(view!.money.paid, $(1000));
    assert.equal(view!.state, "ACTIVE");
  });

  it("M. 預購付款的退款：走一般退款，不會讓已付金額算錯", async () => {
    const list = await preorders.listPreorders(c.ctxA);
    const p = list.find((x) => x.name === "公仔")!;
    const detail = await preorders.getPreorder(c.ctxA, p.id);
    const payment = detail!.payments[0];
    await transfers.createRefund(c.ctxA, {
      originalId: payment.id, amount: $(400), accountId: c.accA,
      occurredOn: D(13), note: "部分退", clientRequestId: rid(),
    });
    const r = await invariants(c, "M");
    assert.ok(r.balance.get(c.accA)! > 0);
    const after = await preorders.getPreorder(c.ctxA, p.id);
    assert.equal(after!.state, "ACTIVE", "退款之後預購還是進行中");
    assert.ok(after!.money.remaining > 0, "還有尾款要付");
  });

  it("N. 預購取消：不能再記錄付款，已付的紀錄仍然存在", async () => {
    const list = await preorders.listPreorders(c.ctxA);
    const p = list.find((x) => x.name === "公仔")!;
    await preorders.setPreorderCancelled(c.ctxA, p.id, true);
    await rejects(
      preorders.payPreorder(c.ctxA, p.id, {
        amount: $(100), accountId: c.accA, categoryId: null, occurredOn: D(14), title: "不該成功", note: "",
        split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
        clientRequestId: rid(),
      }),
      "PREORDER_NOT_PAYABLE",
    );
    const r = await invariants(c, "N");
    const after = await preorders.getPreorder(c.ctxA, p.id);
    assert.equal(after!.state, "CANCELLED");
    assert.equal(after!.money.paid, $(600), "取消不會把已經付出去的錢抹掉（1000 付款 − 400 退款）");
    assert.ok(r.balance.get(c.accA)! > 0);
  });

  it("O. 任務獎勵提列：只能提列一次，第二次沒有東西可提", async () => {
    const t = await tasks.createTask(c.ctxA, {
      title: "倒垃圾", description: "", emoji: "🗑", scope: "PERSONAL", assigneeId: c.aId,
      frequency: "DAILY", daysOfWeek: 127, requiresApproval: false, requiresPhoto: false,
      rewardAmount: $(50), fundId: null, penaltyAmount: 0, penaltyText: "", isActive: true,
      milestones: [],
    }, D(15));
    await tasks.checkIn(c.ctxA, t.id, { today: D(15) });
    const bal = await rewards.rewardBalance(c.ctxA, c.aId);
    assert.ok(bal.balance > 0, "打卡之後有獎勵可以提列");

    const before = await invariants(c, "O-before");
    await rewards.withdrawRewards(c.ctxA, { accountId: c.accA, note: "提領", occurredOn: D(15), clientRequestId: rid() });
    const r = await invariants(c, "O");
    assert.equal(r.balance.get(c.accA), before.balance.get(c.accA)! + bal.balance, "提列變成真的一筆收入");

    const after = await rewards.rewardBalance(c.ctxA, c.aId);
    assert.equal(after.balance, 0, "提列過的獎勵不能再提列一次");
    await rejects(
      rewards.withdrawRewards(c.ctxA, { accountId: c.accA, note: "再提一次", occurredOn: D(15), clientRequestId: rid() }),
      "REWARD_NOTHING",
    );
    await invariants(c, "O-after");
  });

  it("P. 帳戶餘額調整：差額變成一筆真正的交易，不是直接改欄位", async () => {
    const before = await invariants(c, "P-before");
    const target = before.balance.get(c.accA)! + $(1234);
    await ledger.adjustAccountBalance(c.ctxA, {
      accountId: c.accA, targetBalance: target, note: "對帳", occurredOn: D(16), clientRequestId: rid(),
    });
    const r = await invariants(c, "P");
    assert.equal(r.balance.get(c.accA), target, "調整後餘額等於使用者輸入的實際餘額");
    // 調整是由交易推導出來的，不是寫進某個 balance 欄位
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'Account'`;
    assert.ok(!cols.some((x) => x.column_name === "balance"), "Account 不應該有 balance 欄位");
  });

  it("Q. 最後總檢查：所有不變式在完整歷史上仍然成立", async () => {
    const r = await invariants(c, "final");
    // 欠款零和
    assert.equal([...r.net.values()].reduce((s, v) => s + v, 0), 0);
    // 每個帳戶的餘額都撐得起基金指定
    for (const [accountId, e] of r.earmark) {
      if (e > 0) assert.ok((r.balance.get(accountId) ?? 0) >= e);
    }
    assert.ok(r.txs.length > 10, "確實有走過一段完整歷史");
  });
});
