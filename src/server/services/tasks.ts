/**
 * 任務、打卡、獎金、連續打卡、里程碑、懲罰。
 *
 * 金錢一律留下紀錄，而且「獲得獎金」和「實際入金」分開：
 *   打卡通過 → TaskReward（已獲得、進入「個人獎勵餘額」）
 *   里程碑   → TaskMilestoneClaim → TaskReward（尚未入金）＋ UserAchievement（徽章）
 *   漏做     → TaskPenalty（尚未結算，入金時從獎金扣掉）
 *   獎金入金 → 基金頁操作，建立實際金流（見 funds.ts depositRewards）
 *   取消打卡／免除懲罰 → soft delete；已經入金的要先取消入金
 */
import { Prisma, type Task, type TaskMilestone } from "@prisma/client";
import { prisma, lockBook, type Tx } from "../db";
import { assert, DomainError } from "../domain/errors";
import { currentStreak, currentWeekStreak, EVERY_DAY, isPerTime, isScheduled, isWeekly, longestStreak, longestWeekStreak, normalizeSchedule, reachedMilestones, scheduledCount, streakEndingAt, weekCount, weeksOf, type TaskFrequency } from "../domain/streak";
import { MAX_AMOUNT } from "@/lib/money";
import { addDays, dbDateToKey, eachDay, keyToDbDate, monthStartKey, toDateKey, weekStart } from "@/lib/dates";
import { assertCanWrite, type BookContext } from "./books";
import { assertFresh } from "./conflict";
import { auditIn } from "./funds";
import { toIconKey } from "../../lib/icons";

export const COUPLE = "COUPLE";
export const DEFAULT_MILESTONES = [
  { days: 3, badgeEmoji: "sprout", badgeName: "三天好的開始" },
  { days: 7, badgeEmoji: "flame", badgeName: "一週連續" },
  { days: 14, badgeEmoji: "dumbbell", badgeName: "兩週不間斷" },
  { days: 30, badgeEmoji: "trophy", badgeName: "30 天達人" },
];

export interface MilestoneInput {
  days: number;
  bonusAmount: number;
  badgeEmoji: string;
  badgeName: string;
  rewardText: string;
}

export interface TaskInput {
  title: string;
  description: string;
  emoji: string;
  scope: "PERSONAL" | "SHARED" | "EACH";
  assigneeId: string | null;
  frequency: TaskFrequency;
  daysOfWeek: number;
  requiresApproval: boolean;
  requiresPhoto: boolean;
  rewardAmount: number;
  fundId: string | null;
  penaltyAmount: number;
  penaltyText: string;
  isActive: boolean;
  milestones: MilestoneInput[];
}

type ScopeLike = Pick<Task, "scope" | "assigneeId">;

/**
 * 一個任務的「進度」是掛在誰身上（CheckIn.subjectKey）。
 *
 *   PERSONAL → assigneeId        一個人做
 *   SHARED   → "COUPLE"          【舊語意】兩人任一人完成就算完成，只有一份進度
 *   EACH     → 各自的 userId      兩人各自完成、各自一份進度與獎勵
 *
 * EACH 沒有單一的 subjectKey，所以需要知道「是誰」才能決定。
 */
export function subjectKeyFor(task: ScopeLike, userId: string): string {
  if (task.scope === "SHARED") return COUPLE;
  if (task.scope === "EACH") return userId;
  return task.assigneeId!;
}

/** 這個任務有哪些進度（EACH 是兩個人各一份）。 */
export function subjectsOf(task: ScopeLike, ctx: BookContext): string[] {
  if (task.scope === "EACH") return ctx.members.filter((m) => m.role !== "VIEWER").map((m) => m.userId);
  return [task.scope === "SHARED" ? COUPLE : task.assigneeId!];
}

/** PERSONAL／SHARED 專用的單一 subjectKey。EACH 請改用 subjectKeyFor / subjectsOf。 */
export const subjectKeyOf = (task: ScopeLike) => (task.scope === "SHARED" ? COUPLE : task.assigneeId!);

/** EACH 的懲罰要歸給該進度本人；SHARED 沒有歸屬。 */
const offenderOf = (task: ScopeLike, subjectKey: string) => (task.scope === "SHARED" ? null : subjectKey);

const money = (v: number, label: string) =>
  assert(Number.isSafeInteger(v) && v >= 0 && v <= MAX_AMOUNT, "TASK_AMOUNT", `${label}金額不正確`);

