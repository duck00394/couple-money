import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as tasks from "../../src/server/services/tasks";
import * as rewards from "../../src/server/services/rewards";
import * as funds from "../../src/server/services/funds";
import * as ledger from "../../src/server/services/ledger";
import type { TaskInput } from "../../src/server/services/tasks";

const D = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;

/**
 * 同一筆任務獎勵只能有一個出口。
 *
 * 獎勵離開「我的獎勵」餘額有兩條路：
 *   depositEntryId  基金頁的「獎金入金」，換成基金裡的現金
 *   withdrawalId    任務頁的「提列」，換成一筆 INCOME
 *
 * 兩條路必須互相排除。原本只有提列會排除入金，入金不會排除提列，
 * 所以「先提列、再入金」可以把同一筆 $100 用掉兩次。
 */
describe("V4：任務獎勵不能被用掉兩次", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;

  const task = (fundId: string, over: Partial<TaskInput> = {}): TaskInput => ({
    title: "讀書", description: "", emoji: "book",
    scope: "PERSONAL", assigneeId: c.aId, frequency: "DAILY", daysOfWeek: 127,
    requiresApproval: false, requiresPhoto: false,
    rewardAmount: $(100), fundId, penaltyAmount: 0, penaltyText: "",
    isActive: true, milestones: [], ...over,
  });

  const view = async (fundId: string) => (await funds.listFunds(c.ctxA)).find((f) => f.id === fundId)!;

  before(async () => {
    await reset();
    c = await setupCouple("ds");
  });
  after(() => prisma.$disconnect());

  it("Case 1：還沒提列也還沒入金 → 正常顯示成基金的「尚未入金獎金」", async () => {
    const f = await funds.createFund(c.ctxA, { name: "旅遊", targetAmount: null, dueDate: null });
    const t = (await tasks.createTask(c.ctxA, task(f.id), D(1))).id;
    await tasks.checkIn(c.ctxA, t, { today: D(2) });

    assert.equal((await view(f.id)).pending, $(100), "基金看得到這筆承諾");
    assert.equal((await view(f.id)).balance, 0, "但還不是實際的錢");
    assert.equal((await rewards.rewardBalance(c.ctxA, c.aId)).balance, $(100), "同時也在「我的獎勵」餘額裡");
  });

  it("Case 2：先提列 → 基金的「尚未入金獎金」立刻不再算這一筆", async () => {
    const solo = await setupCouple("ds2");
    const f = await funds.createFund(solo.ctxA, { name: "旅遊", targetAmount: null, dueDate: null });
    const t = (await tasks.createTask(solo.ctxA, {
      ...task(f.id), assigneeId: solo.aId,
    }, D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(2) });
    assert.equal((await funds.listFunds(solo.ctxA)).find((x) => x.id === f.id)!.pending, $(100));

    await rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() });

    const after = (await funds.listFunds(solo.ctxA)).find((x) => x.id === f.id)!;
    assert.equal(after.pending, 0, "已經變成收入了，不能再算成基金的尚未入金");
    assert.equal(after.balance, 0, "基金實際金額不受影響");
    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, 0);
  });

  it("Case 3：先提列 → 再按「獎金入金」必須被拒絕", async () => {
    const solo = await setupCouple("ds3");
    await ledger.createTransaction(solo.ctxA, {
      type: "INCOME", amount: $(1000), accountId: solo.joint, categoryId: null,
      title: "薪水", note: "", occurredOn: D(1),
      split: { method: "FULL", participants: [{ userId: solo.aId }] }, clientRequestId: rid(),
    });
    const f = await funds.createFund(solo.ctxA, { name: "旅遊", targetAmount: null, dueDate: null });
    const t = (await tasks.createTask(solo.ctxA, { ...task(f.id), assigneeId: solo.aId }, D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(2) });
    await rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() });
    assert.equal((await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance, $(100));

    await rejects(
      funds.depositRewards(solo.ctxA, {
        fundId: f.id, targetAccountId: solo.joint, sourceAccountId: null,
        note: "", occurredOn: D(3), clientRequestId: rid(),
      }),
      "REWARD_NOTHING",
    );

    const after = (await funds.listFunds(solo.ctxA)).find((x) => x.id === f.id)!;
    assert.equal(after.balance, 0, "基金沒有憑空多出那 $100");
    assert.equal(after.pending, 0);
    assert.equal(await prisma.fundTransaction.count({ where: { fundId: f.id, type: "REWARD_DEPOSIT" } }), 0);
    // 那筆獎勵仍然只指向提列，沒有被入金也標記一次
    const r = await prisma.taskReward.findFirstOrThrow({ where: { taskId: t } });
    assert.ok(r.withdrawalId, "提列的標記還在");
    assert.equal(r.depositEntryId, null, "沒有被入金第二次");
  });

  it("Case 4：先入金 → 再提列仍然維持原本的阻擋行為", async () => {
    const solo = await setupCouple("ds4");
    await ledger.createTransaction(solo.ctxA, {
      type: "INCOME", amount: $(1000), accountId: solo.joint, categoryId: null,
      title: "薪水", note: "", occurredOn: D(1),
      split: { method: "FULL", participants: [{ userId: solo.aId }] }, clientRequestId: rid(),
    });
    const f = await funds.createFund(solo.ctxA, { name: "旅遊", targetAmount: null, dueDate: null });
    const t = (await tasks.createTask(solo.ctxA, { ...task(f.id), assigneeId: solo.aId }, D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(2) });

    await funds.depositRewards(solo.ctxA, {
      fundId: f.id, targetAccountId: solo.joint, sourceAccountId: null,
      note: "", occurredOn: D(3), clientRequestId: rid(),
    });
    const after = (await funds.listFunds(solo.ctxA)).find((x) => x.id === f.id)!;
    assert.equal(after.balance, $(100), "入金後才是基金裡真的錢");
    assert.equal(after.pending, 0);

    // 已經入金過，提列不到（這是既有行為，不能被這次修改弄壞）
    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, 0);
    await rejects(
      rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() }),
      "REWARD_NOTHING",
    );
    assert.equal((await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance, 0);
  });

  it("Case 5：懲罰也一樣 —— 提列時扣掉的懲罰不會在入金時再扣一次", async () => {
    const solo = await setupCouple("ds5");
    await ledger.createTransaction(solo.ctxA, {
      type: "INCOME", amount: $(1000), accountId: solo.joint, categoryId: null,
      title: "薪水", note: "", occurredOn: D(1),
      split: { method: "FULL", participants: [{ userId: solo.aId }] }, clientRequestId: rid(),
    });
    const f = await funds.createFund(solo.ctxA, { name: "旅遊", targetAmount: null, dueDate: null });
    const good = (await tasks.createTask(solo.ctxA, { ...task(f.id), assigneeId: solo.aId }, D(1))).id;
    const bad = (await tasks.createTask(solo.ctxA, {
      ...task(f.id), title: "早起", assigneeId: solo.aId, rewardAmount: 0, penaltyAmount: $(30),
    }, D(2))).id;
    await tasks.checkIn(solo.ctxA, good, { today: D(4) });
    await tasks.applyMissedPenalties(solo.ctxA, D(4)); // 早起漏做 D(3) → −30

    assert.equal((await funds.listFunds(solo.ctxA)).find((x) => x.id === f.id)!.pending, $(70), "100 − 30");
    await rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() });

    assert.equal((await funds.listFunds(solo.ctxA)).find((x) => x.id === f.id)!.pending, 0, "獎勵與懲罰都結清了");
    await rejects(
      funds.depositRewards(solo.ctxA, {
        fundId: f.id, targetAccountId: solo.joint, sourceAccountId: null,
        note: "", occurredOn: D(5), clientRequestId: rid(),
      }),
      "REWARD_NOTHING",
    );
    const p = await prisma.taskPenalty.findFirstOrThrow({ where: { taskId: bad } });
    assert.ok(p.withdrawalId, "懲罰是在提列時扣掉的");
    assert.equal(p.depositEntryId, null, "沒有被入金再扣一次");
  });
});
