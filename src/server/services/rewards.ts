/**
 * 個人獎勵餘額（Reward Ledger）。
 *
 * ── 這一層是什麼 ──────────────────────────────────────────────
 * 任務獎勵**不是**銀行帳戶裡的錢。它是一個獨立的個人額度：
 *
 *   打卡通過 → TaskReward   （+）
 *   里程碑   → TaskReward   （+，kind = MILESTONE）
 *   漏做     → TaskPenalty  （−）
 *   提列     → 建立一筆 INCOME Transaction，錢真的進到帳戶（−，餘額歸零）
 *
 * 提列之前：不進 Transaction、不影響任何帳戶餘額、不進 /stats 的收入。
 * 提列之後：就是一筆普通的 INCOME，帳戶餘額增加、收入統計才增加。
 *
 * ── 為什麼不存 balance 欄位 ────────────────────────────────────
 * 這個專案的每一個金額都是「由紀錄加總」而不是存欄位：
 * 帳戶餘額 = −Σ payment、基金金額 = Σ FundTransaction、欠款 = 由 split 算。
 * 獎勵餘額沿用同一個原則，所以不可能出現「餘額欄位」與「明細」對不起來。
 * 兩個人每天各幾筆，十年也只有幾千列，groupBy 是毫秒等級。
 *
 * ── 什麼算「還在餘額裡」 ───────────────────────────────────────
 * 一筆獎勵離開餘額只有兩個出口，兩個都會在那筆紀錄上留下指向：
 *   depositEntryId  舊的「獎金入金」把它換成基金裡的現金
 *   withdrawalId    提列，把它換成一筆 INCOME Transaction
 * 兩個欄位任一個不是 null 就代表已經用掉，不會再被算進餘額，所以不可能重複提列。
 *
 * 但「指向一筆已經作廢的收入」不算用掉：那筆收入被作廢時，帳戶的錢已經退回去了，
 * 如果這裡還當它已提列，那筆錢就會兩邊都不在。所以一律看那筆交易是不是還活著，
 * 而不是只看 withdrawalId 是不是 null —— 這樣即使標記沒被清乾淨也會自己算對。
 */
import { Prisma } from "@prisma/client";
import { prisma, lockBook } from "../db";
import { assert } from "../domain/errors";
import { formatMoney } from "@/lib/money";
import { toDateKey } from "@/lib/dates";
import { createTransactionIn } from "./ledger";
import { auditIn } from "./funds";
import { assertCanWrite, type BookContext } from "./books";

export type RewardMovementKind = "TASK_REWARD" | "MILESTONE_BONUS" | "TASK_PENALTY";

export interface RewardMovement {
  id: string;
  kind: RewardMovementKind;
  /** 帶正負：獎勵為正、懲罰為負 */
  amount: number;
  occurredOn: Date;
  createdAt: Date;
  taskId: string;
  taskTitle: string;
  /** 這筆是否已經被舊的「獎金入金」換成現金（換過就不在餘額裡） */
  settled: boolean;
}

export interface RewardBalance {
  userId: string;
  /** 目前可用的獎勵餘額 */
  balance: number;
  /** 累計獲得（不扣懲罰、不扣已入金） */
  earned: number;
  /** 累計懲罰 */
  penalised: number;
  /** 已經離開餘額的部分（已提列，或被舊的「獎金入金」換成現金） */
  settled: number;
}

const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((a, r) => a + pick(r), 0);

/** 提列的那筆收入還在不在（作廢掉的不算提列過）。 */
const isLive = (withdrawal: { deletedAt: Date | null } | null | undefined) => !!withdrawal && withdrawal.deletedAt === null;

/** 「還沒被提列走」的條件：沒提列過，或提列的那筆收入已經被作廢。 */
const NOT_WITHDRAWN = { OR: [{ withdrawalId: null }, { withdrawal: { deletedAt: { not: null } } }] };

/**
 * 兩個人的獎勵餘額（一次算完，給首頁用）。
 *
 *   餘額 = Σ 未入金的 TaskReward − Σ 未免除且未抵扣的 TaskPenalty
 *
 * 共同任務（SHARED）的懲罰 `userId` 是 null，不歸屬任何人，所以不會扣到誰頭上。
 */