async function validateTask(client: Tx | typeof prisma, ctx: BookContext, input: TaskInput) {
  const title = input.title.trim();
  assert(title.length >= 1 && title.length <= 30, "TASK_TITLE", "任務名稱需為 1～30 個字");
  assert(input.description.length <= 300, "TASK_DESC", "描述最多 300 個字");
  assert(["PERSONAL", "SHARED", "EACH"].includes(input.scope), "TASK_SCOPE", "任務類型不正確");
  if (input.scope === "EACH") assert(ctx.members.filter((m) => m.role !== "VIEWER").length >= 2, "TASK_EACH_NEEDS_PARTNER", "「兩人各自」的任務需要先綁定另一半");
  if (input.scope === "PERSONAL") {
    assert(input.assigneeId && ctx.members.some((m) => m.userId === input.assigneeId && m.role !== "VIEWER"), "TASK_ASSIGNEE", "請選擇執行者");
  }
  let daysOfWeek: number;
  try {
    daysOfWeek = normalizeSchedule(input.frequency, input.daysOfWeek);
  } catch {
    throw new DomainError("TASK_DAYS", "至少選一天");
  }
  money(input.rewardAmount, "獎金");
  money(input.penaltyAmount, "懲罰");
  // 「每次」是做一次賺一次，沒做不算失敗，所以不接受懲罰設定
  if (isPerTime(input.frequency)) {
    assert(input.penaltyAmount === 0 && !input.penaltyText.trim(), "TASK_PER_TIME_PENALTY", "「每次」任務沒有漏做的概念，不能設定懲罰");
  }
  assert(input.penaltyText.length <= 100, "TASK_PENALTY_TEXT", "懲罰內容最多 100 個字");
  const days = new Set<number>();
  for (const m of input.milestones) {
    assert(Number.isInteger(m.days) && m.days >= 2 && m.days <= 1000, "TASK_MILESTONE_DAYS", "里程碑天數需為 2～1000");
    assert(!days.has(m.days), "TASK_MILESTONE_DUP", "里程碑天數不可重複");
    money(m.bonusAmount, "里程碑獎金");
    assert(m.badgeName.trim().length >= 1 && m.badgeName.length <= 20, "TASK_BADGE", "徽章名稱需為 1～20 個字");
    assert(m.rewardText.length <= 100, "TASK_MILESTONE_TEXT", "獎勵內容最多 100 個字");
    days.add(m.days);
  }
  // 獎金與懲罰現在是「個人獎勵餘額」的加減，不需要先綁基金。
  // fundId 只是「預設想把獎勵提列到哪個基金」，選填。
  if (input.fundId) {
    const f = await client.fund.findFirst({ where: { id: input.fundId, bookId: ctx.book.id, deletedAt: null } });
    assert(f, "FUND_NOT_FOUND", "找不到基金");
  }
  return {
    title,
    description: input.description.trim() || null,
    emoji: toIconKey(input.emoji || "check-circle"),
    scope: input.scope,
    assigneeId: input.scope === "PERSONAL" ? input.assigneeId : null, // SHARED 與 EACH 都不綁單一執行者
    frequency: input.frequency,
    daysOfWeek,
    requiresApproval: input.requiresApproval,
    requiresPhoto: input.requiresPhoto,
    rewardAmount: input.rewardAmount,
    fundId: input.fundId,
    penaltyAmount: input.penaltyAmount,
    penaltyText: input.penaltyText.trim() || null,
    isActive: input.isActive,
  };
}

const hasPenalty = (t: { penaltyAmount: number; penaltyText: string | null }) => t.penaltyAmount > 0 || !!t.penaltyText;

export async function createTask(ctx: BookContext, input: TaskInput, today = toDateKey(new Date())) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
  const data = await validateTask(tx, ctx, input);
  await lockBook(tx, ctx.book.id);
  const task = await tx.task.create({
    data: {
      ...data,
      bookId: ctx.book.id,
      startDate: keyToDbDate(today),
      // 懲罰從明天開始算，今天建立的任務不會馬上被罰
      penaltyStartDate: hasPenalty(data) ? keyToDbDate(addDays(today, 1)) : null,
      createdById: ctx.me.userId,
      milestones: {
        create: input.milestones.map((m) => ({
          days: m.days,
          bonusAmount: m.bonusAmount,
          badgeEmoji: toIconKey(m.badgeEmoji || "medal"),
          badgeName: m.badgeName.trim(),
          rewardText: m.rewardText.trim() || null,
        })),
      },
    },
  });
  await auditIn(tx, ctx, "CREATE", "Task", task.id, null, data);
  return task;
  });
}

/**
 * 複製任務：只帶設定，不帶任何歷史。
 *
 * 實作方式是「把舊任務的欄位組成 TaskInput 再呼叫 createTask()」，
 * 所以驗證規則、懲罰起算日、里程碑建立全部與手動新增完全一致，
 * 不會有第二套建立邏輯。CheckIn / TaskReward / TaskPenalty /
 * TaskMilestoneClaim / UserAchievement 一筆都不會帶過去。
 */
export async function duplicateTask(ctx: BookContext, taskId: string, today = toDateKey(new Date())) {
  assertCanWrite(ctx);
  const src = await prisma.task.findFirst({
    where: { id: taskId, bookId: ctx.book.id, deletedAt: null },
    include: { milestones: { orderBy: { days: "asc" } } },
  });
  assert(src, "TASK_NOT_FOUND", "找不到任務");
  const input: TaskInput = {
    title: `${src.title} (複製)`.slice(0, 30),
    description: src.description ?? "",
    emoji: src.emoji,
    scope: src.scope,
    assigneeId: src.assigneeId,
    frequency: src.frequency,
    daysOfWeek: src.daysOfWeek,
    requiresApproval: src.requiresApproval,
    requiresPhoto: src.requiresPhoto,
    rewardAmount: src.rewardAmount,
    fundId: src.fundId,
    penaltyAmount: src.penaltyAmount,
    penaltyText: src.penaltyText ?? "",
    isActive: true,
    milestones: src.milestones.map((m) => ({
      days: m.days,
      bonusAmount: m.bonusAmount,
      badgeEmoji: m.badgeEmoji,
      badgeName: m.badgeName,
      rewardText: m.rewardText ?? "",
    })),
  };
  return createTask(ctx, input, today);
}

