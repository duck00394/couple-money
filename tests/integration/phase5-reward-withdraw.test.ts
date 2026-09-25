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

/** A-2：把個人獎勵餘額提列成一筆真正的收入。 */
describe("V3 A-2：獎勵提列", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let task = "";

  const input = (over: Partial<TaskInput> = {}): TaskInput => ({
    title: "每日讀英文", description: "", emoji: "book",
    scope: "EACH", assigneeId: null, frequency: "DAILY", daysOfWeek: 127,
    requiresApproval: false, requiresPhoto: false,
    rewardAmount: $(50), fundId: null, penaltyAmount: 0, penaltyText: "",
    isActive: true, milestones: [], ...over,
  });
  const bal = async (userId: string) => (await rewards.rewardBalance(c.ctxA, userId)).balance;
  const balanceOf = async (accountId: string) => (await ledger.listAccounts(c.ctxA)).find((a) => a.id === accountId)!.balance;

  before(async () => {
    await reset();
    c = await setupCouple("wd");
    task = (await tasks.createTask(c.ctxA, input(), D(1))).id;
    // A 打卡 3 天 = $150、B 打卡 1 天 = $50
    for (const d of [2, 3, 4]) await tasks.checkIn(c.ctxA, task, { today: D(d) });
    await tasks.checkIn(c.ctxB, task, { today: D(2) });
  });
  after(() => prisma.$disconnect());

  it("1. 提列前：沒有任何 Transaction、帳戶餘額不變、收入統計是 0", async () => {
    assert.equal(await bal(c.aId), $(150));
    assert.equal(await bal(c.bId), $(50));
    assert.equal(await balanceOf(c.accA), 0);
    assert.equal((await monthStats(c.ctxA, MONTH)).totals.income, 0);
    assert.equal(await prisma.transaction.count({ where: { bookId: c.ctxA.book.id, type: "INCOME" } }), 0);
  });

  it("2. 提列：建立一筆 INCOME、帳戶餘額增加、餘額歸零、收入統計才增加", async () => {
    const tx = await rewards.withdrawRewards(c.ctxA, { accountId: c.accA, clientRequestId: rid() });

    assert.equal(tx.type, "INCOME");
    assert.equal(tx.amount, $(150));
    assert.equal(await balanceOf(c.accA), $(150), "錢真的進到帳戶");
    assert.equal(await bal(c.aId), 0, "餘額歸零");
    assert.equal(await bal(c.bId), $(50), "B 的獎勵完全不受影響");
    assert.equal((await monthStats(c.ctxA, MONTH)).totals.income, $(150), "提列後才算收入");

    const r = await prisma.taskReward.findMany({ where: { userId: c.aId } });
    assert.ok(r.every((x) => x.withdrawalId === tx.id), "每筆獎勵都指得回那筆收入（可追溯）");
  });

  it("3. 已提列的獎勵不會再被提列一次", async () => {
    await rejects(rewards.withdrawRewards(c.ctxA, { accountId: c.accA, clientRequestId: rid() }), "REWARD_NOTHING");
    assert.equal(await balanceOf(c.accA), $(150), "帳戶沒有再增加");
    assert.equal(await prisma.transaction.count({ where: { bookId: c.ctxA.book.id, type: "INCOME" } }), 1);
  });

  it("4. 同一個 clientRequestId 送兩次只會建立一筆（含併發）", async () => {
    await tasks.checkIn(c.ctxA, task, { today: D(5) });
    const req = rid();
    const [x, y] = await Promise.all([
      rewards.withdrawRewards(c.ctxA, { accountId: c.accA, clientRequestId: req }),
      rewards.withdrawRewards(c.ctxA, { accountId: c.accA, clientRequestId: req }),
    ]);
    assert.equal(x.id, y.id, "兩次拿到同一筆");
    assert.equal(await prisma.transaction.count({ where: { bookId: c.ctxA.book.id, type: "INCOME" } }), 2);
    assert.equal(await bal(c.aId), 0);
    assert.equal(await balanceOf(c.accA), $(200));
  });

  it("5. 只能提列自己的獎勵：B 提列拿到的是 B 自己的金額", async () => {
    const tx = await rewards.withdrawRewards(c.ctxB, { accountId: c.accB, clientRequestId: rid() });
    assert.equal(tx.amount, $(50), "B 只拿到自己的 $50，不會拿到 A 的");
    assert.equal(await bal(c.bId), 0);
    assert.equal(await balanceOf(c.accB), $(50));
    assert.equal(await balanceOf(c.accA), $(200), "A 的帳戶沒被動到");
  });

  it("6. 不能提列到另一半的個人帳戶", async () => {
    await tasks.checkIn(c.ctxA, task, { today: D(6) });
    await rejects(rewards.withdrawRewards(c.ctxA, { accountId: c.accB, clientRequestId: rid() }), "REWARD_ACCOUNT_OWNER");
    assert.equal(await bal(c.aId), $(50), "失敗後餘額原封不動");
  });

  it("7. 懲罰會在提列時一起結清，之後不再重複扣", async () => {
    const t = await tasks.createTask(c.ctxA, input({ title: "記帳", rewardAmount: 0, penaltyAmount: $(20) }), D(7));
    // 懲罰從建立的隔天（D8）才開始算，所以到 D9 為止只有 D8 一天沒做 → 罰 $20
    await tasks.applyMissedPenalties(c.ctxA, D(9));
    assert.equal(await bal(c.aId), $(50) - $(20));

    const tx = await rewards.withdrawRewards(c.ctxA, { accountId: c.joint, clientRequestId: rid() });
    assert.equal(tx.amount, $(30), "提列的是淨額（獎勵 $50 − 懲罰 $20）");
    assert.equal(await bal(c.aId), 0);

    const ps = await prisma.taskPenalty.findMany({ where: { taskId: t.id, userId: c.aId } });
    assert.ok(ps.every((p) => p.withdrawalId === tx.id), "懲罰也標記了，不會再扣第二次");
    await tasks.applyMissedPenalties(c.ctxA, D(9));
    assert.equal(await bal(c.aId), 0, "重跑也不會變成負的");
  });

  it("8. 提列後不能再用取消打卡把那筆獎勵收回", async () => {
    const ci = await prisma.checkIn.findFirstOrThrow({ where: { taskId: task, subjectKey: c.aId, date: new Date(`${D(2)}T00:00:00Z`) } });
    await rejects(tasks.cancelCheckIn(c.ctxA, ci.id, { today: D(2) }), "REWARD_WITHDRAWN");
  });

  it("9. 提列產生的收入就是一筆普通交易：分帳全給自己、可以在明細中查到", async () => {
    const tx = await prisma.transaction.findFirstOrThrow({
      where: { bookId: c.ctxA.book.id, type: "INCOME" },
      include: { splits: true, payments: true },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(tx.title, "任務獎勵提列");
    assert.equal(tx.splits.length, 1);
    assert.equal(tx.splits[0].userId, c.aId);
    assert.equal(tx.payments.length, 1);
    assert.equal(tx.payments[0].accountId, c.accA);
  });
});
