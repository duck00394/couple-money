import { Prisma, type AccountType } from "@prisma/client";
import { prisma, lockBook, type Tx } from "../db";
import { assert, DomainError } from "../domain/errors";
import { buildBalanceLines, buildFlowLines, buildSettlementLines } from "../domain/ledger";
import { accountBalances, maxSettleAmount, netPositions, suggestSettlements, type LedgerTx } from "../domain/balance";
import { SPLIT_METHODS, type SplitRule } from "../domain/split";
import { formatMoney, MAX_AMOUNT } from "@/lib/money";
import { fromDateKey, keyToDbDate, monthRange } from "@/lib/dates";
import { assertCanWrite, type BookContext } from "./books";
import { syncFundExpense } from "./funds";
import { normalizeTags } from "../domain/search";
import { TX_INCLUDE } from "./search";
import { assertAccountsEarmarkBacked, assertTransferCancelable, refundedAmount } from "./transfers";
import { accountFreeAmount } from "./funds";
import { detachReceipts } from "./receipts";

type Client = Tx | typeof prisma;

/** 可以直接在記帳頁刪除／作廢的類型（結算、期初餘額另有流程）。 */
const DELETABLE_TYPES: string[] = ["EXPENSE", "INCOME", "REFUND", "TRANSFER"];

// ───────────────────────── 讀取總帳 ─────────────────────────

async function loadLedger(client: Client, bookId: string): Promise<LedgerTx[]> {
  const rows = await client.transaction.findMany({
    where: { bookId, deletedAt: null, status: "POSTED" },
    select: {
      type: true,
      payments: { select: { accountId: true, userId: true, amount: true } },
      splits: { select: { userId: true, amount: true } },
    },
  });
  return rows as LedgerTx[];
}

export interface Balances {
  net: Map<string, number>;
  accounts: Map<string, number>;
  /** 兩人帳本最多一筆：from 欠 to 多少 */
  debts: Array<{ from: string; to: string; amount: number }>;
}

export async function getBalances(ctx: BookContext, client: Client = prisma): Promise<Balances> {
  const ledger = await loadLedger(client, ctx.book.id);
  const net = netPositions(ledger, ctx.members.map((m) => m.userId));
  return { net, accounts: accountBalances(ledger), debts: suggestSettlements(net) };
}

// ───────────────────────── 帳戶 ─────────────────────────

export const ACCOUNT_TYPES = ["CASH", "BANK", "CREDIT_CARD", "E_WALLET", "JOINT", "OTHER"] as const;
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  CASH: "現金",
  BANK: "銀行帳戶",
  CREDIT_CARD: "信用卡",
  E_WALLET: "電子支付",
  JOINT: "共同帳戶",
  OTHER: "其他",
};
/** 帳戶類型的 icon key（見 `src/lib/icons.ts`），不是 emoji。 */
export const ACCOUNT_TYPE_ICON: Record<AccountType, string> = {
  CASH: "banknote",
  BANK: "landmark",
  CREDIT_CARD: "credit-card",
  E_WALLET: "smartphone",
  JOINT: "couple",
  OTHER: "wallet",
};