export async function updateTask(ctx: BookContext, taskId: string, input: TaskInput, today = toDateKey(new Date()), expectedUpdatedAt?: string | null) {
  assertCanWrite(ctx);
  // 先用「舊設定」把到昨天為止的懲罰結算完，再套用新設定，避免新設定回溯影響過去
  await applyMissedPenalties(ctx, today);
  await prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.task.findFirst({
      where: { id: taskId, bookId: ctx.book.id, deletedAt: null },
      include: { milestones: { include: { claims: true } } },
    });
    assert(before, "TASK_NOT_FOUND", "找不到任務");
    assertFresh(before, expectedUpdatedAt, "個任務");
    const data = await validateTask(tx, ctx, input);
    // 改變執行者／類型會讓舊的打卡紀錄對不上，禁止（請建立新任務）
    assert(before.scope === data.scope && before.assigneeId === data.assigneeId, "TASK_SCOPE_LOCKED", "執行者與任務類型建立後不能修改，請建立新任務");
    // 金額與責任相關的設定只有建立者可以改
    if (before.createdById !== ctx.me.userId) {
      const changed = responsibilityChanges(before, data, input.milestones);
      assert(changed.length === 0, "TASK_CREATOR_ONLY", `只有任務建立者可以修改：${changed.join("、")}`);
    }
    // 以下情況懲罰改從明天開始算：剛啟用懲罰、從停用改回啟用（停用期間不罰）、改了週期
    const restart =
      !before.penaltyStartDate || (!before.isActive && data.isActive) || before.daysOfWeek !== data.daysOfWeek;
    const tomorrow = keyToDbDate(addDays(today, 1));
    const penaltyStartDate = !hasPenalty(data)
      ? null
      : restart
        ? (before.penaltyStartDate && before.penaltyStartDate > tomorrow ? before.penaltyStartDate : tomorrow)
        : before.penaltyStartDate;
    await tx.task.update({ where: { id: taskId }, data: { ...data, penaltyStartDate } });
    // 停用不能規避懲罰：執行者在「今天要做、還沒完成」的日子停用任務，今天照樣記一次懲罰
    if (before.isActive && !data.isActive && hasPenalty(before) && before.penaltyStartDate && !isPerTime(before.frequency)) {
      const todayDb = keyToDbDate(today);
      const due = isScheduled(today, before.daysOfWeek, dbDateToKey(before.startDate)) && before.penaltyStartDate <= todayDb;
      // EACH 是兩份進度，只補「自己」那一份；PERSONAL 只有執行者本人算數；SHARED 維持原本的單一進度
      const subjects = before.scope === "EACH"
        ? [ctx.me.userId]
        : before.scope === "SHARED" || before.assigneeId === ctx.me.userId
          ? [subjectKeyOf(before)]
          : [];
      for (const subjectKey of due ? subjects : []) {
        const done = await tx.checkIn.count({ where: { taskId, subjectKey, date: todayDb, status: { in: ["APPROVED", "PENDING"] } } });
        const already = await tx.taskPenalty.count({ where: { taskId, subjectKey, date: todayDb } });
        if (!done && !already) await createPenalty(tx, ctx, before, subjectKey, today, "停用任務時今天尚未完成");
      }
    }
    // 里程碑：依天數更新；已經有人達成的里程碑不刪除（保留徽章來源）
    const keep = new Set(input.milestones.map((m) => m.days));
    for (const m of before.milestones) {
      if (!keep.has(m.days) && m.claims.length === 0) await tx.taskMilestone.delete({ where: { id: m.id } });
    }
    for (const m of input.milestones) {
      const data2 = { bonusAmount: m.bonusAmount, badgeEmoji: toIconKey(m.badgeEmoji || "medal"), badgeName: m.badgeName.trim(), rewardText: m.rewardText.trim() || null };
      await tx.taskMilestone.upsert({
        where: { taskId_days: { taskId, days: m.days } },
        create: { taskId, days: m.days, ...data2 },
        update: data2,
      });
    }
    await auditIn(tx, ctx, "UPDATE", "Task", taskId, before, data);
  });
}

/** 哪些「金額／責任」設定被改了（非建立者不能改）。 */
function responsibilityChanges(
  before: Task & { milestones: TaskMilestone[] },
  after: { rewardAmount: number; penaltyAmount: number; penaltyText: string | null; fundId: string | null; daysOfWeek: number; frequency: string },
  milestones: MilestoneInput[],
) {
  const changed: string[] = [];
  if (before.rewardAmount !== after.rewardAmount) changed.push("任務獎金");
  if (before.penaltyAmount !== after.penaltyAmount || (before.penaltyText ?? null) !== after.penaltyText) changed.push("任務懲罰");
  if (before.fundId !== after.fundId) changed.push("獎金基金");
  if (before.daysOfWeek !== after.daysOfWeek || before.frequency !== after.frequency) changed.push("週期");
  const norm = (list: Array<{ days: number; bonusAmount: number; rewardText: string | null }>) =>
    JSON.stringify(list.map((m) => [m.days, m.bonusAmount, (m.rewardText ?? "").trim()]).sort((a, b) => Number(a[0]) - Number(b[0])));
  if (norm(before.milestones) !== norm(milestones)) changed.push("里程碑獎勵");
  return changed;
}

export async function deleteTask(ctx: BookContext, taskId: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const task = await tx.task.findFirst({ where: { id: taskId, bookId: ctx.book.id, deletedAt: null } });
    assert(task, "TASK_NOT_FOUND", "找不到任務");
    assert(task.createdById === ctx.me.userId, "TASK_CREATOR_ONLY", "只有任務建立者可以刪除任務（可以改用停用）");
    const now = new Date();
    // 已經入金的獎金是真的錢，保留；還沒入金的獎金與還沒抵扣的懲罰跟著任務一起收回，
    // 否則基金頁會一直顯示一筆「來自已刪除任務」的尚未入金金額，也會卡住基金刪除。
    const pendingRewards = await tx.taskReward.findMany({ where: { taskId, deletedAt: null, depositEntryId: null, withdrawalId: null }, select: { id: true } });
    if (pendingRewards.length) {
      await tx.taskReward.updateMany({ where: { id: { in: pendingRewards.map((r) => r.id) } }, data: { deletedAt: now } });
    }
    await tx.taskPenalty.updateMany({ where: { taskId, waivedAt: null, depositEntryId: null, withdrawalId: null }, data: { waivedAt: now, waivedById: ctx.me.userId } });
    await tx.task.update({ where: { id: taskId }, data: { deletedAt: now, isActive: false } });
    await auditIn(tx, ctx, "DELETE", "Task", taskId, task, { revokedRewards: pendingRewards.length });
  });
}

// ───────────────────────── 獎勵發放／收回 ─────────────────────────

type TaskFull = Task & { milestones: TaskMilestone[] };

