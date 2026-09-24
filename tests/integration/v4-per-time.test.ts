import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as tasks from "../../src/server/services/tasks";
import * as rewards from "../../src/server/services/rewards";
import * as ledger from "../../src/server/services/ledger";
import type { TaskInput } from "../../src/server/services/tasks";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;

const base = (over: Partial<TaskInput> = {}): TaskInput => ({
  title: "洗碗", description: "", emoji: "utensils",
  scope: "EACH", assigneeId: null, frequency: "PER_TIME", daysOfWeek: 127,
  requiresApproval: false, requiresPhoto: false,
  rewardAmount: $(30), fundId: null, penaltyAmount: 0, penaltyText: "",
  isActive: true, milestones: [], ...over,
});

/**
 * V4：「每次」任務（做一次賺一次）與任務複製。
 *
 * 重點是三件事：
 *   1. 每次任務同一天可以打很多次，每次各自一筆 CheckIn 與一筆獎勵
 *   2. 既有的每日／每週防重複完全沒有被弄壞
 *   3. 每次任務不會產生懲罰
 */
describe("V4：每次任務與任務複製", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  const bal = async (userId: string) => (await rewards.rewardBalance(c.ctxA, userId)).balance;

  before(async () => {
    await reset();
    c = await setupCouple("pt");
  });
  after(() => prisma.$disconnect());

  it("1. 每日任務：同一天第二次會被擋下來（既有防重複沒有被弄壞）", async () => {
    const t = (await tasks.createTask(c.ctxA, base({ title: "每日讀英文", frequency: "DAILY" }), D(1))).id;
    await tasks.checkIn(c.ctxA, t, { today: D(2) });
    await rejects(tasks.checkIn(c.ctxA, t, { today: D(2) }), "CHECKIN_DUP");
    assert.equal(await prisma.checkIn.count({ where: { taskId: t, subjectKey: c.aId } }), 1);
    // 隔天可以再打一次
    await tasks.checkIn(c.ctxA, t, { today: D(3) });
    assert.equal(await prisma.checkIn.count({ where: { taskId: t, subjectKey: c.aId } }), 2);
  });

  it("2. 每週任務：不綁星期幾，一週內任一天完成一次", async () => {
    // 2026-09-07 是星期一、09-09 星期三、09-13 星期日、09-14 下週一
    const t = (await tasks.createTask(c.ctxA, base({ title: "每週大掃除", frequency: "WEEKLY", daysOfWeek: 0 }), D(1))).id;
    const task = await prisma.task.findUniqueOrThrow({ where: { id: t } });
    assert.equal(task.daysOfWeek, 127, "每週任務不綁星期幾");

    await tasks.checkIn(c.ctxA, t, { today: D(9) });                                   // 週三完成
    await rejects(tasks.checkIn(c.ctxA, t, { today: D(9) }), "CHECKIN_WEEK_DUP");       // 同一天再按
    await rejects(tasks.checkIn(c.ctxA, t, { today: D(11) }), "CHECKIN_WEEK_DUP");      // 同一週的其他天
    await rejects(tasks.checkIn(c.ctxA, t, { today: D(13) }), "CHECKIN_WEEK_DUP");      // 週日仍然算本週
    await tasks.checkIn(c.ctxA, t, { today: D(14) });                                   // 下週一重新開放

    assert.equal(await prisma.checkIn.count({ where: { taskId: t, subjectKey: c.aId, status: "APPROVED" } }), 2);
    assert.equal(await prisma.taskReward.count({ where: { taskId: t, userId: c.aId } }), 2, "一週一筆獎勵");
  });

  it("2b. 每週 × EACH：A 本週完成不影響 B，B 仍然可以完成", async () => {
    const solo = await setupCouple("wk");
    const t = (await tasks.createTask(solo.ctxA, base({ title: "每週運動", frequency: "WEEKLY", rewardAmount: $(100) }), D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(7) });
    await rejects(tasks.checkIn(solo.ctxA, t, { today: D(10) }), "CHECKIN_WEEK_DUP");
    await tasks.checkIn(solo.ctxB, t, { today: D(10) }); // B 這週還沒做，做得到

    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, $(100));
    assert.equal((await rewards.rewardBalance(solo.ctxB, solo.bId)).balance, $(100));
    await rejects(tasks.checkIn(solo.ctxB, t, { today: D(12) }), "CHECKIN_WEEK_DUP");
  });

  it("2c. 每週 × SHARED：一人完成就算整組完成，這週另一半也不能再按", async () => {
    const solo = await setupCouple("wks");
    const t = (await tasks.createTask(solo.ctxA, base({ title: "每週採買", frequency: "WEEKLY", scope: "SHARED", rewardAmount: $(40) }), D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(8) });
    await rejects(tasks.checkIn(solo.ctxB, t, { today: D(10) }), "CHECKIN_WEEK_DUP");
    await tasks.checkIn(solo.ctxB, t, { today: D(15) }); // 下一週換 B 做
    assert.equal(await prisma.checkIn.count({ where: { taskId: t, subjectKey: "COUPLE" } }), 2);
  });

  it("2d. 每週的統計與佈告欄以「週」為單位", async () => {
    const solo = await setupCouple("wkb");
    const t = (await tasks.createTask(solo.ctxA, base({ title: "每週閱讀", frequency: "WEEKLY", scope: "PERSONAL", assigneeId: solo.aId }), D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(9) });

    const board = await tasks.taskBoard(solo.ctxA, D(11));
    const card = board.cards.find((x) => x.task.id === t)!;
    assert.equal(card.weekly, true);
    assert.equal(card.doneThisWeek, true);
    assert.equal(card.canCheckIn, false, "本週做過了就不能再做");
    assert.equal(card.stats.weekDone, 1);
    assert.equal(card.stats.weekScheduled, 1, "分母是 1 週，不是 7 天");
    assert.equal(card.stats.current, 1, "連續 1 週");

    // 下一週重新開放
    const next = await tasks.taskBoard(solo.ctxA, D(14));
    const nextCard = next.cards.find((x) => x.task.id === t)!;
    assert.equal(nextCard.doneThisWeek, false);
    assert.equal(nextCard.canCheckIn, true);
    assert.equal(nextCard.stats.current, 1, "上一週有做，這週還沒做不算中斷");
  });

  it("2e. 每週漏做：整整一週沒做才算一次懲罰（不是每天一次）", async () => {
    const solo = await setupCouple("wkp");
    const t = (await tasks.createTask(solo.ctxA, base({
      title: "每週回老家", frequency: "WEEKLY", scope: "PERSONAL", assigneeId: solo.aId,
      penaltyAmount: $(20), penaltyText: "",
    }), D(7))).id;
    // 建立當週不罰（可能是週末才建的），所以第一個完整的觀察週是 09-14 ~ 09-20
    await tasks.applyMissedPenalties(solo.ctxA, D(23));
    const ps = await prisma.taskPenalty.findMany({ where: { taskId: t }, orderBy: { date: "asc" } });
    assert.equal(ps.length, 1, `一週最多一筆，不是一天一筆，實際 ${ps.length}`);
    assert.equal(ps[0].date.toISOString().slice(0, 10), D(20), "記在那一週的星期日");
    assert.equal(ps[0].amount, $(20));

    // 再跑一次不會重複記
    await tasks.applyMissedPenalties(solo.ctxA, D(23));
    assert.equal(await prisma.taskPenalty.count({ where: { taskId: t } }), 1);

    // 又過了一整週還是沒做 → 再多一筆，總共兩筆（不是 14 筆）
    await tasks.applyMissedPenalties(solo.ctxA, D(30));
    const all = await prisma.taskPenalty.findMany({ where: { taskId: t }, orderBy: { date: "asc" } });
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((x) => x.date.toISOString().slice(0, 10)), [D(20), D(27)]);
  });

  it("2f. 每週有做就不會被罰", async () => {
    const solo = await setupCouple("wkp2");
    const t = (await tasks.createTask(solo.ctxA, base({
      title: "每週倒回收", frequency: "WEEKLY", scope: "PERSONAL", assigneeId: solo.aId,
      penaltyAmount: $(20), penaltyText: "",
    }), D(7))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(17) }); // 09-14 那一週有做
    await tasks.applyMissedPenalties(solo.ctxA, D(23));
    assert.equal(await prisma.taskPenalty.count({ where: { taskId: t } }), 0);
  });

  it("3. 每次任務：同一天可以完成兩次，兩筆 CheckIn、兩筆獎勵", async () => {
    const t = (await tasks.createTask(c.ctxA, base({ title: "倒垃圾" }), D(1))).id;
    const before2 = await bal(c.aId);
    await tasks.checkIn(c.ctxA, t, { today: D(5) });
    await tasks.checkIn(c.ctxA, t, { today: D(5) });

    const rows = await prisma.checkIn.findMany({ where: { taskId: t, subjectKey: c.aId }, orderBy: { seq: "asc" } });
    assert.equal(rows.length, 2, "同一天兩筆 CheckIn");
    assert.deepEqual(rows.map((r) => r.seq), [0, 1], "靠 seq 區分，不是靠日期");
    assert.equal(await prisma.taskReward.count({ where: { taskId: t, userId: c.aId } }), 2, "兩筆獨立的獎勵");
    assert.equal(await bal(c.aId) - before2, $(60), "賺兩次");
  });

  it("4. 每次 × EACH：A 做兩次拿 60、B 做一次拿 30，互不影響", async () => {
    const t = (await tasks.createTask(c.ctxA, base({ title: "洗碗（各自）" }), D(1))).id;
    const a0 = await bal(c.aId);
    const b0 = await bal(c.bId);
    await tasks.checkIn(c.ctxA, t, { today: D(6) });
    await tasks.checkIn(c.ctxA, t, { today: D(6) });
    await tasks.checkIn(c.ctxB, t, { today: D(6) });

    assert.equal(await bal(c.aId) - a0, $(60));
    assert.equal(await bal(c.bId) - b0, $(30));
    assert.equal(await prisma.checkIn.count({ where: { taskId: t, subjectKey: c.aId } }), 2);
    assert.equal(await prisma.checkIn.count({ where: { taskId: t, subjectKey: c.bId } }), 1);
  });

  it("5. 每次任務不能設定懲罰，也不會因為沒做而扣錢", async () => {
    await rejects(
      tasks.createTask(c.ctxA, base({ title: "不該有懲罰", penaltyAmount: $(10) }), D(1)),
      "TASK_PER_TIME_PENALTY",
    );
    const t = (await tasks.createTask(c.ctxA, base({ title: "隨手擦桌子" }), D(1))).id;
    // 從建立日之後過了很多天都沒做，補罰程序跑過也不會產生任何懲罰
    await tasks.applyMissedPenalties(c.ctxA, D(20));
    assert.equal(await prisma.taskPenalty.count({ where: { taskId: t } }), 0);
  });

  it("6. 每次任務的獎勵可以提列，提列後不能再提一次", async () => {
    const solo = await setupCouple("ptw");
    const t = (await tasks.createTask(solo.ctxA, base({ title: "曬衣服" }), D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(8) });
    await tasks.checkIn(solo.ctxA, t, { today: D(8) });
    await tasks.checkIn(solo.ctxA, t, { today: D(9) });

    const tx = await rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() });
    assert.equal(tx.type, "INCOME");
    assert.equal(tx.amount, $(90), "三次 × 30");
    assert.equal((await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance, $(90));

    const rs = await prisma.taskReward.findMany({ where: { taskId: t } });
    assert.equal(rs.length, 3);
    assert.ok(rs.every((r) => r.withdrawalId === tx.id), "每一次的獎勵都指得回那筆收入");
    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, 0);
    await rejects(rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() }), "REWARD_NOTHING");
  });

  it("7. 佈告欄會算出今天做了幾次、今天賺了多少", async () => {
    const solo = await setupCouple("ptb");
    const t = (await tasks.createTask(solo.ctxA, base({ title: "澆花" }), D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(10) });
    await tasks.checkIn(solo.ctxA, t, { today: D(10) });

    const board = await tasks.taskBoard(solo.ctxA, D(10));
    const mine = board.cards.find((x) => x.task.id === t && x.subjectKey === solo.aId)!;
    assert.equal(mine.perTime, true);
    assert.equal(mine.todayCount, 2);
    assert.equal(mine.todayReward, $(60));
    assert.equal(mine.canCheckIn, true, "還可以再做一次");
  });

  it("7b. 每週的獎勵可以正常提列，金額是「完成幾週 × 獎金」", async () => {
    const solo = await setupCouple("wkw");
    const t = (await tasks.createTask(solo.ctxA, base({
      title: "每週運動", frequency: "WEEKLY", scope: "PERSONAL", assigneeId: solo.aId, rewardAmount: $(100),
    }), D(1))).id;
    await tasks.checkIn(solo.ctxA, t, { today: D(9) });   // 09-07 那一週
    await tasks.checkIn(solo.ctxA, t, { today: D(16) });  // 09-14 那一週
    assert.equal((await rewards.rewardBalance(solo.ctxA, solo.aId)).balance, $(200));

    const tx = await rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() });
    assert.equal(tx.type, "INCOME");
    assert.equal(tx.amount, $(200));
    assert.equal((await ledger.listAccounts(solo.ctxA)).find((a) => a.id === solo.accA)!.balance, $(200));
    const rs = await prisma.taskReward.findMany({ where: { taskId: t } });
    assert.ok(rs.every((r) => r.withdrawalId === tx.id));
    await rejects(rewards.withdrawRewards(solo.ctxA, { accountId: solo.accA, clientRequestId: rid() }), "REWARD_NOTHING");
  });

  it("7c. 每週的新規則沒有影響每日與每次", async () => {
    const solo = await setupCouple("wkx");
    const daily = (await tasks.createTask(solo.ctxA, base({ title: "每日讀書", frequency: "DAILY", scope: "PERSONAL", assigneeId: solo.aId }), D(1))).id;
    const each = (await tasks.createTask(solo.ctxA, base({ title: "隨手擦桌", frequency: "PER_TIME", scope: "PERSONAL", assigneeId: solo.aId }), D(1))).id;

    // 每日：同一天第二次被擋，但同一週的每一天都做得到
    await tasks.checkIn(solo.ctxA, daily, { today: D(7) });
    await rejects(tasks.checkIn(solo.ctxA, daily, { today: D(7) }), "CHECKIN_DUP");
    for (const day of [8, 9, 10, 11]) await tasks.checkIn(solo.ctxA, daily, { today: D(day) });
    assert.equal(await prisma.checkIn.count({ where: { taskId: daily } }), 5, "每日仍然是一天一次、一週可以五次");

    // 每次：同一天做三次都可以
    for (let i = 0; i < 3; i++) await tasks.checkIn(solo.ctxA, each, { today: D(7) });
    assert.equal(await prisma.checkIn.count({ where: { taskId: each } }), 3);

    const board = await tasks.taskBoard(solo.ctxA, D(11));
    assert.equal(board.cards.find((x) => x.task.id === daily)!.weekly, false);
    assert.equal(board.cards.find((x) => x.task.id === each)!.weekly, false);
  });

  it("8. 複製任務：新的 ID、帶走設定、不帶走任何歷史", async () => {
    const solo = await setupCouple("ptc");
    const src = await tasks.createTask(solo.ctxA, base({
      title: "遛狗", description: "早晚各一次", emoji: "dog", rewardAmount: $(25),
      milestones: [{ days: 7, bonusAmount: $(100), badgeEmoji: "trophy", badgeName: "一週達人", rewardText: "" }],
    }), D(1));
    await tasks.checkIn(solo.ctxA, src.id, { today: D(11) });
    await tasks.checkIn(solo.ctxA, src.id, { today: D(11) });

    const copy = await tasks.duplicateTask(solo.ctxA, src.id, D(12));
    assert.notEqual(copy.id, src.id, "是一個全新的任務");
    assert.equal(copy.title, "遛狗 (複製)");
    assert.equal(copy.description, "早晚各一次");
    assert.equal(copy.emoji, "dog");
    assert.equal(copy.frequency, "PER_TIME");
    assert.equal(copy.scope, "EACH");
    assert.equal(copy.rewardAmount, $(25));
    assert.equal(copy.fundId, src.fundId);

    assert.equal(await prisma.checkIn.count({ where: { taskId: copy.id } }), 0, "不複製打卡");
    assert.equal(await prisma.taskReward.count({ where: { taskId: copy.id } }), 0, "不複製獎勵");
    assert.equal(await prisma.taskPenalty.count({ where: { taskId: copy.id } }), 0, "不複製懲罰");
    assert.equal(await prisma.checkIn.count({ where: { taskId: src.id } }), 2, "原本的歷史不受影響");
    assert.equal(await prisma.taskMilestone.count({ where: { taskId: copy.id } }), 1, "里程碑設定有帶過去");
  });

  it("9. 複製每日任務：複製出來的那份，今天仍然只能打一次", async () => {
    const solo = await setupCouple("ptd");
    const src = await tasks.createTask(solo.ctxA, base({ title: "早起", frequency: "DAILY", scope: "PERSONAL", assigneeId: solo.aId }), D(1));
    const copy = await tasks.duplicateTask(solo.ctxA, src.id, D(13));
    await tasks.checkIn(solo.ctxA, copy.id, { today: D(13) });
    await rejects(tasks.checkIn(solo.ctxA, copy.id, { today: D(13) }), "CHECKIN_DUP");
    // 原任務與複製出來的是兩筆獨立的紀錄，互不影響
    await tasks.checkIn(solo.ctxA, src.id, { today: D(13) });
  });
});
