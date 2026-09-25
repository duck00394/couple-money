import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, reset, setupCouple, prisma } from "./helpers";
import * as tasks from "../../src/server/services/tasks";
import * as rewards from "../../src/server/services/rewards";
import * as funds from "../../src/server/services/funds";
import * as ledger from "../../src/server/services/ledger";
import { monthStats } from "../../src/server/services/stats";
import type { TaskInput } from "../../src/server/services/tasks";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;

/**
 * A-1：EACH 任務 + 個人獎勵餘額。
 *
 * 最重要的兩條：
 *   ① 兩個人各自完成、各自拿自己的獎勵，互不影響
 *   ② 獎勵完全不碰 Transaction / 帳戶餘額 / 統計收入
 */
describe("V3 A-1：EACH 任務與個人獎勵餘額", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let fundId = "";

  const input = (over: Partial<TaskInput> = {}): TaskInput => ({
    title: "每日讀英文", description: "", emoji: "book",
    scope: "EACH", assigneeId: null, frequency: "DAILY", daysOfWeek: 127,
    requiresApproval: false, requiresPhoto: false,
    rewardAmount: $(50), fundId: null, penaltyAmount: 0, penaltyText: "",
    isActive: true, milestones: [],
    ...over,
  });

  const bal = async (userId: string) => (await rewards.rewardBalance(c.ctxA, userId)).balance;

  before(async () => {
    await reset();
    c = await setupCouple("rw");
    fundId = (await funds.createFund(c.ctxA, { name: "日本旅遊", targetAmount: $(20000), dueDate: null })).id;
  });
  after(() => prisma.$disconnect());

  // ───────── 1～3：各自完成、各自拿獎勵 ─────────

  let english = "";

  it("1. A 完成 → 只有 A 的餘額 +$50，B 完全不動", async () => {
    english = (await tasks.createTask(c.ctxA, input(), D(1))).id;
    assert.equal(await bal(c.aId), 0);
    assert.equal(await bal(c.bId), 0);

    await tasks.checkIn(c.ctxA, english, { today: D(2) });

    assert.equal(await bal(c.aId), $(50), "A 拿到自己的獎勵");
    assert.equal(await bal(c.bId), 0, "B 沒有因為 A 完成而拿到任何東西");
  });

  it("2. B 當天沒完成 → B 沒有任何 TaskReward", async () => {
    const rows = await prisma.taskReward.findMany({ where: { taskId: english, userId: c.bId } });
    assert.equal(rows.length, 0);
  });

  it("3. 同一天兩個人都完成 → 各自 +$50，兩筆 CheckIn 的 subjectKey 不同", async () => {
    await tasks.checkIn(c.ctxB, english, { today: D(2) }); // 同一天、A 已經完成過
    assert.equal(await bal(c.aId), $(50));
    assert.equal(await bal(c.bId), $(50));

    const cis = await prisma.checkIn.findMany({ where: { taskId: english, date: new Date(`${D(2)}T00:00:00Z`) }, orderBy: { subjectKey: "asc" } });
    assert.equal(cis.length, 2, "兩個人各一筆打卡");
    assert.deepEqual(new Set(cis.map((x) => x.subjectKey)), new Set([c.aId, c.bId]));
    assert.equal(new Set(cis.map((x) => x.subjectKey)).size, 2, "subjectKey 互不相同");
  });

  // ───────── 4～5：防重複 ─────────

  it("4. 同一人、同一任務、同一天不能重複拿獎勵", async () => {
    await rejects(tasks.checkIn(c.ctxA, english, { today: D(2) }), "CHECKIN_DUP");
    const mine = await prisma.taskReward.findMany({ where: { taskId: english, userId: c.aId, deletedAt: null } });
    assert.equal(mine.length, 1, "還是只有一筆獎勵");
    assert.equal(await bal(c.aId), $(50));
  });

  it("5. 連點兩下（併發同時送出）也只會有一筆獎勵", async () => {
    const before = await bal(c.aId);
    const results = await Promise.allSettled([
      tasks.checkIn(c.ctxA, english, { today: D(3) }),
      tasks.checkIn(c.ctxA, english, { today: D(3) }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "只有一次成功");
    const day3 = await prisma.taskReward.findMany({
      where: { taskId: english, userId: c.aId, deletedAt: null, checkIn: { date: new Date(`${D(3)}T00:00:00Z`) } },
    });
    assert.equal(day3.length, 1);
    assert.equal(await bal(c.aId), before + $(50));
  });

  // ───────── 6～7：不綁基金也能有獎勵 ─────────

  it("6. 沒有綁基金的任務照樣發獎勵（獎勵不再依附基金）", async () => {
    const solo = await tasks.createTask(c.ctxA, input({ title: "早起", rewardAmount: $(30), fundId: null }), D(1));
    assert.equal(solo.fundId, null);
    const before = await bal(c.aId);
    await tasks.checkIn(c.ctxA, solo.id, { today: D(4) });
    assert.equal(await bal(c.aId), before + $(30));

    const r = await prisma.taskReward.findFirstOrThrow({ where: { taskId: solo.id, userId: c.aId } });
    assert.equal(r.fundId, null, "沒有預設提列目標也沒關係");
    assert.equal(r.depositEntryId, null, "還在餘額裡");
  });

  it("7. 綁了基金的 EACH 任務，獎勵仍然記在個人身上", async () => {
    const t = await tasks.createTask(c.ctxA, input({ title: "運動", rewardAmount: $(20), fundId }), D(1));
    await tasks.checkIn(c.ctxB, t.id, { today: D(4) });
    const r = await prisma.taskReward.findFirstOrThrow({ where: { taskId: t.id } });
    assert.equal(r.userId, c.bId);
    assert.equal(r.fundId, fundId, "fundId 只是預設提列目標");
    assert.equal(await bal(c.bId), $(50) + $(20));
  });

  // ───────── 8～9：里程碑與收回 ─────────

  it("8. 里程碑獎金也進同一個人的餘額", async () => {
    const t = await tasks.createTask(c.ctxA, input({
      title: "喝水", rewardAmount: $(10),
      milestones: [{ days: 3, bonusAmount: $(100), badgeEmoji: "medal", badgeName: "三天", rewardText: "" }],
    }), D(5));
    const before = await bal(c.aId);
    for (const d of [5, 6, 7]) await tasks.checkIn(c.ctxA, t.id, { today: D(d) });
    assert.equal(await bal(c.aId), before + $(10) * 3 + $(100), "三次打卡 + 一次里程碑");

    const ms = await prisma.taskReward.findMany({ where: { taskId: t.id, kind: "MILESTONE" } });
    assert.equal(ms.length, 1);
    assert.equal(ms[0].userId, c.aId, "里程碑歸給達成的人");
  });

  it("9. 取消打卡會把那筆獎勵收回，餘額同步變少", async () => {
    const t = await tasks.createTask(c.ctxA, input({ title: "冥想", rewardAmount: $(40) }), D(8));
    await tasks.checkIn(c.ctxB, t.id, { today: D(8) });
    const after = await bal(c.bId);
    const ci = await prisma.checkIn.findFirstOrThrow({ where: { taskId: t.id, subjectKey: c.bId } });

    await tasks.cancelCheckIn(c.ctxB, ci.id, { today: D(8) });
    assert.equal(await bal(c.bId), after - $(40), "餘額回到取消前");

    const r = await prisma.taskReward.findFirstOrThrow({ where: { checkInId: ci.id } });
    assert.ok(r.deletedAt, "紀錄保留，只是標記收回");
  });

  // ───────── 10～11：懲罰 ─────────

  it("10. EACH 的懲罰各自歸屬，不會扣到另一個人", async () => {
    const t = await tasks.createTask(c.ctxA, input({ title: "記帳", rewardAmount: 0, penaltyAmount: $(15) }), D(9));
    const aBefore = await bal(c.aId);
    const bBefore = await bal(c.bId);
    // 10 號 B 有做、A 沒做；11 號當作「今天」，所以 10 號會結算
    await tasks.checkIn(c.ctxB, t.id, { today: D(10) });
    await tasks.applyMissedPenalties(c.ctxA, D(11));

    const ps = await prisma.taskPenalty.findMany({ where: { taskId: t.id } });
    assert.equal(ps.length, 1, "只有沒做的那個人被罰");
    assert.equal(ps[0].userId, c.aId);
    assert.equal(ps[0].subjectKey, c.aId);
    assert.equal(await bal(c.aId), aBefore - $(15));
    assert.equal(await bal(c.bId), bBefore, "有做的人完全不受影響");
  });

  it("11. 重複執行 applyMissedPenalties 不會重複罰", async () => {
    const a = await bal(c.aId);
    await tasks.applyMissedPenalties(c.ctxA, D(11));
    await tasks.applyMissedPenalties(c.ctxB, D(11));
    assert.equal(await bal(c.aId), a);
  });

  // ───────── 12～13：舊 SHARED 完全不受影響 ─────────

  it("12. 既有 SHARED 任務維持「一人完成就算」的舊語意", async () => {
    const sharedTask = await tasks.createTask(c.ctxA, input({ title: "一起散步", scope: "SHARED", rewardAmount: $(25) }), D(12));
    await tasks.checkIn(c.ctxA, sharedTask.id, { today: D(13) });
    await rejects(tasks.checkIn(c.ctxB, sharedTask.id, { today: D(13) }), "CHECKIN_DUP");

    const cis = await prisma.checkIn.findMany({ where: { taskId: sharedTask.id } });
    assert.equal(cis.length, 1, "共同任務一天只有一筆進度");
    assert.equal(cis[0].subjectKey, "COUPLE", "subjectKey 仍然是 COUPLE");
  });

  it("13. SHARED 的獎勵歸給實際打卡的人；SHARED 的懲罰不歸屬任何人", async () => {
    const r = await prisma.taskReward.findFirstOrThrow({ where: { task: { title: "一起散步" } } });
    assert.equal(r.userId, c.aId, "誰打卡就記給誰");

    // 用一組乾淨的帳本，避免其他任務的漏做懲罰干擾餘額比對
    const s2 = await setupCouple("sh");
    const t = await tasks.createTask(s2.ctxA, input({ title: "共同倒垃圾", scope: "SHARED", rewardAmount: 0, penaltyAmount: $(60) }), D(14));
    const aBefore = (await rewards.rewardBalance(s2.ctxA, s2.aId)).balance;
    const bBefore = (await rewards.rewardBalance(s2.ctxA, s2.bId)).balance;
    await tasks.applyMissedPenalties(s2.ctxA, D(16));

    const p = await prisma.taskPenalty.findFirstOrThrow({ where: { taskId: t.id } });
    assert.equal(p.subjectKey, "COUPLE");
    assert.equal(p.userId, null, "共同任務的懲罰沒有歸屬");
    assert.ok(p.amount > 0, "金額還是有記下來");
    assert.equal((await rewards.rewardBalance(s2.ctxA, s2.aId)).balance, aBefore, "所以誰的餘額都不扣");
    assert.equal((await rewards.rewardBalance(s2.ctxA, s2.bId)).balance, bBefore);
  });

  // ───────── 14～15：餘額與明細對得起來 ─────────

  it("14. 餘額永遠等於明細的加總（可追溯）", async () => {
    for (const id of [c.aId, c.bId]) {
      const check = await rewards.rewardCheck(c.ctxA, id);
      assert.ok(check.consistent, `${id} 的餘額 ${check.balance} 與明細 ${check.fromMovements} 對不起來`);
    }
  });

  it("15. 明細每一筆都對得到任務與金額", async () => {
    const moves = await rewards.rewardStatement(c.ctxA, c.aId, { take: 1000 });
    assert.ok(moves.length > 0);
    for (const m of moves) {
      assert.ok(m.taskTitle.length > 0, "有任務名稱");
      assert.ok(m.amount !== 0, "有金額");
      assert.ok(["TASK_REWARD", "MILESTONE_BONUS", "TASK_PENALTY"].includes(m.kind));
      if (m.kind === "TASK_PENALTY") assert.ok(m.amount < 0);
      else assert.ok(m.amount > 0);
    }
    const both = await rewards.rewardBalances(c.ctxA);
    assert.equal(both.size, 2, "兩個人都有一筆（沒有紀錄的人餘額是 0）");
  });

  // ───────── 16～18：完全不污染既有財務 ─────────

  it("16. 整段流程沒有產生任何 Transaction，帳戶餘額一個都沒變", async () => {
    const accounts = await ledger.listAccounts(c.ctxA);
    const openingOnly = await prisma.transaction.findMany({ where: { bookId: c.ctxA.book.id } });
    assert.ok(openingOnly.every((t) => t.type === "OPENING_BALANCE"), "只有建立帳戶時的期初餘額");
    // 期初餘額以外沒有任何金流
    assert.equal(accounts.filter((a) => a.balance !== 0).length, 0, "沒有任何帳戶被動到");
  });

  it("17. 任務獎勵不會被算成收入", async () => {
    const s = await monthStats(c.ctxA, MONTH);
    assert.equal(s.totals.income, 0, "獎勵不是收入");
    assert.equal(s.totals.expense, 0);
    assert.ok(s.income.me + s.income.partner + s.income.joint === 0);
  });

  it("18. 基金的實際金額完全沒有因為獎勵而改變", async () => {
    const detail = (await funds.getFundDetail(c.ctxA, fundId))!;
    assert.equal(detail.summary.balance, 0, "A-1 還沒有提列，基金現金層是 0");
    const acc = await funds.accountFreeAmount(prisma, c.ctxA.book.id, c.joint);
    assert.equal(acc.earmarked, 0, "沒有任何帳戶額度被指定出去");
  });

  // ───────── 19：權限與邊界 ─────────

  it("19. EACH 任務需要有另一半；別人的 PERSONAL 任務仍然不能代打", async () => {
    const solo = await setupCouple("solo1");
    await prisma.bookMember.updateMany({ where: { bookId: solo.ctxA.book.id, userId: solo.bId }, data: { status: "LEFT" } });
    const alone = await (await import("../../src/server/services/books")).loadContext(solo.aId, solo.ctxA.book.id);
    await rejects(tasks.createTask(alone, input({ title: "一個人" })), "TASK_EACH_NEEDS_PARTNER");

    const personal = await tasks.createTask(c.ctxA, input({ title: "A 專屬", scope: "PERSONAL", assigneeId: c.aId }), D(1));
    await rejects(tasks.checkIn(c.ctxB, personal.id, { today: D(20) }), "TASK_NOT_MINE");
  });
});