export async function listAccounts(ctx: BookContext, opts: { includeInactive?: boolean } = {}) {
  const [accounts, balances] = await Promise.all([
    prisma.account.findMany({
      where: { bookId: ctx.book.id, deletedAt: null, ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getBalances(ctx),
  ]);
  return accounts.map((a) => ({ ...a, balance: balances.accounts.get(a.id) ?? 0 }));
}

export async function createAccount(
  ctx: BookContext,
  input: { name: string; type: AccountType; shared: boolean; openingBalance: number; clientRequestId?: string },
) {
  assertCanWrite(ctx);
  const name = input.name.trim();
  assert(name.length >= 1 && name.length <= 20, "ACCOUNT_NAME", "帳戶名稱需為 1～20 個字");
  assert(ACCOUNT_TYPES.includes(input.type), "ACCOUNT_TYPE", "帳戶類型不正確");
  assert(Number.isSafeInteger(input.openingBalance) && Math.abs(input.openingBalance) <= MAX_AMOUNT, "ACCOUNT_BALANCE", "期初餘額不正確");
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const ownerId = input.shared ? null : ctx.me.userId;
    const account = await tx.account.create({
      data: { bookId: ctx.book.id, ownerId, name, type: input.type, createdById: ctx.me.userId, sortOrder: input.shared ? 10 : 5 },
    });
    if (input.openingBalance !== 0) {
      const lines = buildBalanceLines("OPENING_BALANCE", input.openingBalance, { id: account.id, ownerId });
      await tx.transaction.create({
        data: {
          bookId: ctx.book.id,
          type: "OPENING_BALANCE",
          occurredAt: new Date(),
          amount: Math.abs(input.openingBalance),
          title: "期初餘額",
          // 用畫面產生的 requestId，連點兩下時第二次會撞唯一鍵 → 整個交易回滾，不會多一個帳戶
          clientRequestId: `opening:${input.clientRequestId ?? account.id}`,
          createdById: ctx.me.userId,
          updatedById: ctx.me.userId,
          payments: { create: lines.payments },
        },
      });
    }
    await audit(tx, ctx, "CREATE", "Account", account.id, null, { name, type: input.type, ownerId });
    return account;
  });
}

/** 只更新有傳進來的欄位：停用／啟用不會順便把名稱改回畫面上的舊值。 */
export async function updateAccount(ctx: BookContext, accountId: string, input: { name?: string; isActive?: boolean }) {
  assertCanWrite(ctx);
  const name = input.name?.trim();
  if (name !== undefined) assert(name.length >= 1 && name.length <= 20, "ACCOUNT_NAME", "帳戶名稱需為 1～20 個字");
  const account = await prisma.account.findFirst({ where: { id: accountId, bookId: ctx.book.id, deletedAt: null } });
  assert(account, "ACCOUNT_NOT_FOUND", "找不到帳戶");
  assert(account.ownerId === null || account.ownerId === ctx.me.userId, "ACCOUNT_FORBIDDEN", "只能修改自己的帳戶或共同帳戶");
  await prisma.account.update({
    where: { id: accountId },
    data: { ...(name !== undefined ? { name } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) },
  });
}

// ───────────────────────── 餘額調整（Phase 3-4 C）─────────────────────────

/**
 * 帳戶餘額調整：銀行／現金的實際餘額與 App 算出來的不一樣時，補一筆 `ADJUSTMENT` 交易把差額記下來。
 *
 * 原則（沿用既有模型，沒有新增 schema）：
 *   - **不修改任何歷史交易**，也沒有 balance 欄位可以改：餘額永遠是 −Σpayment
 *   - `ADJUSTMENT` 不在 `INCOME_EXPENSE_TYPES` → 不算收支（首頁、搜尋、統計都不會算進去）
 *   - `ADJUSTMENT` 不在 `DEBT_TYPES` → 不產生欠款，也沒有 split
 *   - 往下調整不可以把「已指定給基金」的錢調掉（沿用轉帳的同一條不變式）
 */
export interface AdjustBalanceInput {
  accountId: string;
  /** 使用者輸入的「實際正確餘額」（信用卡在 action 層已轉成負餘額） */
  targetBalance: number;
  note: string;
  /** 預設今天 */
  occurredOn?: string;
  clientRequestId: string;
}

export async function adjustAccountBalance(ctx: BookContext, input: AdjustBalanceInput) {
  assertCanWrite(ctx);
  assert(/^[\w:-]{8,80}$/.test(input.clientRequestId), "TX_REQUEST_ID", "請重新整理頁面後再試");
  assert(input.note.length <= 200, "ADJUST_NOTE", "備註最多 200 個字");
  assert(
    Number.isSafeInteger(input.targetBalance) && Math.abs(input.targetBalance) <= MAX_AMOUNT,
    "ADJUST_AMOUNT",
    "請輸入正確的金額",
  );
  let occurredAt: Date;
  try {
    occurredAt = input.occurredOn ? fromDateKey(input.occurredOn) : new Date();
  } catch {
    throw new DomainError("ADJUST_DATE", "日期格式不正確");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBook(tx, ctx.book.id);
      const dup = await tx.transaction.findUnique({
        where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } },
      });
      if (dup) return dup; // 連點兩下：回傳第一次建立的那筆，不會調整兩次
      const account = await tx.account.findFirst({ where: { id: input.accountId, bookId: ctx.book.id, deletedAt: null } });
      assert(account, "ADJUST_ACCOUNT", "找不到這個帳戶");
      assert(account.ownerId === null || account.ownerId === ctx.me.userId, "ADJUST_FORBIDDEN", "只能調整自己的帳戶或共同帳戶");
      // 在交易內重讀目前餘額：兩支手機同時調整時，第二筆會用到第一筆之後的餘額
      const { balance } = await accountFreeAmount(tx, ctx.book.id, account.id);
      const delta = input.targetBalance - balance;
      assert(delta !== 0, "ADJUST_SAME", `「${account.name}」目前就是 ${formatMoney(balance)}，不需要調整`);
      const lines = buildBalanceLines("ADJUSTMENT", delta, { id: account.id, ownerId: account.ownerId });
      const created = await tx.transaction.create({
        data: {
          bookId: ctx.book.id,
          type: "ADJUSTMENT",
          occurredAt,
          amount: Math.abs(delta),
          title: "餘額調整",
          note: input.note.trim() || null,
          clientRequestId: input.clientRequestId,
          createdById: ctx.me.userId,
          updatedById: ctx.me.userId,
          payments: { create: lines.payments },
        },
      });
      // 往下調整之後，指定給基金的錢還要有實際餘額對應得到
      await assertAccountsEarmarkBacked(tx, ctx, [account.id], "spend");
      await audit(tx, ctx, "ADJUST", "Account", account.id, { balance }, { balance: input.targetBalance, delta, transactionId: created.id });
      return created;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.transaction.findUniqueOrThrow({
        where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } },
      });
    }
    throw e;
  }
}