async function giveReward(
  tx: Tx,
  ctx: BookContext,
  opts: { task: TaskFull; checkIn: { id: string; userId: string; date: Date }; kind: "CHECKIN" | "MILESTONE"; sourceKey: string; amount: number },
) {
  if (opts.amount <= 0) return null;
  // fundId 只是「預設提列目標」，可以是 null：獎勵一律進入個人獎勵餘額
  const existing = await tx.taskReward.findUnique({ where: { sourceKey: opts.sourceKey } });
  if (existing && !existing.deletedAt) return existing; // 已發過，不重複發
  const data = {
    amount: opts.amount,
    fundId: opts.task.fundId,
    depositEntryId: null, // 已獲得、尚未入金
    userId: opts.checkIn.userId,
    checkInId: opts.checkIn.id,
    deletedAt: null,
  };
  if (existing) return tx.taskReward.update({ where: { id: existing.id }, data });
  return tx.taskReward.create({
    data: { ...data, bookId: ctx.book.id, taskId: opts.task.id, kind: opts.kind, sourceKey: opts.sourceKey, createdById: ctx.me.userId },
  });
}

async function approvedDates(tx: Tx | typeof prisma, taskId: string, subjectKey: string) {
  const rows = await tx.checkIn.findMany({ where: { taskId, subjectKey, status: "APPROVED" }, select: { date: true } });
  return new Set(rows.map((r) => dbDateToKey(r.date)));
}

export interface ReachedMilestone {
  days: number;
  badgeEmoji: string;
  badgeName: string;
  bonusAmount: number;
  rewardText: string | null;
}

async function grantRewards(tx: Tx, ctx: BookContext, task: TaskFull, ci: { id: string; userId: string; subjectKey: string; date: Date }) {
  await giveReward(tx, ctx, { task, checkIn: ci, kind: "CHECKIN", sourceKey: `checkin:${ci.id}`, amount: task.rewardAmount });

  const checked = await approvedDates(tx, task.id, ci.subjectKey);
  const dateKey = dbDateToKey(ci.date);
  // 「每週」的里程碑數的是連續「週」數（streakStartDate 也是那一段的第一個週一），
  // 其他週期數的是連續「天」數。
  const streak = isWeekly(task.frequency)
    ? currentWeekStreak(weeksOf([...checked].filter((d) => d <= dateKey)), dbDateToKey(task.startDate), dateKey)
    : streakEndingAt(checked, task.daysOfWeek, dbDateToKey(task.startDate), dateKey);
  const reached: ReachedMilestone[] = [];
  for (const m of reachedMilestones(task.milestones, streak.length)) {
    const streakStartDate = keyToDbDate(streak.startDate!);
    const key = { milestoneId: m.id, subjectKey: ci.subjectKey, streakStartDate };
    const old = await tx.taskMilestoneClaim.findUnique({ where: { milestoneId_subjectKey_streakStartDate: key } });
    if (old && !old.deletedAt) continue; // 這段連續已經領過
    const claim = old
      ? await tx.taskMilestoneClaim.update({ where: { id: old.id }, data: { deletedAt: null, checkInId: ci.id, userId: ci.userId } })
      : await tx.taskMilestoneClaim.create({ data: { ...key, userId: ci.userId, checkInId: ci.id } });
    await giveReward(tx, ctx, { task, checkIn: ci, kind: "MILESTONE", sourceKey: `milestone:${claim.id}`, amount: m.bonusAmount });
    await tx.userAchievement.upsert({
      where: { sourceType_sourceId: { sourceType: "MILESTONE_CLAIM", sourceId: claim.id } },
      create: { bookId: ctx.book.id, subjectKey: ci.subjectKey, code: "MILESTONE", title: `${task.title}・${m.badgeName}`, emoji: m.badgeEmoji, sourceType: "MILESTONE_CLAIM", sourceId: claim.id },
      update: { deletedAt: null, earnedAt: new Date() },
    });
    reached.push({ days: m.days, badgeEmoji: m.badgeEmoji, badgeName: m.badgeName, bonusAmount: m.bonusAmount, rewardText: m.rewardText });
  }
  return { streak: streak.length, reached };
}

/** 收回這次打卡產生的獎金、里程碑與徽章（soft delete，紀錄保留）。 */
async function revokeRewards(tx: Tx, ctx: BookContext, checkInId: string) {
  const now = new Date();
  const rewards = await tx.taskReward.findMany({ where: { checkInId, deletedAt: null } });
  assert(!rewards.some((r) => r.withdrawalId), "REWARD_WITHDRAWN", "這次打卡的獎勵已經提列成收入了，請先作廢那筆收入紀錄");
  assert(!rewards.some((r) => r.depositEntryId), "REWARD_DEPOSITED", "這次打卡的獎金已經入金，請先到基金頁取消那筆「獎金入金」");
  if (rewards.length) await tx.taskReward.updateMany({ where: { id: { in: rewards.map((r) => r.id) } }, data: { deletedAt: now } });
  const claims = await tx.taskMilestoneClaim.findMany({ where: { checkInId, deletedAt: null } });
  if (claims.length) {
    await tx.taskMilestoneClaim.updateMany({ where: { id: { in: claims.map((c) => c.id) } }, data: { deletedAt: now } });
    await tx.userAchievement.updateMany({ where: { sourceType: "MILESTONE_CLAIM", sourceId: { in: claims.map((c) => c.id) } }, data: { deletedAt: now } });
  }
}

// ───────────────────────── 打卡 ─────────────────────────

async function attachPhoto(tx: Tx, ctx: BookContext, photoId: string | null | undefined, checkInId: string) {
  if (!photoId) return null;
  const photo = await tx.attachment.findFirst({ where: { id: photoId, bookId: ctx.book.id, deletedAt: null, createdById: ctx.me.userId } });
  assert(photo, "CHECKIN_PHOTO", "照片不存在，請重新上傳");
  await tx.attachment.update({ where: { id: photo.id }, data: { ownerType: "CHECKIN", ownerId: checkInId } });
  return photo.id;
}

