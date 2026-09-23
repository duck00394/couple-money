/** Phase 2 權限與資料隔離：另一個帳本的人、同帳本另一半能做／不能做的事。 */
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rid, reset, rejects, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as goals from "../../src/server/services/goals";
import * as tasks from "../../src/server/services/tasks";
import * as attachments from "../../src/server/services/attachments";
import * as deletes from "../../src/server/services/deleteRequests";
import type { TaskInput } from "../../src/server/services/tasks";

const D = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082", "hex");
const file = () => ({ name: "p.png", type: "image/png", size: png.length, arrayBuffer: async () => new Uint8Array(png).buffer });

describe("Phase 2 權限與資料隔離", () => {
  let us: Awaited<ReturnType<typeof setupCouple>>;
  let them: Awaited<ReturnType<typeof setupCouple>>;
  let fundId = "";
  let goalId = "";
  let taskId = "";
  let checkInId = "";
  let photoId = "";
  const taskInput = (over: Partial<TaskInput> = {}): TaskInput => ({
    title: "早睡", description: "", emoji: "😴", scope: "PERSONAL", assigneeId: us.bId, frequency: "DAILY", daysOfWeek: 127,
    requiresApproval: true, requiresPhoto: false, rewardAmount: $(30), fundId, penaltyAmount: $(10), penaltyText: "", isActive: true, milestones: [], ...over,
  });

  before(async () => {
    await reset();
    us = await setupCouple("us");
    them = await setupCouple("them");
    fundId = (await funds.createFund(us.ctxA, { name: "我們的基金", targetAmount: null, dueDate: null })).id;
    goalId = (await goals.createGoal(us.ctxA, { name: "我們的目標", description: "", emoji: "", targetAmount: $(100), startDate: D(1), deadline: null, fundId, isActive: true })).id;
    taskId = (await tasks.createTask(us.ctxA, taskInput(), D(10))).id;
    photoId = (await attachments.saveUpload(us.ctxB, file())).id;
    checkInId = (await tasks.checkIn(us.ctxB, taskId, { today: D(10), photoId })).checkIn.id;
  });
  after(() => prisma.$disconnect());

  it("別的帳本：讀不到基金、目標、任務、照片、待確認清單", async () => {
    assert.equal(await funds.getFundDetail(them.ctxA, fundId), null);
    assert.equal((await funds.listFunds(them.ctxA)).length, 0);
    assert.equal(await goals.getGoal(them.ctxA, goalId), null);
    assert.equal(await tasks.getTaskDetail(them.ctxA, taskId), null);
    assert.equal((await tasks.taskBoard(them.ctxA)).cards.length, 0);
    assert.equal((await tasks.pendingReviews(them.ctxA)).length, 0);
    assert.equal((await tasks.listBadges(them.ctxA)).length, 0);
    assert.equal(await attachments.readAttachment(them.aId, photoId), null);
  });

  it("別的帳本：不能寫入、不能引用我們的基金或照片", async () => {
    await rejects(funds.addFundEntry(them.ctxA, { fundId, type: "DEPOSIT", amount: $(1), userId: them.aId, accountId: null, note: "", occurredOn: D(1), clientRequestId: rid() }), "FUND_NOT_FOUND");
    await rejects(funds.updateFund(them.ctxA, fundId, { name: "x", targetAmount: null, dueDate: null, isArchived: false }), "FUND_NOT_FOUND");
    await rejects(deletes.requestDelete(them.ctxA, "FUND", fundId), "FUND_NOT_FOUND");
    await rejects(goals.updateGoal(them.ctxA, goalId, { name: "x", description: "", emoji: "", targetAmount: $(1), startDate: D(1), deadline: null, fundId: null, isActive: true }), "GOAL_NOT_FOUND");
    await rejects(deletes.requestDelete(them.ctxA, "GOAL", goalId), "GOAL_NOT_FOUND");
    const req = await deletes.requestDelete(us.ctxA, "GOAL", goalId);
    await rejects(deletes.decideDelete(them.ctxA, req.request!.id, "APPROVE"), "DELETE_REQUEST_NOT_FOUND");
    assert.equal((await deletes.pendingDeleteRequests(them.ctxA)).length, 0);
    await deletes.decideDelete(us.ctxA, req.request!.id, "CANCEL");
    await rejects(funds.depositRewards(them.ctxA, { fundId, targetAccountId: them.joint, sourceAccountId: null, note: "", occurredOn: D(10), clientRequestId: rid() }), "FUND_NOT_FOUND");
    // 用別人帳本的帳戶投入自己的基金也不行
    const theirFund = await funds.createFund(them.ctxA, { name: "他們的基金", targetAmount: null, dueDate: null });
    await rejects(funds.addFundEntry(them.ctxA, { fundId: theirFund.id, type: "DEPOSIT", amount: 1, userId: them.aId, accountId: us.joint, note: "", occurredOn: D(1), clientRequestId: rid() }), "FUND_ACCOUNT");
    await rejects(goals.createGoal(them.ctxA, { name: "偷連", description: "", emoji: "", targetAmount: $(1), startDate: D(1), deadline: null, fundId, isActive: true }), "FUND_NOT_FOUND");
    await rejects(tasks.createTask(them.ctxA, taskInput({ assigneeId: them.aId })), "FUND_NOT_FOUND");
    await rejects(tasks.checkIn(them.ctxA, taskId, { today: D(10) }), "TASK_NOT_FOUND");
    await rejects(tasks.reviewCheckIn(them.ctxA, checkInId, true), "CHECKIN_NOT_FOUND");
    await rejects(tasks.cancelCheckIn(them.ctxA, checkInId, { today: D(10) }), "CHECKIN_NOT_FOUND");
    await rejects(tasks.updateTask(them.ctxA, taskId, taskInput({ assigneeId: them.aId, fundId: null, rewardAmount: 0, penaltyAmount: 0 }), D(10)), "TASK_NOT_FOUND");
    await rejects(tasks.deleteTask(them.ctxA, taskId), "TASK_NOT_FOUND");
    await rejects(ledger.createTransaction(them.ctxA, {
      type: "EXPENSE", amount: $(10), accountId: them.accA, categoryId: null, title: "", note: "", occurredOn: D(10),
      split: { method: "FULL", participants: [{ userId: them.aId }] }, clientRequestId: rid(), fundId,
    }), "FUND_NOT_FOUND");
    // 用別人帳本的照片打卡
    const theirTask = await tasks.createTask(them.ctxA, taskInput({ assigneeId: them.aId, fundId: null, rewardAmount: 0, penaltyAmount: 0, requiresApproval: false }), D(10));
    await rejects(tasks.checkIn(them.ctxA, theirTask.id, { today: D(10), photoId }), "CHECKIN_PHOTO");
    const penalty = await prisma.taskPenalty.create({ data: { bookId: us.ctxA.book.id, taskId, subjectKey: us.bId, userId: us.bId, date: new Date("2026-09-09T00:00:00Z"), createdById: us.aId } });
    await rejects(tasks.waivePenalty(them.ctxA, penalty.id), "PENALTY_NOT_FOUND");
    await prisma.taskPenalty.delete({ where: { id: penalty.id } });
  });

  it("同帳本：打卡的人不能確認自己、不能免除自己的懲罰；另一半不能修改或取消別人的打卡", async () => {
    await rejects(tasks.reviewCheckIn(us.ctxB, checkInId, true), "CHECKIN_SELF_REVIEW");
    await rejects(tasks.editCheckIn(us.ctxA, checkInId, { note: "改掉" }), "CHECKIN_NOT_MINE");
    await rejects(tasks.cancelCheckIn(us.ctxA, checkInId, { today: D(10) }), "CHECKIN_NOT_MINE");
    await rejects(tasks.checkIn(us.ctxA, taskId, { today: D(10) }), "TASK_NOT_MINE");
    assert.ok(await attachments.readAttachment(us.aId, photoId), "另一半可以看照片（確認用）");
    await tasks.reviewCheckIn(us.ctxA, checkInId, true);

    await tasks.applyMissedPenalties(us.ctxA, D(13)); // 11、12 沒做
    const [p] = await prisma.taskPenalty.findMany({ where: { taskId }, orderBy: { date: "asc" } });
    await rejects(tasks.waivePenalty(us.ctxB, p.id), "PENALTY_SELF");
    await tasks.waivePenalty(us.ctxA, p.id);
  });

  it("懲罰邊界：停用不能規避當天懲罰、停用期間不罰；重新啟用或改週期後從隔天開始算；改設定前先用舊設定結算", async () => {
    const t = await tasks.createTask(us.ctxA, taskInput({ title: "記帳", assigneeId: us.aId, requiresApproval: false, rewardAmount: 0 }), D(1));
    // 2～4 號沒做 → 5 號打開時產生 3 筆
    assert.equal(await tasks.applyMissedPenalties(us.ctxA, D(5)), 3 + 0);
    // 5 號停用
    await tasks.updateTask(us.ctxA, t.id, taskInput({ title: "記帳", assigneeId: us.aId, requiresApproval: false, rewardAmount: 0, isActive: false }), D(5));
    assert.equal(await tasks.applyMissedPenalties(us.ctxA, D(9)), 0, "停用中不產生");
    // 9 號重新啟用 → 5～8 號（停用期間）不罰、9 號當天也不罰，從 10 號起算
    await tasks.updateTask(us.ctxA, t.id, taskInput({ title: "記帳", assigneeId: us.aId, requiresApproval: false, rewardAmount: 0, isActive: true }), D(9));
    assert.equal(await tasks.applyMissedPenalties(us.ctxA, D(10)), 0);
    const created = await tasks.applyMissedPenalties(us.ctxA, D(12));
    const dates = (await prisma.taskPenalty.findMany({ where: { taskId: t.id }, orderBy: { date: "asc" } })).map((p) => p.date.toISOString().slice(0, 10));
    assert.deepEqual(dates, [D(2), D(3), D(4), D(5), D(10), D(11)], "5 號是執行者本人在沒完成時停用 → 當天照罰；6～9 停用期間不罰");
    assert.ok(created >= 2);
  });

  it("離開帳本的人看不到照片", async () => {
    await prisma.bookMember.update({ where: { bookId_userId: { bookId: us.ctxA.book.id, userId: us.aId } }, data: { status: "LEFT" } });
    assert.equal(await attachments.readAttachment(us.aId, photoId), null);
    await prisma.bookMember.update({ where: { bookId_userId: { bookId: us.ctxA.book.id, userId: us.aId } }, data: { status: "ACTIVE" } });
  });
});