/** 作廢一筆餘額調整（帳戶餘額回到調整前）。期初餘額不能作廢。 */
export async function cancelAdjustment(ctx: BookContext, id: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.transaction.findFirst({
      where: { id, bookId: ctx.book.id },
      include: { payments: true, splits: true },
    });
    assert(before, "TX_NOT_FOUND", "找不到這筆紀錄");
    assert(before.type === "ADJUSTMENT", "ADJUST_ONLY", "只能作廢餘額調整");
    if (before.deletedAt) return; // 已作廢：重複送出不報錯
    const accountId = before.payments[0]?.accountId ?? "";
    const account = await tx.account.findFirst({ where: { id: accountId, bookId: ctx.book.id } });
    assert(account, "ADJUST_ACCOUNT", "找不到這個帳戶");
    assert(account.ownerId === null || account.ownerId === ctx.me.userId, "ADJUST_FORBIDDEN", "只能調整自己的帳戶或共同帳戶");
    await tx.transaction.update({ where: { id }, data: { deletedAt: new Date(), deletedById: ctx.me.userId } });
    await detachReceipts(tx, ctx.book.id, id);
    // 作廢往上調整會讓餘額變少，一樣要通過基金指定金額的檢查
    await assertTransferCancelable(tx, ctx, [accountId]);
    await audit(tx, ctx, "DELETE", "Transaction", id, txSnapshot(before), null);
  });
}

// ───────────────────────── 記帳 ─────────────────────────

export interface TransactionInput {
  type: "EXPENSE" | "INCOME";
  amount: number;
  accountId: string;
  categoryId: string | null;
  title: string;
  note: string;
  occurredOn: string; // YYYY-MM-DD
  split: SplitRule;
  clientRequestId: string;
  /** Phase 2：從哪個基金扣（只適用支出）。undefined = 不變動、null = 不從基金扣 */
  fundId?: string | null;
  /** 動用哪個帳戶裡指定給基金的額度；不填 = 自動（優先付款帳戶） */
  fundAccountId?: string | null;
  /** Phase 3-1：標籤。undefined = 不變動 */
  tags?: string[];
  /** Phase 3-3：由哪一筆固定支出、哪一個應付日產生（只在建立時使用） */
  recurringExpenseId?: string | null;
  recurringDueDate?: string | null;
  /** V5：這筆付款屬於哪一張預購單（只是關聯，金額計算完全不變） */
  preorderId?: string | null;
}