export async function rewardBalances(ctx: BookContext): Promise<Map<string, RewardBalance>> {
  const bookId = ctx.book.id;
  const [rewards, penalties] = await Promise.all([
    prisma.taskReward.findMany({
      where: { bookId, deletedAt: null },
      select: { userId: true, amount: true, depositEntryId: true, withdrawal: { select: { deletedAt: true } } },
    }),
    prisma.taskPenalty.findMany({
      where: { bookId, waivedAt: null, amount: { gt: 0 }, userId: { not: null } },
      select: { userId: true, amount: true, depositEntryId: true, withdrawal: { select: { deletedAt: true } } },
    }),
  ]);

  const out = new Map<string, RewardBalance>();
  const slot = (userId: string) => {
    let row = out.get(userId);
    if (!row) out.set(userId, (row = { userId, balance: 0, earned: 0, penalised: 0, settled: 0 }));
    return row;
  };
  for (const m of ctx.members) slot(m.userId); // 沒有任何紀錄的人也要出現，餘額 0

  for (const r of rewards) {
    const row = slot(r.userId);
    row.earned += r.amount;
    if (r.depositEntryId || isLive(r.withdrawal)) row.settled += r.amount;
    else row.balance += r.amount;
  }
  for (const p of penalties) {
    const row = slot(p.userId!);
    row.penalised += p.amount;
    if (!p.depositEntryId && !isLive(p.withdrawal)) row.balance -= p.amount;
  }
  return out;
}

/** 單一使用者的獎勵餘額。 */
export async function rewardBalance(ctx: BookContext, userId: string): Promise<RewardBalance> {
  const all = await rewardBalances(ctx);
  return all.get(userId) ?? { userId, balance: 0, earned: 0, penalised: 0, settled: 0 };
}

/**
 * 個人獎勵明細（時間軸）。把獎勵與懲罰合併成一條可讀的流水帳。
 * 這是「所有獎勵金額必須可以追溯」的實作：餘額的每一塊錢都對得到一筆來源。
 */