export async function checkIn(ctx: BookContext, taskId: string, opts: { note?: string; photoId?: string | null; today?: string } = {}) {
  assertCanWrite(ctx);
  const today = opts.today ?? toDateKey(new Date());
  const note = opts.note?.trim().slice(0, 200) || null;
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBook(tx, ctx.book.id);
      const task = await tx.task.findFirst({ where: { id: taskId, bookId: ctx.book.id, deletedAt: null }, include: { milestones: true } });
      assert(task, "TASK_NOT_FOUND", "找不到任務");
      assert(task.isActive, "TASK_INACTIVE", "任務已停用");
      if (task.scope === "PERSONAL") assert(task.assigneeId === ctx.me.userId, "TASK_NOT_MINE", "這不是你的任務");
      else assert(ctx.me.role !== "VIEWER", "TASK_NOT_MINE", "你不能打卡");
      assert(isScheduled(today, task.daysOfWeek, dbDateToKey(task.startDate)), "TASK_NOT_TODAY", "今天不用做這個任務");
      assert(!task.requiresPhoto || opts.photoId, "CHECKIN_PHOTO_REQUIRED", "這個任務需要上傳照片");

      // EACH：subjectKey 是「我自己」，所以另一半今天完成了也完全不影響我
      const subjectKey = subjectKeyFor(task, ctx.me.userId);
      const date = keyToDbDate(today);
      const perTime = isPerTime(task.frequency);

      // 「每次」：同一天可以做很多次，每次都是新的一筆（seq 往上加）
      // 其他週期：seq 恆為 0，唯一鍵照舊擋住同一天的第二次
      let seq = 0;
      if (perTime) {
        const last = await tx.checkIn.findFirst({ where: { taskId, subjectKey, date }, orderBy: { seq: "desc" }, select: { seq: true } });
        seq = (last?.seq ?? -1) + 1;
      }
      // 「每週」：一週內任意一天完成一次即可，所以限制是「這一週」而不是「今天」。
      // 一週的範圍是週一到週日；下一週自動重新開放。
      if (isWeekly(task.frequency)) {
        const ws = weekStart(today);
        const inWeek = await tx.checkIn.findFirst({
          where: {
            taskId, subjectKey,
            date: { gte: keyToDbDate(ws), lte: keyToDbDate(addDays(ws, 6)) },
            status: { in: ["APPROVED", "PENDING"] },
          },
          select: { userId: true },
        });
        if (inWeek) {
          throw new DomainError(
            "CHECKIN_WEEK_DUP",
            inWeek.userId === ctx.me.userId ? "這週已經完成過了，下週才能再做一次" : "另一半這週已經完成了",
          );
        }
      }
      const existing = perTime ? null : await tx.checkIn.findUnique({ where: { taskId_subjectKey_date_seq: { taskId, subjectKey, date, seq: 0 } } });
      if (existing && (existing.status === "PENDING" || existing.status === "APPROVED")) {
        throw new DomainError("CHECKIN_DUP", existing.userId === ctx.me.userId ? "今天已經打卡過了" : "另一半今天已經完成了");
      }
      const needReview = task.requiresApproval && !!ctx.partner;
      const status = needReview ? "PENDING" : "APPROVED";
      const base = { userId: ctx.me.userId, status, note, reviewedById: null, reviewedAt: null, reviewNote: null, cancelledAt: null } as const;
      const ci = existing
        ? await tx.checkIn.update({ where: { id: existing.id }, data: base })
        : await tx.checkIn.create({ data: { ...base, bookId: ctx.book.id, taskId, subjectKey, date, seq } });
      const photoId = await attachPhoto(tx, ctx, opts.photoId, ci.id);
      const saved = photoId ? await tx.checkIn.update({ where: { id: ci.id }, data: { photoId } }) : ci;
      const result = status === "APPROVED" ? await grantRewards(tx, ctx, task, saved) : { streak: 0, reached: [] as ReachedMilestone[] };
      await auditIn(tx, ctx, existing ? "UPDATE" : "CREATE", "CheckIn", ci.id, existing, saved);
      return { checkIn: saved, ...result };
    });
  } catch (e) {
    // 只有真的撞到「同一天同一個任務」的唯一鍵才是重複打卡，其他唯一鍵不要誤報
    if (
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" &&
      String((e.meta as { target?: string | string[] } | undefined)?.target ?? "").includes("taskId")
    ) {
      throw new DomainError("CHECKIN_DUP", "今天已經打卡過了");
    }
    throw e;
  }
}

/** 修改打卡的備註／照片（待確認或已完成時）。 */
export async function editCheckIn(ctx: BookContext, checkInId: string, input: { note: string; photoId?: string | null }) {
  assertCanWrite(ctx);
  await prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const ci = await tx.checkIn.findFirst({ where: { id: checkInId, bookId: ctx.book.id }, include: { task: true } });
    assert(ci, "CHECKIN_NOT_FOUND", "找不到打卡紀錄");
    assert(ci.userId === ctx.me.userId, "CHECKIN_NOT_MINE", "只能修改自己的打卡");
    assert(ci.status === "PENDING" || ci.status === "APPROVED", "CHECKIN_LOCKED", "這筆打卡不能修改");
    let photoId = ci.photoId;
    if (input.photoId !== undefined && input.photoId !== ci.photoId) {
      photoId = await attachPhoto(tx, ctx, input.photoId, ci.id);
    }
    assert(!ci.task.requiresPhoto || photoId, "CHECKIN_PHOTO_REQUIRED", "這個任務需要照片");
    const updated = await tx.checkIn.update({ where: { id: ci.id }, data: { note: input.note.trim().slice(0, 200) || null, photoId } });
    await auditIn(tx, ctx, "UPDATE", "CheckIn", ci.id, ci, updated);
  });
}