/** 設定交易的標籤（同帳本同名標籤共用一筆 Tag）。 */
export async function setTags(tx: Tx, bookId: string, transactionId: string, tags: string[] | undefined) {
  if (tags === undefined) return;
  const names = normalizeTags(tags);
  await tx.transactionTag.deleteMany({ where: { transactionId } });
  for (const name of names) {
    const tag = await tx.tag.upsert({ where: { bookId_name: { bookId, name } }, create: { bookId, name }, update: {} });
    await tx.transactionTag.create({ data: { transactionId, tagId: tag.id } });
  }
}

async function validateInput(tx: Tx, ctx: BookContext, input: TransactionInput, keepCategoryId?: string | null) {
  assert(input.type === "EXPENSE" || input.type === "INCOME", "TX_TYPE", "不支援的記帳類型");
  assert(Number.isSafeInteger(input.amount) && input.amount > 0 && input.amount <= MAX_AMOUNT, "TX_AMOUNT", "請輸入正確的金額");
  assert(input.title.length <= 50, "TX_TITLE", "名稱最多 50 個字");
  assert(input.note.length <= 500, "TX_NOTE", "備註最多 500 個字");
  let occurredAt: Date;
  try {
    occurredAt = fromDateKey(input.occurredOn);
  } catch {
    throw new DomainError("TX_DATE", "日期格式不正確");
  }
  const account = await tx.account.findFirst({ where: { id: input.accountId, bookId: ctx.book.id, deletedAt: null } });
  assert(account, "TX_ACCOUNT", input.type === "EXPENSE" ? "請選擇付款帳戶" : "請選擇收款帳戶");
  if (account.ownerId) {
    const owner = await tx.bookMember.findUnique({ where: { bookId_userId: { bookId: ctx.book.id, userId: account.ownerId } } });
    assert(owner?.status === "ACTIVE", "TX_ACCOUNT_OWNER", "這個帳戶的擁有者已經不在帳本中");
  }
  if (input.categoryId) {
    const cat = await tx.category.findFirst({ where: { id: input.categoryId, bookId: ctx.book.id } });
    assert(cat, "TX_CATEGORY", "分類不存在");
    assert(cat.kind === input.type, "TX_CATEGORY_KIND", "分類類型與記帳類型不符");
    // 已停用的分類不能給新紀錄用；但編輯舊紀錄時可以保留它原本的分類（歷史不會因為停用而消失）
    assert(!cat.isArchived || input.categoryId === keepCategoryId, "TX_CATEGORY_ARCHIVED", `「${cat.name}」已停用，請選擇其他分類`);
  }
  assert(SPLIT_METHODS.includes(input.split.method), "SPLIT_METHOD", "不支援的分帳方式");
  const memberIds = new Set(ctx.members.map((m) => m.userId));
  assert(input.split.participants.every((p) => memberIds.has(p.userId)), "SPLIT_MEMBER", "分攤對象必須是帳本成員");

  const lines = buildFlowLines(
    input.type,
    input.amount,
    [{ account: { id: account.id, ownerId: account.ownerId }, amount: input.amount }],
    input.split,
  );
  return { occurredAt, lines };
}

/**
 * 在既有的資料庫 transaction 內建立一筆記帳（呼叫端要自己 lockBook 並處理 P2002）。
 * 固定支出產生交易時會用到，確保只有一套分帳／金流／稽核邏輯。
 */
