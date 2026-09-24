import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as tasks from "../../src/server/services/tasks";
import * as rewards from "../../src/server/services/rewards";
import * as ledger from "../../src/server/services/ledger";
import { monthStats } from "../../src/server/services/stats";
import type { TaskInput } from "../../src/server/services/tasks";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;

const input = (over: Partial<TaskInput> = {}): TaskInput => ({
  title: "英文 30 分鐘", description: "", emoji: "book",
  scope: "PERSONAL", assigneeId: null, frequency: "DAILY", daysOfWeek: 127,
  requiresApproval: false, requiresPhoto: false,
  rewardAmount: $(50), fundId: null, penaltyAmount: 0, penaltyText: "",
  isActive: true, milestones: [], ...over,
});

/**
 * 作廢「任務獎勵提列」那筆收入 = 那次提列整個復原。
 *
 * 這條之所以重要：提列會把 TaskReward 標上 withdrawalId，
 * 如果作廢只退帳戶的錢、沒有解除標記，那筆錢會兩邊都不在 —— 帳戶退掉了，
 * 獎勵餘額又還算它「已提列」，而且永遠提不出來。
 */
describe("V4：作廢獎勵提列", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  const bal = async (userId: string) => (await rewards.rewardBalance(c.ctxA, userId)).balance;
  const accBal = async (accountId: string) => (await ledger.listAccounts(c.ctxA)).find((a) => a.id === accountId)!.balance;

  before(async () => {
    await reset();
    c = await setupCouple("wc");
  });
  after(() => prisma.$disconnect());

  it("1. 作廢之後：帳戶的錢退回去，獎勵回到餘額，而且可以重新提列", async () => {
    const t = (await tasks.createTask(c.ctxA, input({ assigneeId: c.aId }), D(1))).id;
    await tasks.checkIn(c.ctxA, t, { today: D(2) });
    await tasks.checkIn(c.ctxA, t, { today: D(3) });
    assert.equal(await bal(c.aId), $(100));

    const tx = await rewards.withdrawRewards(c.ctxA, { accountId: c.accA, clientRequestId: rid() });
    assert.equal(await bal(c.aId), 0);
    assert.equal(await accBal(c.accA), $(100));

    await ledger.deleteTransaction(c.ctxA, tx.id);
    assert.equal(await accBal(c.accA), 0, "帳戶的錢退回去");
    assert.equal(await bal(c.aId), $(100), "獎勵回到「我的獎勵」，不是人間蒸發");
    assert.equal((await monthStats(c.ctxA, MONTH)).totals.income, 0, "收入統計也退回去");

    const again = await rewards.withdrawRewards(c.ctxA, { accountId: c.accA, clientRequestId: rid() });
    assert.equal(again.amount, $(100), "可以重新提列一次，金額一樣");
    assert.equal(await accBal(c.accA), $(100));
    assert.equal(await bal(c.aId), 0);
  });

  it("2. 標記真的被解除，不會留下指向已作廢交易的孤兒", async () => {
    const t = (await tasks.createTask(c.ctxA, input({ title: "跑步", assigneeId: c.aId, rewardAmount: $(20) }), D(1))).id;
    await tasks.checkIn(c.ctxA, t, { today: D(5) });
    const tx = await rewards.withdrawRewards(c.ctxA, { accountId: c.accA, clientRequestId: rid() });
    assert.equal(await prisma.taskReward.count({ where: { withdrawalId: tx.id } }), 1);

    await ledger.deleteTransaction(c.ctxA, tx.id);
    assert.equal(await prisma.taskReward.count({ where: { withdrawalId: tx.id } }), 0, "沒有孤兒");
    const check = await rewards.rewardCheck(c.ctxA, c.aId);
    assert.ok(check.consistent, "餘額與明細對得起來");
  });

  it("3. 懲罰也會一起還原", async () => {
    const solo = await setupCouple("wc2");
    const good = (await tasks.createTask(solo.ctxA, input({ title: "讀書", assigneeId: solo.aId, rewardAmount: $(100) }), D(1))).id;
    // D(2) 建立 → 懲罰從 D(3) 起算，跑到 D(4) 只會漏掉 D(3) 這一天
    const bad = (await tasks.createTask(solo.ctxA, input({
      title: "早起", assigneeId: solo.aId, rewardAmount: 0, penaltyAmount: $(30), penaltyText: "",
    }), D(2))).id;
    await tasks.checkIn(solo.ctxA, good, { today: D(4) });
    await tasks.applyMissedPenalties(solo.ctxA, D(4)); // 早起漏做一天 → −30
    assert.equal(await prisma.taskPenalty.count({ where: { taskId: bad, waivedAt: null } }), 1);
    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, $(70));

    const tx = await rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() });
    assert.equal(tx.amount, $(70), "獎勵 100 − 懲罰 30");
    assert.equal(await prisma.taskPenalty.count({ where: { withdrawalId: tx.id } }), 1);

    await ledger.deleteTransaction(solo.ctxA, tx.id);
    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, $(70), "獎勵與懲罰都回到原狀");
    assert.equal(await prisma.taskPenalty.count({ where: { withdrawalId: tx.id } }), 0);
    assert.equal(await prisma.taskPenalty.count({ where: { taskId: bad, waivedAt: null } }), 1, "懲罰沒有被弄不見");
  });

  it("3b. 舊版作廢留下的爛攤子：標記沒清掉，但獎勵照樣算得回來", async () => {
    const solo = await setupCouple("wcOld");
    const t = (await tasks.createTask(solo.ctxA, input({ title: "舊版提列", assigneeId: solo.aId, rewardAmount: $(80) }), D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(2) });
    const tx = await rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() });
    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, 0);

    // 重現舊版的行為：只把交易軟刪除，withdrawalId 留在原地不清
    await prisma.transaction.update({ where: { id: tx.id }, data: { deletedAt: new Date(), deletedById: solo.aId } });
    assert.equal(await prisma.taskReward.count({ where: { withdrawalId: tx.id } }), 1, "標記還在（這就是舊版留下的狀態）");

    // 餘額看的是「那筆收入還在不在」，所以錢自己回來了，不用下 SQL 修資料
    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, $(80), "獎勵要自己算回來");
    assert.equal((await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance, 0, "帳戶的錢確實退掉了");
    const check = await rewards.rewardCheck(solo.ctxA, solo.aId);
    assert.ok(check.consistent, "餘額與明細對得起來");

    // 而且可以重新提列，不會說「沒有可以提列的獎勵」
    const again = await rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() });
    assert.equal(again.amount, $(80));
    assert.equal((await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance, $(80));
    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, 0);
    // 重新提列會把標記改指到新的那筆，不會留著指向已作廢的舊交易
    assert.equal(await prisma.taskReward.count({ where: { withdrawalId: again.id } }), 1);
    assert.equal(await prisma.taskReward.count({ where: { withdrawalId: tx.id } }), 0);
  });

  it("3c. 還活著的提列不會被誤判成可以再提一次", async () => {
    const solo = await setupCouple("wcLive");
    const t = (await tasks.createTask(solo.ctxA, input({ title: "正常提列", assigneeId: solo.aId, rewardAmount: $(40) }), D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(2) });
    await rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() });
    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, 0);
    await rejects(rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() }), "REWARD_NOTHING");
  });

  it("4. 提列出來的收入不能直接改金額（改了會跟那批獎勵對不起來）", async () => {
    const solo = await setupCouple("wc3");
    const t = (await tasks.createTask(solo.ctxA, input({ assigneeId: solo.aId }), D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(2) });
    const tx = await rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() });

    await rejects(
      ledger.updateTransaction(solo.ctxA, tx.id, tx.version, {
        type: "INCOME", amount: $(9999), accountId: solo.accA, categoryId: null,
        title: "偷改金額", note: "", occurredOn: D(2),
        split: { method: "FULL", participants: [{ userId: solo.aId }] },
      }),
      "TX_REWARD_WITHDRAWAL",
    );
    assert.equal(await accBal2(solo, solo.accA), $(50), "金額沒有被改掉");
  });

  it("5. 另一半的獎勵完全不受影響", async () => {
    const solo = await setupCouple("wc4");
    const t = (await tasks.createTask(solo.ctxA, input({ title: "洗碗", scope: "EACH", assigneeId: null }), D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(2) });
    await tasks.checkIn(solo.ctxB, t, { today: D(2) });
    const tx = await rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() });
    assert.equal((await rewards.rewardBalance(solo.ctxB, solo.bId)).balance, $(50));

    await ledger.deleteTransaction(solo.ctxA, tx.id);
    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, $(50), "A 的回來了");
    assert.equal((await rewards.rewardBalance(solo.ctxB, solo.bId)).balance, $(50), "B 的沒被動過");
  });
});

async function accBal2(c: Awaited<ReturnType<typeof setupCouple>>, accountId: string) {
  return (await ledger.listAccounts(c.ctxA)).find((a) => a.id === accountId)!.balance;
}