/** 取消打卡：待確認隨時可取消；已完成只能取消今天的（避免影響之後的連續紀錄）。 */
export async function cancelCheckIn(ctx: BookContext, checkInId: string, opts: { today?: string } = {}) {
  assertCanWrite(ctx);
  const today = opts.today ?? toDateKey(new Date());
  await prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const ci = await tx.checkIn.findFirst({ where: { id: checkInId, bookId: ctx.book.id } });
    assert(ci, "CHECKIN_NOT_FOUND", "找不到打卡紀錄");
    assert(ci.userId === ctx.me.userId, "CHECKIN_NOT_MINE", "只能取消自己的打卡");
    assert(ci.status === "PENDING" || ci.status === "APPROVED", "CHECKIN_LOCKED", "這筆打卡不能取消");
    assert(ci.status === "PENDING" || dbDateToKey(ci.date) === today, "CHECKIN_OLD", "已完成的打卡只能在當天取消");
    await revokeRewards(tx, ctx, ci.id);
    const updated = await tx.checkIn.update({ where: { id: ci.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await auditIn(tx, ctx, "CANCEL", "CheckIn", ci.id, ci, updated);
  });
}

export async function reviewCheckIn(ctx: BookContext, checkInId: string, approve: boolean, reviewNote = "") {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const ci = await tx.checkIn.findFirst({ where: { id: checkInId, bookId: ctx.book.id }, include: { task: { include: { milestones: true } } } });
    assert(ci, "CHECKIN_NOT_FOUND", "找不到打卡紀錄");
    assert(ci.userId !== ctx.me.userId, "CHECKIN_SELF_REVIEW", "不能確認自己的打卡");
    assert(ci.status === "PENDING", "CHECKIN_REVIEWED", "這筆打卡已經處理過了");
    const updated = await tx.checkIn.update({
      where: { id: ci.id },
      data: { status: approve ? "APPROVED" : "REJECTED", reviewedById: ctx.me.userId, reviewedAt: new Date(), reviewNote: reviewNote.trim().slice(0, 200) || null },
    });
    const result = approve ? await grantRewards(tx, ctx, ci.task, updated) : { streak: 0, reached: [] as ReachedMilestone[] };
    await auditIn(tx, ctx, approve ? "APPROVE" : "REJECT", "CheckIn", ci.id, ci, updated);
    return { checkIn: updated, ...result };
  });
}

// ───────────────────────── 懲罰 ─────────────────────────

const PENALTY_LOOKBACK_DAYS = 30;

/**
 * 補產生漏做的懲罰（開啟任務頁／首頁時執行，重複執行不會重複產生）。
 * 規則：排定日結束（今天以前）沒有「已完成」或「待確認」的打卡 → 產生一筆懲罰。
 */
export async function applyMissedPenalties(ctx: BookContext, today = toDateKey(new Date())) {
  if (!ctx.canWrite) return 0;
  const yesterday = addDays(today, -1);
  let created = 0;
  await prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    // 鎖定後才讀任務，否則會用到另一半剛剛改掉的舊懲罰設定
    const tasks = await tx.task.findMany({
      where: { bookId: ctx.book.id, deletedAt: null, isActive: true, penaltyStartDate: { not: null } },
    });
    for (const task of tasks) {
      if (!hasPenalty(task) || isPerTime(task.frequency)) continue; // 「每次」沒有漏做的概念
      const startKey = dbDateToKey(task.startDate);
      const penaltyFrom = dbDateToKey(task.penaltyStartDate!);
      const from = [penaltyFrom, startKey, addDays(today, -PENALTY_LOOKBACK_DAYS)].sort().at(-1)!;
      if (from > yesterday) continue;
      const weekly = isWeekly(task.frequency);
      // 「每週」是整整一週沒做才算漏做，所以要看到上週日為止的「完整的週」，
      // 而且一週最多一筆懲罰（記在那一週的星期日）。
      const until = weekly ? addDays(weekStart(today), -1) : yesterday;
      if (from > until) continue;
      // EACH：兩個人各自一份進度，各自判斷有沒有漏做
      for (const subjectKey of subjectsOf(task, ctx)) {
        const [checkIns, penalties] = await Promise.all([
          tx.checkIn.findMany({ where: { taskId: task.id, subjectKey, date: { gte: keyToDbDate(from), lte: keyToDbDate(until) }, status: { in: ["APPROVED", "PENDING"] } }, select: { date: true } }),
          tx.taskPenalty.findMany({ where: { taskId: task.id, subjectKey, date: { gte: keyToDbDate(from), lte: keyToDbDate(until) } }, select: { date: true } }),
        ]);
        const doneDays = [...checkIns, ...penalties].map((x) => dbDateToKey(x.date));
        if (weekly) {
          const covered = weeksOf(doneDays);
          // 從第一個「完整落在觀察範圍內」的週一開始數
          for (let w = weekStart(from) < from ? addDays(weekStart(from), 7) : weekStart(from); addDays(w, 6) <= until; w = addDays(w, 7)) {
            if (covered.has(w)) continue;
            await createPenalty(tx, ctx, task, subjectKey, addDays(w, 6), "整週未完成");
            created++;
          }
          continue;
        }
        const done = new Set(doneDays);
        for (const day of eachDay(from, until)) {
          if (!isScheduled(day, task.daysOfWeek, startKey) || done.has(day)) continue;
          await createPenalty(tx, ctx, task, subjectKey, day, "未完成");
          created++;
        }
      }
    }
  });
  return created;
}

async function createPenalty(tx: Tx, ctx: BookContext, task: Task, subjectKey: string, day: string, reason: string) {
  await tx.taskPenalty.create({
    data: {
      bookId: ctx.book.id,
      taskId: task.id,
      subjectKey,
      // PERSONAL 與 EACH 的 subjectKey 就是受罰者本人；SHARED 沒有歸屬
      userId: offenderOf(task, subjectKey),
      date: keyToDbDate(day),
      // 懲罰是個人獎勵餘額的減項，跟有沒有綁基金無關
      amount: task.penaltyAmount,
      text: task.penaltyText,
      fundId: task.penaltyAmount > 0 ? task.fundId : null,
      createdById: ctx.me.userId,
    },
  });
  await auditIn(tx, ctx, "PENALTY", "Task", task.id, null, { day, reason, amount: task.penaltyAmount, text: task.penaltyText });
}