export async function createTransactionIn(tx: Tx, ctx: BookContext, input: TransactionInput) {
  assertCanWrite(ctx);
  assert(/^[\w:-]{8,80}$/.test(input.clientRequestId), "TX_REQUEST_ID", "請重新整理頁面後再試");
  const dup = await tx.transaction.findUnique({
    where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } },
  });
  if (dup) return dup; // 重複送出：回傳第一次建立的那筆
  const { occurredAt, lines } = await validateInput(tx, ctx, input);
  const created = await tx.transaction.create({
    data: {
      bookId: ctx.book.id,
      type: input.type,
      occurredAt,
      amount: input.amount,
      title: input.title.trim() || null,
      note: input.note.trim() || null,
      categoryId: input.categoryId,
      splitRule: input.split as unknown as Prisma.InputJsonValue,
      clientRequestId: input.clientRequestId,
      recurringExpenseId: input.recurringExpenseId ?? null,
      recurringDueDate: input.recurringDueDate ? keyToDbDate(input.recurringDueDate) : null,
      preorderId: input.preorderId ?? null,
      createdById: ctx.me.userId,
      updatedById: ctx.me.userId,
      payments: { create: lines.payments },
      splits: { create: lines.splits },
    },
  });
  await syncFundExpense(tx, ctx, created, lines.payments[0] ?? null, input.fundId, input.fundAccountId);
  await setTags(tx, ctx.book.id, created.id, input.tags);
  // 支出不能把「已指定給基金」的錢花掉（基金支出會同時扣基金額度，所以不受影響）
  await assertAccountsEarmarkBacked(tx, ctx, lines.payments.map((p) => p.accountId), "spend");
  await audit(tx, ctx, "CREATE", "Transaction", created.id, null, snapshot(input, lines));
  return created;
}

export async function createTransaction(ctx: BookContext, input: TransactionInput) {
  assertCanWrite(ctx);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBook(tx, ctx.book.id);
      return createTransactionIn(tx, ctx, input);
    });
  } catch (e) {
    // 兩個請求同時送出時，第二個會撞唯一鍵 → 回傳已存在的那筆
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.transaction.findUniqueOrThrow({
        where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } },
      });
    }
    throw e;
  }
}

export async function updateTransaction(
  ctx: BookContext,
  id: string,
  expectedVersion: number,
  input: Omit<TransactionInput, "clientRequestId">,
) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.transaction.findFirst({
      where: { id, bookId: ctx.book.id, deletedAt: null },
      include: { payments: true, splits: true },
    });
    assert(before, "TX_NOT_FOUND", "找不到這筆紀錄，可能已被刪除");
    assert(before.type === "EXPENSE" || before.type === "INCOME", "TX_NOT_EDITABLE", "這種紀錄不能在這裡編輯");
    assert(before.version === expectedVersion, "TX_CONFLICT", "另一半剛剛修改過這筆紀錄，請重新整理後再編輯");
    // 提列出來的收入金額等於那一批獎勵的總和，改了就對不起來，所以只能作廢後重新提列
    assert(!(await withdrawnBy(tx, id)).isWithdrawal, "TX_REWARD_WITHDRAWAL", "任務獎勵提列的金額不能直接改，請作廢後重新提列");
    // 已經有退款的消費：金額不能改到比已退款金額還少，也不能改成收入（退款是獨立紀錄，要能對得回來）
    const refunded = before.type === "EXPENSE" ? await refundedAmount(tx, ctx.book.id, id) : 0;
    if (refunded > 0) {
      assert(input.type === "EXPENSE", "TX_HAS_REFUND", `這筆消費已經退款 ${formatMoney(refunded)}，不能改成收入`);
      assert(input.amount >= refunded, "TX_HAS_REFUND", `這筆消費已經退款 ${formatMoney(refunded)}，金額不能改成比它少`);
    }
    const { occurredAt, lines } = await validateInput(tx, ctx, { ...input, clientRequestId: before.clientRequestId }, before.categoryId);
    await tx.transactionPayment.deleteMany({ where: { transactionId: id } });
    await tx.transactionSplit.deleteMany({ where: { transactionId: id } });
    const updated = await tx.transaction.update({
      where: { id },
      data: {
        type: input.type,
        occurredAt,
        amount: input.amount,
        title: input.title.trim() || null,
        note: input.note.trim() || null,
        categoryId: input.categoryId,
        splitRule: input.split as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
        updatedById: ctx.me.userId,
        payments: { create: lines.payments },
        splits: { create: lines.splits },
      },
    });
    await syncFundExpense(tx, ctx, updated, lines.payments[0] ?? null, input.fundId, input.fundAccountId);
    await setTags(tx, ctx.book.id, id, input.tags);
    await assertAccountsEarmarkBacked(
      tx, ctx,
      [...before.payments.map((p) => p.accountId), ...lines.payments.map((p) => p.accountId)],
      "spend",
    );
    await audit(tx, ctx, "UPDATE", "Transaction", id, txSnapshot(before), snapshot(input, lines));
    return updated;
  });
}

