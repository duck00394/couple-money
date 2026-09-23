import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rid, reset, rejects, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as goals from "../../src/server/services/goals";
import * as tasks from "../../src/server/services/tasks";
import * as attachments from "../../src/server/services/attachments";
import type { TaskInput } from "../../src/server/services/tasks";

const D = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;

describe("Phase 2-3～2-8：任務、打卡、獎金（尚未入金）、連續、里程碑、懲罰", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let fundId = "";
  let goalId = "";
  /** 尚未入金淨額（獎金 − 懲罰） */
  const balance = async () => (await funds.getFundDetail(c.ctxA, fundId))!.pending.net;
  /** 實際基金金額 */
  const real = async () => (await funds.getFundDetail(c.ctxA, fundId))!.summary.balance;
  const input = (over: Partial<TaskInput> = {}): TaskInput => ({
    title: "英文 30 分鐘", description: "", emoji: "📚", scope: "PERSONAL", assigneeId: c.aId, frequency: "DAILY", daysOfWeek: 127,
    requiresApproval: false, requiresPhoto: false, rewardAmount: $(50), fundId, penaltyAmount: 0, penaltyText: "", isActive: true,
    milestones: tasks.DEFAULT_MILESTONES.map((m) => ({ ...m, bonusAmount: m.days === 3 ? $(100) : 0, rewardText: m.days === 7 ? "對方請吃飯" : "" })),
    ...over,
  });

  before(async () => {
    await reset();
    c = await setupCouple();
    fundId = (await funds.createFund(c.ctxA, { name: "日本旅行基金", targetAmount: $(30000), dueDate: null })).id;
    goalId = (await goals.createGoal(c.ctxA, { name: "日本旅行", description: "", emoji: "🗾", targetAmount: $(1000), startDate: D(1), deadline: null, fundId, isActive: true })).id;
  });
  after(() => prisma.$disconnect());

  let english = "";
  it("2-3 建立任務：我的／另一半／共同、每日／每週／自訂、驗證", async () => {
    await rejects(tasks.createTask(c.ctxA, input({ fundId: null })), "TASK_FUND");
    await rejects(tasks.createTask(c.ctxA, input({ frequency: "WEEKLY", daysOfWeek: 0b11 })), "TASK_DAYS");
    await rejects(tasks.createTask(c.ctxA, input({ assigneeId: null })), "TASK_ASSIGNEE");
    english = (await tasks.createTask(c.ctxA, input(), D(10))).id;
    await tasks.createTask(c.ctxA, input({ title: "運動", assigneeId: c.bId, rewardAmount: $(30), milestones: [] }), D(10));
    await tasks.createTask(c.ctxA, input({ title: "一起散步", scope: "SHARED", assigneeId: null, rewardAmount: $(20), milestones: [] }), D(10));
    const weekly = await tasks.createTask(c.ctxA, input({ title: "大掃除", frequency: "WEEKLY", daysOfWeek: 1 << 6, rewardAmount: 0, fundId: null, milestones: [] }), D(10));
    assert.equal(weekly.daysOfWeek, 64);
    const board = await tasks.taskBoard(c.ctxA, D(10));
    assert.deepEqual(board.cards.map((x) => x.group).sort(), ["MINE", "MINE", "PARTNER", "SHARED"]);
    const boardB = await tasks.taskBoard(c.ctxB, D(10));
    assert.equal(boardB.cards.find((x) => x.task.title === "運動")!.group, "MINE");
    await rejects(tasks.updateTask(c.ctxA, english, input({ assigneeId: c.bId })), "TASK_SCOPE_LOCKED");
  });

  it("2-4／2-5 打卡 → TaskReward（已獲得、尚未入金）→ 基金「尚未入金獎金」+50；不動任何帳戶、實際金額不變", async () => {
    const accountsBefore = (await ledger.listAccounts(c.ctxA)).map((a) => a.balance);
    const r = await tasks.checkIn(c.ctxA, english, { today: D(10), note: "Unit 3" });
    assert.equal(r.checkIn.status, "APPROVED");
    const reward = await prisma.taskReward.findFirst({ where: { checkInId: r.checkIn.id } });
    assert.equal(reward!.amount, $(50));
    assert.equal(reward!.depositEntryId, null, "尚未入金");
    assert.equal(await prisma.fundTransaction.count(), 0, "獲得獎金不建立實際基金紀錄");
    assert.equal(await balance(), $(50));
    assert.equal(await real(), 0);
    const goal = (await goals.getGoal(c.ctxA, goalId))!;
    assert.equal(goal.current, 0, "目標的目前金額只算實際金額");
    assert.equal(goal.pending, $(50), "尚未入金獎金另外顯示");
    assert.deepEqual((await ledger.listAccounts(c.ctxA)).map((a) => a.balance), accountsBefore, "不增加任何帳戶餘額");
    assert.deepEqual((await ledger.getBalances(c.ctxA)).debts, [], "獎金不影響誰欠誰");

    await rejects(tasks.checkIn(c.ctxA, english, { today: D(10) }), "CHECKIN_DUP");
    await rejects(tasks.checkIn(c.ctxB, english, { today: D(10) }), "TASK_NOT_MINE");
    await rejects(tasks.checkIn(c.ctxA, (await prisma.task.findFirst({ where: { title: "大掃除" } }))!.id, { today: D(10) }), "TASK_NOT_TODAY");

    // 共同任務：任一人完成就算完成，另一人不能再打
    const walk = (await prisma.task.findFirst({ where: { title: "一起散步" } }))!.id;
    const results = await Promise.allSettled([tasks.checkIn(c.ctxA, walk, { today: D(10) }), tasks.checkIn(c.ctxB, walk, { today: D(10) })]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(await balance(), $(70));
    assert.equal((await tasks.todayRewards(c.ctxA, D(10))).total, $(70));
  });

  it("2-4 修改與取消打卡：取消會收回獎金（紀錄保留）；可重新打卡；已完成的舊打卡不能取消", async () => {
    const ci = (await prisma.checkIn.findFirst({ where: { taskId: english, date: new Date(`${D(10)}T00:00:00Z`) } }))!;
    await tasks.editCheckIn(c.ctxA, ci.id, { note: "Unit 4" });
    assert.equal((await prisma.checkIn.findUnique({ where: { id: ci.id } }))!.note, "Unit 4");
    await rejects(tasks.editCheckIn(c.ctxB, ci.id, { note: "x" }), "CHECKIN_NOT_MINE");
    await rejects(tasks.cancelCheckIn(c.ctxA, ci.id, { today: D(11) }), "CHECKIN_OLD");

    await tasks.cancelCheckIn(c.ctxA, ci.id, { today: D(10) });
    assert.equal((await prisma.checkIn.findUnique({ where: { id: ci.id } }))!.status, "CANCELLED");
    assert.equal(await balance(), $(20));
    assert.equal(await prisma.taskReward.count({ where: { checkInId: ci.id, deletedAt: { not: null } } }), 1, "收回的獎金紀錄仍保留");

    await tasks.checkIn(c.ctxA, english, { today: D(10) });
    assert.equal(await balance(), $(70));
    assert.equal(await prisma.taskReward.count({ where: { checkInId: ci.id, deletedAt: null } }), 1, "同一次打卡只會有一筆有效獎金");
  });

  it("2-6／2-7 連續打卡與里程碑：3 天發獎金＋徽章、同一段只發一次、斷掉重來可再發、取消會收回徽章", async () => {
    await tasks.checkIn(c.ctxA, english, { today: D(11) });
    const r3 = await tasks.checkIn(c.ctxA, english, { today: D(12) });
    assert.equal(r3.streak, 3);
    assert.deepEqual(r3.reached.map((m) => [m.days, m.badgeName]), [[3, "三天好的開始"]]);
    const afterMilestone = await balance();
    assert.equal(afterMilestone, $(70 + 50 + 50 + 100));
    assert.equal((await tasks.listBadges(c.ctxA)).length, 1);

    const r4 = await tasks.checkIn(c.ctxA, english, { today: D(13) });
    assert.deepEqual(r4.reached, []);

    // 14 號沒打；15～17 重新連續三天 → 新的一段可以再領
    await tasks.checkIn(c.ctxA, english, { today: D(15) });
    await tasks.checkIn(c.ctxA, english, { today: D(16) });
    const again = await tasks.checkIn(c.ctxA, english, { today: D(17) });
    assert.equal(again.reached.length, 1);
    assert.equal((await tasks.listBadges(c.ctxA)).length, 2);

    const board = await tasks.taskBoard(c.ctxA, D(17));
    const card = board.cards.find((x) => x.task.id === english)!;
    assert.equal(card.stats.current, 3);
    assert.equal(card.stats.longest, 4);
    assert.equal(card.stats.weekDone, 3); // 9/14（一）～9/17（四）
    assert.equal(card.stats.weekScheduled, 4);
    assert.equal(card.stats.monthDone, 7);

    await tasks.cancelCheckIn(c.ctxA, again.checkIn.id, { today: D(17) });
    assert.equal((await tasks.listBadges(c.ctxA)).length, 1, "取消打卡會收回這次的徽章");
    const redo = await tasks.checkIn(c.ctxA, english, { today: D(17) });
    assert.equal(redo.reached.length, 1, "重新打卡可以再次達成");
    assert.equal(await prisma.taskMilestoneClaim.count(), 2);
  });

  it("需要對方確認與照片：待確認不發獎金、不能確認自己、拒絕後可重打、確認後才發", async () => {
    const t = await tasks.createTask(c.ctxB, input({ title: "早睡", assigneeId: c.bId, requiresApproval: true, requiresPhoto: true, rewardAmount: $(40), milestones: [] }), D(17));
    await rejects(tasks.checkIn(c.ctxB, t.id, { today: D(17) }), "CHECKIN_PHOTO_REQUIRED");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082", "hex");
    await rejects(attachments.saveUpload(c.ctxB, { name: "x.png", type: "image/png", size: 5, arrayBuffer: async () => new Uint8Array(Buffer.from("hello")).buffer }), "UPLOAD_TYPE");
    const photo = await attachments.saveUpload(c.ctxB, { name: "sleep.png", type: "image/png", size: png.length, arrayBuffer: async () => new Uint8Array(png).buffer });
    await rejects(tasks.checkIn(c.ctxB, t.id, { today: D(17), photoId: (await attachments.saveUpload(c.ctxA, { name: "a.png", type: "image/png", size: png.length, arrayBuffer: async () => new Uint8Array(png).buffer })).id }), "CHECKIN_PHOTO");

    const before = await balance();
    const r = await tasks.checkIn(c.ctxB, t.id, { today: D(17), photoId: photo.id });
    assert.equal(r.checkIn.status, "PENDING");
    assert.equal(await balance(), before);
    assert.ok(await attachments.readAttachment(c.aId, photo.id), "另一半看得到照片");
    const outsider = await setupCouple("outsider");
    assert.equal(await attachments.readAttachment(outsider.aId, photo.id), null, "其他帳本的人看不到照片");

    await rejects(tasks.reviewCheckIn(c.ctxB, r.checkIn.id, true), "CHECKIN_SELF_REVIEW");
    assert.equal((await tasks.pendingReviews(c.ctxA)).length, 1);
    await tasks.reviewCheckIn(c.ctxA, r.checkIn.id, false, "照片看不清楚");
    await rejects(tasks.reviewCheckIn(c.ctxA, r.checkIn.id, true), "CHECKIN_REVIEWED");
    const again = await tasks.checkIn(c.ctxB, t.id, { today: D(17), photoId: photo.id });
    assert.equal(again.checkIn.id, r.checkIn.id);
    await tasks.reviewCheckIn(c.ctxA, again.checkIn.id, true);
    assert.equal(await balance(), before + $(40));
  });

  it("2-8 懲罰：漏做自動記錄、從尚未入金獎金扣（不動實際金額）、重複執行不重複、非金錢懲罰、免除、本人不能免除", async () => {
    const t = await tasks.createTask(c.ctxA, input({ title: "記帳", assigneeId: c.aId, rewardAmount: 0, penaltyAmount: $(30), penaltyText: "洗碗一次", milestones: [] }), D(10));
    assert.equal((await prisma.task.findUnique({ where: { id: t.id } }))!.penaltyStartDate!.toISOString().slice(0, 10), D(11), "建立當天不罰");
    await tasks.checkIn(c.ctxA, t.id, { today: D(12) });
    const before = await balance();
    const n = await tasks.applyMissedPenalties(c.ctxA, D(15)); // 11、13、14 沒做
    assert.equal(n, 3);
    assert.equal(await tasks.applyMissedPenalties(c.ctxB, D(15)), 0, "重複執行不會重複產生");
    assert.equal(await balance(), before - $(90));
    const ps = await prisma.taskPenalty.findMany({ where: { taskId: t.id }, orderBy: { date: "asc" } });
    assert.deepEqual(ps.map((p) => p.date.toISOString().slice(0, 10)), [D(11), D(13), D(14)]);
    assert.ok(ps.every((p) => p.text === "洗碗一次" && p.amount === $(30) && p.fundId === fundId && p.userId === c.aId && !p.depositEntryId));
    assert.equal(await real(), 0, "懲罰不動實際基金金額，而是從尚未入金獎金扣");

    await rejects(tasks.waivePenalty(c.ctxA, ps[0].id), "PENALTY_SELF");
    await tasks.waivePenalty(c.ctxB, ps[0].id);
    assert.equal(await balance(), before - $(60));
    const detail = (await funds.getFundDetail(c.ctxA, fundId))!;
    assert.equal(detail.pending.penaltiesByUser.get(c.aId), $(60));

    // 只有文字懲罰：沒有基金紀錄
    const t2 = await tasks.createTask(c.ctxB, input({ title: "不滑手機", assigneeId: c.bId, rewardAmount: 0, fundId: null, penaltyText: "按摩 10 分鐘", milestones: [] }), D(10));
    await tasks.applyMissedPenalties(c.ctxA, D(12));
    const p2 = await prisma.taskPenalty.findMany({ where: { taskId: t2.id } });
    assert.equal(p2.length, 1);
    assert.equal(p2[0].fundId, null);
    assert.equal(p2[0].amount, 0);
  });

  it("獎金入金：沒有可自由使用的錢會被擋；入金後實際金額 +、尚未入金歸零、懲罰一起抵扣；已入金不能取消打卡或免除懲罰", async () => {
    const pendingNet = await balance();
    assert.ok(pendingNet > 0);
    const dep = (over: Partial<Parameters<typeof funds.depositRewards>[1]> = {}) =>
      funds.depositRewards(c.ctxA, { fundId, targetAccountId: c.joint, sourceAccountId: null, note: "", occurredOn: D(17), clientRequestId: rid(), ...over });
    await rejects(dep(), "FUND_OVER_FREE"); // 共同帳戶 $0，錢不在裡面
    await rejects(dep({ sourceAccountId: c.accB }), "FUND_OVER_FREE"); // 阿本現金也沒錢
    await rejects(dep({ targetAccountId: c.joint, sourceAccountId: c.joint }), "TRANSFER_SAME");

    // 阿本現金有 $1,000，從阿本現金轉入共同帳戶
    await ledger.createTransaction(c.ctxB, { type: "INCOME", amount: $(1000), accountId: c.accB, categoryId: null, title: "薪水", note: "", occurredOn: D(17), split: { method: "FULL", participants: [{ userId: c.bId }] }, clientRequestId: rid() });
    const accBefore = await ledger.listAccounts(c.ctxA);
    const e = await dep({ sourceAccountId: c.accB });
    assert.equal(e.type, "REWARD_DEPOSIT");
    assert.equal(e.amount, pendingNet);
    assert.equal(await real(), pendingNet, "實際基金金額 + 入金淨額");
    assert.equal(await balance(), 0, "尚未入金歸零");
    const accAfter = await ledger.listAccounts(c.ctxA);
    const diff = (id: string) => accAfter.find((a) => a.id === id)!.balance - accBefore.find((a) => a.id === id)!.balance;
    assert.equal(diff(c.joint), pendingNet, "共同帳戶 +入金金額（實際金流）");
    assert.equal(diff(c.accB), -pendingNet, "來源帳戶 −入金金額");
    assert.equal((await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.joint)).free, 0, "入金的錢全部指定給基金");
    assert.deepEqual((await ledger.getBalances(c.ctxA)).debts, [], "入金是轉帳，不影響誰欠誰");
    const settled = await prisma.taskReward.count({ where: { depositEntryId: e.id } });
    assert.ok(settled > 0);
    assert.equal(await prisma.taskPenalty.count({ where: { depositEntryId: e.id } }), 2, "兩筆未免除的懲罰一起抵扣");
    await rejects(dep(), "REWARD_NOTHING");

    // 已入金：不能取消那天的打卡、不能免除已抵扣的懲罰
    const lastCi = (await prisma.checkIn.findFirst({ where: { taskId: english, date: new Date(`${D(17)}T00:00:00Z`), status: "APPROVED" } }))!;
    await rejects(tasks.cancelCheckIn(c.ctxA, lastCi.id, { today: D(17) }), "REWARD_DEPOSITED");
    const settledPenalty = (await prisma.taskPenalty.findFirst({ where: { depositEntryId: e.id } }))!;
    await rejects(tasks.waivePenalty(c.ctxB, settledPenalty.id), "PENALTY_SETTLED");

    // 取消入金：轉帳與基金紀錄保留但作廢，獎金回到尚未入金
    await funds.cancelRewardDeposit(c.ctxB, e.id);
    assert.equal(await real(), 0);
    assert.equal(await balance(), pendingNet);
    assert.equal((await ledger.listAccounts(c.ctxA)).find((a) => a.id === c.joint)!.balance, accBefore.find((a) => a.id === c.joint)!.balance);
    assert.equal(await prisma.transaction.count({ where: { type: "TRANSFER", deletedAt: { not: null } } }), 1, "作廢的轉帳紀錄保留");
    await tasks.cancelCheckIn(c.ctxA, lastCi.id, { today: D(17) });

    // 入金後把錢用掉，就不能取消入金
    const e2 = await dep({ sourceAccountId: c.accB });
    await ledger.createTransaction(c.ctxA, { type: "EXPENSE", amount: 100, accountId: c.joint, categoryId: null, title: "用掉一點", note: "", occurredOn: D(17), split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] }, clientRequestId: rid(), fundId, fundAccountId: c.joint });
    await rejects(funds.cancelRewardDeposit(c.ctxA, e2.id), "FUND_NEGATIVE");

    // 懲罰比獎金多：不能入金
    const other = await funds.createFund(c.ctxA, { name: "懲罰很多的基金", targetAmount: null, dueDate: null });
    const lazy = await tasks.createTask(c.ctxA, input({ title: "晨跑", assigneeId: c.aId, rewardAmount: $(10), penaltyAmount: $(50), fundId: other.id, milestones: [] }), D(10));
    await tasks.checkIn(c.ctxA, lazy.id, { today: D(11) });
    await tasks.applyMissedPenalties(c.ctxA, D(13));
    await rejects(funds.depositRewards(c.ctxA, { fundId: other.id, targetAccountId: c.joint, sourceAccountId: c.accB, note: "", occurredOn: D(13), clientRequestId: rid() }), "REWARD_NET_NEGATIVE");
  });

  it("權限：一般內容雙方可改；獎金、懲罰、週期、基金、里程碑只有建立者能改；只有建立者能刪除；執行者停用當天未完成仍會被罰", async () => {
    const t = await tasks.createTask(c.ctxA, input({ title: "寫日記", assigneeId: c.bId, rewardAmount: $(20), penaltyAmount: $(10), penaltyText: "", milestones: [] }), D(10));
    const base = input({ title: "寫日記", assigneeId: c.bId, rewardAmount: $(20), penaltyAmount: $(10), penaltyText: "", milestones: [] });
    await tasks.updateTask(c.ctxB, t.id, { ...base, title: "寫日記 5 分鐘", description: "睡前", requiresPhoto: true, requiresApproval: true }, D(10));
    const updated = (await prisma.task.findUnique({ where: { id: t.id } }))!;
    assert.equal(updated.title, "寫日記 5 分鐘");
    assert.ok(updated.requiresPhoto && updated.requiresApproval);
    const general = { ...base, title: "寫日記 5 分鐘", description: "睡前", requiresPhoto: true, requiresApproval: true };
    await rejects(tasks.updateTask(c.ctxB, t.id, { ...general, rewardAmount: $(100) }, D(10)), "TASK_CREATOR_ONLY");
    await rejects(tasks.updateTask(c.ctxB, t.id, { ...general, penaltyAmount: 0 }, D(10)), "TASK_CREATOR_ONLY");
    await rejects(tasks.updateTask(c.ctxB, t.id, { ...general, penaltyText: "請吃飯" }, D(10)), "TASK_CREATOR_ONLY");
    await rejects(tasks.updateTask(c.ctxB, t.id, { ...general, frequency: "CUSTOM", daysOfWeek: 0b0111110 }, D(10)), "TASK_CREATOR_ONLY");
    await rejects(tasks.updateTask(c.ctxB, t.id, { ...general, milestones: [{ days: 3, bonusAmount: $(500), badgeEmoji: "🏅", badgeName: "偷加", rewardText: "" }] }, D(10)), "TASK_CREATOR_ONLY");
    await rejects(tasks.deleteTask(c.ctxB, t.id), "TASK_CREATOR_ONLY");
    await tasks.updateTask(c.ctxA, t.id, { ...general, rewardAmount: $(30) }, D(10)); // 建立者可以改

    // 9/12（排定日、懲罰已開始）執行者阿本沒做就停用 → 當天照樣記懲罰
    await tasks.updateTask(c.ctxB, t.id, { ...general, rewardAmount: $(30), isActive: false }, D(12));
    const ps = await prisma.taskPenalty.findMany({ where: { taskId: t.id }, orderBy: { date: "asc" } });
    assert.deepEqual(ps.map((p) => p.date.toISOString().slice(0, 10)), [D(11), D(12)], "11 號漏做 + 12 號停用當天");
    // 建立者小艾（不是執行者）停用另一個任務：不會替阿本記當天懲罰
    const t2 = await tasks.createTask(c.ctxA, input({ title: "倒垃圾", assigneeId: c.bId, rewardAmount: 0, penaltyAmount: $(10), milestones: [] }), D(10));
    await tasks.updateTask(c.ctxA, t2.id, input({ title: "倒垃圾", assigneeId: c.bId, rewardAmount: 0, penaltyAmount: $(10), milestones: [], isActive: false }), D(12));
    assert.deepEqual((await prisma.taskPenalty.findMany({ where: { taskId: t2.id } })).map((p) => p.date.toISOString().slice(0, 10)), [D(11)]);
    await tasks.deleteTask(c.ctxA, t.id);
  });

  it("所有金額都可追溯：實際基金金額 = FundTransaction 加總；尚未入金 = 未結算獎金 − 未結算懲罰", async () => {
    const d = (await funds.getFundDetail(c.ctxA, fundId))!;
    const ft = await prisma.fundTransaction.aggregate({ where: { fundId, deletedAt: null }, _sum: { amount: true } });
    assert.equal(d.summary.balance, ft._sum.amount ?? 0);
    const r = await prisma.taskReward.aggregate({ where: { fundId, deletedAt: null, depositEntryId: null }, _sum: { amount: true } });
    const p = await prisma.taskPenalty.aggregate({ where: { fundId, waivedAt: null, depositEntryId: null }, _sum: { amount: true } });
    assert.equal(d.pending.net, (r._sum.amount ?? 0) - (p._sum.amount ?? 0));
    const deposits = await prisma.fundTransaction.findMany({ where: { fundId, type: "REWARD_DEPOSIT", deletedAt: null }, include: { settledRewards: true, settledPenalties: true } });
    for (const dep of deposits) {
      const expected = dep.settledRewards.reduce((a, x) => a + x.amount, 0) - dep.settledPenalties.reduce((a, x) => a + x.amount, 0);
      assert.equal(dep.amount, expected, "每筆入金都能對回是哪些獎金與懲罰");
    }
  });
});