/** 免除懲罰（尚未入金結算前才可以）。受罰者本人不能免除自己的懲罰。 */
export async function waivePenalty(ctx: BookContext, penaltyId: string) {
  assertCanWrite(ctx);
  await prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const p = await tx.taskPenalty.findFirst({ where: { id: penaltyId, bookId: ctx.book.id } });
    assert(p, "PENALTY_NOT_FOUND", "找不到懲罰紀錄");
    assert(!p.waivedAt, "PENALTY_WAIVED", "已經免除過了");
    assert(p.userId !== ctx.me.userId || !ctx.partner, "PENALTY_SELF", "自己的懲罰要由另一半免除");
    assert(!p.withdrawalId, "PENALTY_SETTLED", "這筆懲罰已經在提列時扣掉了，不能再免除");
    assert(!p.depositEntryId, "PENALTY_SETTLED", "這筆懲罰已經在獎金入金時抵扣了，請先取消那筆入金");
    await tx.taskPenalty.update({ where: { id: p.id }, data: { waivedAt: new Date(), waivedById: ctx.me.userId } });
    await auditIn(tx, ctx, "WAIVE", "TaskPenalty", p.id, p, null);
  });
}

// ───────────────────────── 查詢 ─────────────────────────

export interface SubjectStats {
  current: number;
  longest: number;
  weekDone: number;
  weekScheduled: number;
  monthDone: number;
  monthScheduled: number;
  total: number;
}

function statsFor(task: Pick<Task, "daysOfWeek" | "startDate" | "frequency">, dates: Set<string>, today: string): SubjectStats {
  const start = dbDateToKey(task.startDate);
  const ws = weekStart(today);
  const ms = monthStartKey(today);
  const count = (from: string) => [...dates].filter((d) => d >= from && d <= today).length;
  // 「每週」數的是「週」不是「天」：一週做幾次都只算完成那一週，分母也是週數
  if (isWeekly(task.frequency)) {
    const weeks = weeksOf([...dates].filter((d) => d <= today));
    const weeksSince = (from: string) => [...weeks].filter((w) => w >= weekStart(from) && w <= today).length;
    return {
      current: currentWeekStreak(weeks, start, today).length,
      longest: longestWeekStreak(weeks),
      weekDone: weeks.has(ws) ? 1 : 0,
      weekScheduled: 1,
      monthDone: weeksSince(ms),
      monthScheduled: weekCount(ms, today, start),
      total: weeks.size,
    };
  }
  return {
    current: currentStreak(dates, task.daysOfWeek, start, today).length,
    longest: longestStreak(dates, task.daysOfWeek, start),
    weekDone: count(ws),
    weekScheduled: scheduledCount(ws, today, task.daysOfWeek, start),
    monthDone: count(ms),
    monthScheduled: scheduledCount(ms, today, task.daysOfWeek, start),
    total: dates.size,
  };
}

export type TaskGroup = "MINE" | "PARTNER" | "SHARED";

export interface TaskCard {
  task: Task;
  group: TaskGroup;
  subjectKey: string;
  /** 這份進度屬於誰（SHARED 是兩人共用，所以是 null） */
  subjectUserId: string | null;
  /** 今天已完成幾次（每日／每週最多 1；「每次」可以很多） */
  todayCount: number;
  /** 今天因為這個任務賺到多少（次數 × 獎金） */
  todayReward: number;
  /** 「每次」任務：做一次賺一次 */
  perTime: boolean;
  /** 「每週」任務：一週內任意一天完成一次即可 */
  weekly: boolean;
  /** 「每週」任務這一週是不是已經完成了（含待確認） */
  doneThisWeek: boolean;
  /** 「每週」任務這一週那一筆是誰做的 */
  weekDoneBy: string | null;
  scheduledToday: boolean;
  today: { id: string; status: string; userId: string; photoId: string | null; note: string | null } | null;
  canCheckIn: boolean;
  /** 另一半今天的進度（只有 EACH 任務才有另一份進度可以看） */
  partner: { nickname: string; count: number } | null;
  stats: SubjectStats;
}

/** 任務總覽：所有任務（含今天狀態與統計），依「我的／另一半／共同」分組。 */
export async function taskBoard(ctx: BookContext, today = toDateKey(new Date())) {
  const tasks = await prisma.task.findMany({ where: { bookId: ctx.book.id, deletedAt: null }, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] });
  const checkIns = await prisma.checkIn.findMany({
    where: { taskId: { in: tasks.map((t) => t.id) }, date: { gte: keyToDbDate(addDays(today, -400)) } },
    select: { id: true, taskId: true, subjectKey: true, userId: true, date: true, status: true, photoId: true, note: true },
  });
  // EACH 的任務會產生兩張卡：我的那份進度（MINE）與另一半的那份（PARTNER）
  const cards: TaskCard[] = tasks.flatMap((task) =>
    subjectsOf(task, ctx).map((subjectKey) => {
      const rows = checkIns.filter((c) => c.taskId === task.id && c.subjectKey === subjectKey);
      const todayRows = rows.filter((c) => dbDateToKey(c.date) === today && c.status !== "CANCELLED" && c.status !== "REJECTED");
      const todayCi = todayRows.at(-1) ?? null;
      const perTime = isPerTime(task.frequency);
      const weekly = isWeekly(task.frequency);
      // 「每週」看的是整週，不是今天：待確認也算佔住這一週
      const ws = weekStart(today);
      const weekRow = weekly
        ? rows.find((c) => {
            const k = dbDateToKey(c.date);
            return k >= ws && k <= addDays(ws, 6) && (c.status === "APPROVED" || c.status === "PENDING");
          }) ?? null
        : null;
      const approved = new Set(rows.filter((c) => c.status === "APPROVED").map((c) => dbDateToKey(c.date)));
      const group: TaskGroup =
        task.scope === "SHARED" ? "SHARED"
        : task.scope === "EACH" ? (subjectKey === ctx.me.userId ? "MINE" : "PARTNER")
        : task.assigneeId === ctx.me.userId ? "MINE" : "PARTNER";
      const scheduledToday = task.isActive && isScheduled(today, task.daysOfWeek, dbDateToKey(task.startDate));
      return {
        task,
        group,
        subjectKey,
        subjectUserId: task.scope === "SHARED" ? null : subjectKey,
        todayCount: todayRows.length,
        todayReward: todayRows.length * task.rewardAmount,
        perTime,
        weekly,
        doneThisWeek: !!weekRow,
        weekDoneBy: weekRow?.userId ?? null,
        scheduledToday,
        today: todayCi ? { id: todayCi.id, status: todayCi.status, userId: todayCi.userId, photoId: todayCi.photoId, note: todayCi.note } : null,
        canCheckIn: ctx.canWrite && scheduledToday && group !== "PARTNER" && (perTime || (weekly ? !weekRow : !todayCi)),
        partner: null,
        stats: statsFor(task, approved, today),
      };
    }),
  );
  // EACH 任務有兩份進度，讓「我的」那張卡帶上另一半今天做了幾次
  if (ctx.partner) {
    const partnerId = ctx.partner.userId;
    for (const card of cards) {
      if (card.task.scope !== "EACH" || card.subjectKey !== ctx.me.userId) continue;
      const other = cards.find((x) => x.task.id === card.task.id && x.subjectKey === partnerId);
      if (other) {
        card.partner = {
          nickname: ctx.partner.nickname,
          count: card.weekly ? (other.doneThisWeek ? 1 : 0) : other.todayCount,
        };
      }
    }
  }
  const rate = (groups: TaskGroup[]) => {
    // 「每次」任務沒有「應該做幾次」，算進完成率只會把分母灌大，所以不算
    const list = cards.filter((c) => c.task.isActive && !c.perTime && groups.includes(c.group));
    const scheduled = list.reduce((a, c) => a + c.stats.weekScheduled, 0);
    const done = list.reduce((a, c) => a + c.stats.weekDone, 0);
    return { done, scheduled, rate: scheduled ? done / scheduled : null };
  };
  return {
    cards,
    today: cards.filter((c) => c.scheduledToday),
    weekMine: rate(["MINE", "SHARED"]),
    weekPartner: rate(["PARTNER", "SHARED"]),
  };
}