/**
 * 在既有的資料庫 transaction 內作廢一筆記帳（呼叫端要自己 lockBook）。
 * 批次刪除會用到，確保「一筆」與「一批」走的是**同一套規則**（與 `createTransactionIn` 同一個模式）。
 */
/**
 * 這筆交易是不是「任務獎勵提列」建立出來的收入。
 *
 * 提列時會把那一批 TaskReward / TaskPenalty 標上 withdrawalId 指向這筆收入，
 * 所以只要還有紀錄指著它，它就是一筆提列。
 */
async function withdrawnBy(tx: Tx, id: string) {
  const [rewards, penalties] = await Promise.all([
    tx.taskReward.count({ where: { withdrawalId: id } }),
    tx.taskPenalty.count({ where: { withdrawalId: id } }),
  ]);
  return { rewards, penalties, isWithdrawal: rewards > 0 || penalties > 0 };
}

export async function deleteTransactionIn(tx: Tx, ctx: BookContext, id: string) {
  assertCanWrite(ctx);
  {
    const before = await tx.transaction.findFirst({
      where: { id, bookId: ctx.book.id },
      include: { payments: true, splits: true },
    });
    assert(before, "TX_NOT_FOUND", "找不到這筆紀錄");
    if (before.deletedAt) return; // 已刪除：重複送出不報錯
    assert(
      DELETABLE_TYPES.includes(before.type),
      "TX_NOT_DELETABLE",
      before.type === "SETTLEMENT" ? "結算請到結算頁取消" : "期初餘額與餘額調整請到帳戶頁處理",
    );
    assert(!(before.type === "TRANSFER" && before.sourceType === "REWARD_DEPOSIT"), "TX_REWARD_DEPOSIT", "任務獎金入金請到基金頁取消");
    if (before.type === "EXPENSE") {
      const refunded = await refundedAmount(tx, ctx.book.id, id);
      assert(refunded === 0, "TX_HAS_REFUND", `這筆消費已經退款 ${formatMoney(refunded)}，請先刪除退款紀錄再刪除消費`);
    }
    const deleted = await tx.transaction.update({ where: { id }, data: { deletedAt: new Date(), deletedById: ctx.me.userId } });
    // 「任務獎勵提列」的收入被作廢 = 那次提列整個復原：
    // 帳戶的錢退回去，被標記掉的獎勵與懲罰也要解除標記，重新回到「我的獎勵」餘額裡，
    // 不然那筆錢會兩邊都不在（帳戶退掉了、餘額又還算它已提列）。
    const w = await withdrawnBy(tx, id);
    if (w.isWithdrawal) {
      await tx.taskReward.updateMany({ where: { withdrawalId: id }, data: { withdrawalId: null } });
      await tx.taskPenalty.updateMany({ where: { withdrawalId: id }, data: { withdrawalId: null } });
      await audit(tx, ctx, "REWARD_WITHDRAW_CANCEL", "Transaction", id, null, {
        rewards: w.rewards, penalties: w.penalties, amount: before.amount,
      });
    }
    await syncFundExpense(tx, ctx, deleted, null, null); // 連結的基金支出一併取消
    await detachReceipts(tx, ctx.book.id, id); // 收據照片一併收回（不影響任何金額）
    // 作廢後，每個帳戶已指定給基金的錢都還要有實際餘額對應得到（刪收入、作廢轉帳都可能讓餘額變少）
    await assertTransferCancelable(tx, ctx, before.payments.map((p) => p.accountId));
    await audit(tx, ctx, "DELETE", "Transaction", id, txSnapshot(before), null);
  }
}