export async function rewardStatement(ctx: BookContext, userId: string, opts: { take?: number } = {}): Promise<RewardMovement[]> {
  const take = opts.take ?? 50;
  const bookId = ctx.book.id;
  const [rewards, penalties] = await Promise.all([
    prisma.taskReward.findMany({
      where: { bookId, userId, deletedAt: null },
      include: { task: { select: { title: true } }, checkIn: { select: { date: true } }, withdrawal: { select: { deletedAt: true } } },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.taskPenalty.findMany({
      where: { bookId, userId, waivedAt: null, amount: { gt: 0 } },
      include: { task: { select: { title: true } }, withdrawal: { select: { deletedAt: true } } },
      orderBy: { date: "desc" },
      take,
    }),
  ]);

  const moves: RewardMovement[] = [
    ...rewards.map((r) => ({
      id: r.id,
      kind: (r.kind === "MILESTONE" ? "MILESTONE_BONUS" : "TASK_REWARD") as RewardMovementKind,
      amount: r.amount,
      occurredOn: r.checkIn.date,
      createdAt: r.createdAt,
      taskId: r.taskId,
      taskTitle: r.task.title,
      settled: !!r.depositEntryId || isLive(r.withdrawal),
    })),
    ...penalties.map((p) => ({
      id: p.id,
      kind: "TASK_PENALTY" as RewardMovementKind,
      amount: -p.amount,
      occurredOn: p.date,
      createdAt: p.createdAt,
      taskId: p.taskId,
      taskTitle: p.task.title,
      settled: !!p.depositEntryId || isLive(p.withdrawal),
    })),
  ];
  moves.sort((a, b) => b.occurredOn.getTime() - a.occurredOn.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
  return moves.slice(0, take);
}

/**
 * 餘額與明細必須對得起來（給測試與診斷用）。
 * 回傳的 `balance` 一定等於明細中「未入金」movement 的加總。
 */
export async function rewardCheck(ctx: BookContext, userId: string) {
  const [bal, moves] = await Promise.all([rewardBalance(ctx, userId), rewardStatement(ctx, userId, { take: 10_000 })]);
  const fromMoves = sum(moves.filter((m) => !m.settled), (m) => m.amount);
  return { balance: bal.balance, fromMovements: fromMoves, consistent: bal.balance === fromMoves };
}

// ───────────────────────── 提列 ─────────────────────────

export interface WithdrawInput {
  /** 錢要進哪個帳戶（只能是自己的或共同帳戶） */
  accountId: string;
  note?: string;
  occurredOn?: string;
  clientRequestId: string;
}

/**
 * 把「我」目前的獎勵餘額全部提列成一筆真正的收入。
 *
 * 一次做完（同一個 DB transaction）：
 *   1. 鎖住帳本（與所有金流寫入同一把鎖，避免併發重複提列）
 *   2. 算出我目前未提列的獎勵 − 未結清的懲罰
 *   3. 用既有的 createTransactionIn() 建立一筆 INCOME（分帳 FULL 給我自己）
 *   4. 把那些獎勵與懲罰標記 withdrawalId，之後就不再算進餘額
 *
 * 任何一步失敗就整批 rollback，不會出現「交易建好了但獎勵沒標記」。
 * clientRequestId 由既有的 Transaction 唯一鍵擋重複送出。
 *
 * 不做部分提列：一次就是把餘額清空，少一個要對帳的狀態。
 */
export async function withdrawRewards(ctx: BookContext, input: WithdrawInput) {
  assertCanWrite(ctx);
  const userId = ctx.me.userId;
  const bookId = ctx.book.id;
  const occurredOn = input.occurredOn ?? toDateKey(new Date());
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBook(tx, bookId);
      const dup = await tx.transaction.findUnique({ where: { bookId_clientRequestId: { bookId, clientRequestId: input.clientRequestId } } });
      if (dup) return dup; // 重複送出：回傳第一次建立的那筆，不再標記任何東西

      const account = await tx.account.findFirst({ where: { id: input.accountId, bookId, deletedAt: null } });
      assert(account, "TX_ACCOUNT", "請選擇收款帳戶");
      assert(account.ownerId === null || account.ownerId === userId, "REWARD_ACCOUNT_OWNER", "只能提列到自己的帳戶或共同帳戶");

      const [rewards, penalties] = await Promise.all([
        tx.taskReward.findMany({ where: { bookId, userId, deletedAt: null, depositEntryId: null, ...NOT_WITHDRAWN }, select: { id: true, amount: true } }),
        tx.taskPenalty.findMany({ where: { bookId, userId, waivedAt: null, amount: { gt: 0 }, depositEntryId: null, ...NOT_WITHDRAWN }, select: { id: true, amount: true } }),
      ]);
      const gross = sum(rewards, (r) => r.amount);
      const deduction = sum(penalties, (p) => p.amount);
      const net = gross - deduction;
      assert(gross > 0, "REWARD_NOTHING", "目前沒有可以提列的獎勵");
      assert(net > 0, "REWARD_NET_NEGATIVE", `懲罰（${formatMoney(deduction)}）比獎勵（${formatMoney(gross)}）多，目前不能提列`);

      const created = await createTransactionIn(tx, ctx, {
        type: "INCOME",
        amount: net,
        accountId: account.id,
        categoryId: null,
        title: "任務獎勵提列",
        note: input.note?.trim() || (deduction > 0 ? `獎勵 ${formatMoney(gross)} − 懲罰 ${formatMoney(deduction)}` : ""),
        occurredOn,
        split: { method: "FULL", participants: [{ userId }] },
        clientRequestId: input.clientRequestId,
      });

      await tx.taskReward.updateMany({ where: { id: { in: rewards.map((r) => r.id) } }, data: { withdrawalId: created.id } });
      if (penalties.length) await tx.taskPenalty.updateMany({ where: { id: { in: penalties.map((p) => p.id) } }, data: { withdrawalId: created.id } });
      await auditIn(tx, ctx, "REWARD_WITHDRAW", "Transaction", created.id, null, {
        amount: net, rewards: rewards.length, penalties: penalties.length,
      });
      return created;
    });
  } catch (e) {
    // 兩個請求同時送出：第二個撞到 Transaction 的唯一鍵，回傳第一次建立的那筆
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.transaction.findUniqueOrThrow({ where: { bookId_clientRequestId: { bookId, clientRequestId: input.clientRequestId } } });
    }
    throw e;
  }
}