export async function pendingReviews(ctx: BookContext) {
  return prisma.checkIn.findMany({
    where: { bookId: ctx.book.id, status: "PENDING", userId: { not: ctx.me.userId }, task: { deletedAt: null } },
    include: { task: true },
    orderBy: { date: "desc" },
  });
}

export async function recentPenalties(ctx: BookContext, take = 10) {
  return prisma.taskPenalty.findMany({
    // 已經在獎金入金時抵扣過的不能再免除，也不該顯示免除按鈕
    where: { bookId: ctx.book.id, waivedAt: null, depositEntryId: null, withdrawalId: null, task: { deletedAt: null } },
    include: { task: true },
    orderBy: { date: "desc" },
    take,
  });
}

export async function listBadges(ctx: BookContext) {
  return prisma.userAchievement.findMany({ where: { bookId: ctx.book.id, deletedAt: null }, orderBy: { earnedAt: "desc" } });
}

/** 今天打卡獲得的獎金（含里程碑），依人加總。 */
export async function todayRewards(ctx: BookContext, today = toDateKey(new Date())) {
  const rows = await prisma.taskReward.findMany({
    where: { bookId: ctx.book.id, deletedAt: null, checkIn: { date: keyToDbDate(today) } },
    select: { userId: true, amount: true },
  });
  const byUser = new Map<string, number>();
  for (const r of rows) byUser.set(r.userId, (byUser.get(r.userId) ?? 0) + r.amount);
  return { total: rows.reduce((a, r) => a + r.amount, 0), byUser };
}

export async function getTaskDetail(ctx: BookContext, taskId: string, today = toDateKey(new Date())) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, bookId: ctx.book.id, deletedAt: null },
    include: { milestones: { orderBy: { days: "asc" }, include: { claims: { where: { deletedAt: null } } } }, fund: true },
  });
  if (!task) return null;
  // EACH：詳細頁看的是「自己的那份進度」
  const subjectKey = subjectKeyFor(task, ctx.me.userId);
  const [checkIns, rewards, penalties] = await Promise.all([
    prisma.checkIn.findMany({ where: { taskId, subjectKey }, orderBy: { date: "desc" } }),
    prisma.taskReward.findMany({ where: { taskId, deletedAt: null }, include: { checkIn: true }, orderBy: { createdAt: "desc" } }),
    prisma.taskPenalty.findMany({ where: { taskId }, orderBy: { date: "desc" } }),
  ]);
  const approved = new Set(checkIns.filter((c) => c.status === "APPROVED").map((c) => dbDateToKey(c.date)));
  // 「每次」任務同一天可以有很多筆，所以今天是一個清單而不是一筆
  const todayList = checkIns
    .filter((c) => dbDateToKey(c.date) === today && c.status !== "CANCELLED" && c.status !== "REJECTED")
    .sort((a, b) => a.seq - b.seq);
  // 「每週」看的是整週：這一週有任何一筆完成或待確認，這週就不能再做了
  const ws = weekStart(today);
  const weekRow = isWeekly(task.frequency)
    ? checkIns.find((c) => {
        const k = dbDateToKey(c.date);
        return k >= ws && k <= addDays(ws, 6) && (c.status === "APPROVED" || c.status === "PENDING");
      }) ?? null
    : null;
  return {
    task,
    subjectKey,
    perTime: isPerTime(task.frequency),
    weekly: isWeekly(task.frequency),
    weekCheckIn: weekRow,
    doneThisWeek: !!weekRow,
    todayCheckIns: todayList,
    todayCount: todayList.length,
    todayReward: todayList.length * task.rewardAmount,
    checkIns,
    byDate: new Map(checkIns.map((c) => [dbDateToKey(c.date), c])),
    penaltyDates: new Set(penalties.filter((p) => !p.waivedAt).map((p) => dbDateToKey(p.date))),
    stats: statsFor(task, approved, today),
    rewards,
    penalties,
    totalReward: rewards.reduce((a, r) => a + r.amount, 0),
    totalPenalty: penalties.filter((p) => !p.waivedAt).reduce((a, p) => a + p.amount, 0),
    todayCheckIn: checkIns.find((c) => dbDateToKey(c.date) === today && c.status !== "CANCELLED") ?? null,
    scheduledToday: task.isActive && isScheduled(today, task.daysOfWeek, dbDateToKey(task.startDate)),
  };
}

export { EVERY_DAY };