export async function deleteTransaction(ctx: BookContext, id: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    await deleteTransactionIn(tx, ctx, id);
  });
}

export async function getTransaction(ctx: BookContext, id: string) {
  return prisma.transaction.findFirst({
    where: { id, bookId: ctx.book.id, deletedAt: null },
    include: { payments: { include: { account: true } }, splits: true, category: true, fundEntry: { include: { fund: true } }, tags: { include: { tag: true } }, settlement: true, recurring: { select: { id: true, name: true, deletedAt: true } } },
  });
}

export async function listTransactions(ctx: BookContext, opts: { take?: number; from?: Date; to?: Date } = {}) {
  return prisma.transaction.findMany({
    where: {
      bookId: ctx.book.id,
      deletedAt: null,
      status: "POSTED",
      ...(opts.from || opts.to ? { occurredAt: { gte: opts.from, lt: opts.to } } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: opts.take,
    include: TX_INCLUDE,
  });
}
export type TxListItem = Awaited<ReturnType<typeof listTransactions>>[number];

/**
 * 表單可以選的分類：預設只給「未停用」的。
 * `keepId` 用在編輯舊紀錄：那筆原本的分類即使已停用也要留在選單裡，不然一存檔就掉分類。
 */
export async function listCategories(ctx: BookContext, opts: { keepId?: string | null } = {}) {
  return prisma.category.findMany({
    where: {
      bookId: ctx.book.id,
      ...(opts.keepId ? { OR: [{ isArchived: false }, { id: opts.keepId }] } : { isArchived: false }),
    },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
  });
}

/** 首頁：本月總支出、我本月負擔。 */
export async function monthSummary(ctx: BookContext, now = new Date()) {
  const { start, end, label } = monthRange(now);
  const rows = await prisma.transaction.findMany({
    where: { bookId: ctx.book.id, deletedAt: null, status: "POSTED", type: { in: ["EXPENSE", "INCOME", "REFUND"] }, occurredAt: { gte: start, lt: end } },
    select: { type: true, amount: true, splits: { select: { userId: true, amount: true } } },
  });
  let expense = 0;
  let income = 0;
  let myShare = 0;
  for (const r of rows) {
    if (r.type === "INCOME") income += r.amount;
    else {
      expense += r.type === "EXPENSE" ? r.amount : -r.amount;
      myShare += r.splits.filter((s) => s.userId === ctx.me.userId).reduce((a, s) => a + s.amount, 0);
    }
  }
  return { label, expense, income, myShare };
}

// ───────────────────────── 結算 ─────────────────────────

export async function settle(
  ctx: BookContext,
  input: {
    fromUserId: string;
    toUserId: string;
    amount: number;
    fromAccountId: string;
    toAccountId: string;
    note: string;
    clientRequestId: string;
  },
) {
  assertCanWrite(ctx);
  assert(/^[\w-]{8,64}$/.test(input.clientRequestId), "TX_REQUEST_ID", "請重新整理頁面後再試");
  assert(Number.isSafeInteger(input.amount) && input.amount > 0, "SETTLE_AMOUNT", "請輸入結算金額");
  assert(input.note.length <= 200, "SETTLE_NOTE", "備註最多 200 個字");
  const memberIds = new Set(ctx.members.map((m) => m.userId));
  assert(memberIds.has(input.fromUserId) && memberIds.has(input.toUserId), "SETTLE_MEMBER", "結算對象必須是帳本成員");
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBook(tx, ctx.book.id);
      const dup = await tx.settlement.findUnique({
        where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } },
      });
      if (dup) return dup;

      // 鎖定後才計算欠款，避免兩人同時按結算造成超額
      const ledger = await loadLedger(tx, ctx.book.id);
      const net = netPositions(ledger, ctx.members.map((m) => m.userId));
      const max = maxSettleAmount(net, input.fromUserId, input.toUserId);
      assert(max > 0, "SETTLE_NOTHING", "目前沒有需要結算的欠款");
      assert(input.amount <= max, "SETTLE_TOO_MUCH", `結算金額不能超過目前欠款 ${formatMoney(max)}`);

      const [fromAcc, toAcc] = await Promise.all([
        tx.account.findFirst({ where: { id: input.fromAccountId, bookId: ctx.book.id, deletedAt: null } }),
        tx.account.findFirst({ where: { id: input.toAccountId, bookId: ctx.book.id, deletedAt: null } }),
      ]);
      assert(fromAcc?.ownerId === input.fromUserId, "SETTLE_FROM_ACCOUNT", "付款帳戶必須是付款人的個人帳戶");
      assert(toAcc?.ownerId === input.toUserId, "SETTLE_TO_ACCOUNT", "收款帳戶必須是收款人的個人帳戶");
      const lines = buildSettlementLines(
        input.amount,
        { id: fromAcc.id, ownerId: input.fromUserId },
        { id: toAcc.id, ownerId: input.toUserId },
      );
      const fromName = ctx.members.find((m) => m.userId === input.fromUserId)?.nickname ?? "";
      const toName = ctx.members.find((m) => m.userId === input.toUserId)?.nickname ?? "";
      const t = await tx.transaction.create({
        data: {
          bookId: ctx.book.id,
          type: "SETTLEMENT",
          occurredAt: new Date(),
          amount: input.amount,
          title: `${fromName} 還給 ${toName}`,
          note: input.note.trim() || null,
          clientRequestId: `settle:${input.clientRequestId}`,
          createdById: ctx.me.userId,
          updatedById: ctx.me.userId,
          payments: { create: lines.payments },
        },
      });
      const s = await tx.settlement.create({
        data: {
          bookId: ctx.book.id,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          amount: input.amount,
          note: input.note.trim() || null,
          transactionId: t.id,
          clientRequestId: input.clientRequestId,
          createdById: ctx.me.userId,
        },
      });
      await audit(tx, ctx, "CREATE", "Settlement", s.id, null, { ...input });
      return s;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.settlement.findUniqueOrThrow({
        where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } },
      });
    }
    throw e;
  }
}

export async function cancelSettlement(ctx: BookContext, settlementId: string) {
  assertCanWrite(ctx);
  await prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const s = await tx.settlement.findFirst({ where: { id: settlementId, bookId: ctx.book.id } });
    assert(s, "SETTLE_NOT_FOUND", "找不到結算紀錄");
    if (s.deletedAt) return;
    const now = new Date();
    await tx.settlement.update({ where: { id: s.id }, data: { deletedAt: now } });
    await tx.transaction.update({ where: { id: s.transactionId }, data: { deletedAt: now, deletedById: ctx.me.userId } });
    await audit(tx, ctx, "DELETE", "Settlement", s.id, { amount: s.amount, from: s.fromUserId, to: s.toUserId }, null);
  });
}

export async function listSettlements(ctx: BookContext, take = 20) {
  return prisma.settlement.findMany({
    where: { bookId: ctx.book.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take,
  });
}

// ───────────────────────── 稽核 ─────────────────────────

async function audit(
  tx: Tx,
  ctx: BookContext,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  await tx.auditLog.create({
    data: {
      bookId: ctx.book.id,
      actorId: ctx.me.userId,
      action,
      entityType,
      entityId,
      before: before === null ? Prisma.JsonNull : (before as Prisma.InputJsonValue),
      after: after === null ? Prisma.JsonNull : (after as Prisma.InputJsonValue),
    },
  });
}

function snapshot(input: Omit<TransactionInput, "clientRequestId">, lines: { payments: unknown; splits: unknown }) {
  return JSON.parse(JSON.stringify({ ...input, ...lines }));
}

function txSnapshot(t: { type: string; amount: number; title: string | null; occurredAt: Date; payments: unknown; splits: unknown; version: number }) {
  return JSON.parse(JSON.stringify({ type: t.type, amount: t.amount, title: t.title, occurredAt: t.occurredAt, version: t.version, payments: t.payments, splits: t.splits }));
}
