import { randomInt } from "node:crypto";
import { Prisma, type AccountType } from "@prisma/client";
import { prisma, lockBook, type Tx } from "../db";
import { assert, DomainError } from "../domain/errors";
import { isCurrencyCode } from "@/lib/currency";
import { assertRate, parseRatePair } from "../domain/exchange";
import { fromDateKey } from "@/lib/dates";

export const MAX_COUPLE_MEMBERS = 2;
const INVITE_DAYS = 7;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉 0/O、1/I 容易看錯的字

export const DEFAULT_CATEGORIES = {
  EXPENSE: [
    ["餐飲", "utensils"], ["交通", "bus"], ["約會", "heart"], ["日用品", "package"], ["購物", "shopping-bag"],
    ["娛樂", "clapperboard"], ["居家", "house"], ["旅行", "plane"], ["醫療", "pill"], ["其他", "tag"],
  ],
  INCOME: [["薪水", "banknote"], ["獎金", "gift"], ["其他收入", "coins"]],
} as const;

/** 帳本成員在畫面上的樣子。avatarUrl 是 /api/files/<id>，沒設頭貼就是 null（用 avatarColor + 首字）。 */
export interface BookMemberView {
  userId: string;
  nickname: string;
  role: string;
  avatarColor: string;
  avatarUrl: string | null;
}

export interface BookContext {
  /** baseCurrency = 這本帳本的本位幣。外幣交易都會換算成它再進分錄。 */
  book: {
    id: string;
    name: string;
    coverEmoji: string;
    baseCurrency: string;
    status: string;
    /** V15：MAIN 是原帳本（不能結案）；TRIP / CUSTOM 可以結案 */
    type: "MAIN" | "TRIP" | "CUSTOM";
    closedAt: Date | null;
    /** V16：換回台幣的參考匯率（只影響顯示）。本位幣就是 TWD 時是 null。 */
    homeRate: { units: number; minor: number } | null;
  };
  me: BookMemberView;
  members: BookMemberView[];
  partner: BookMemberView | null;
  canWrite: boolean;
}

/** 使用者目前的帳本（activeBookId，失效時改用第一個有效帳本）。沒有帳本回傳 null。 */
export async function getBookContext(userId: string): Promise<BookContext | null> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const memberships = await prisma.bookMember.findMany({
    where: { userId, status: "ACTIVE", book: { deletedAt: null } },
    orderBy: { joinedAt: "asc" },
  });
  if (memberships.length === 0) return null;
  const bookId = memberships.find((m) => m.bookId === user.activeBookId)?.bookId ?? memberships[0].bookId;
  return loadContext(userId, bookId);
}

export async function loadContext(userId: string, bookId: string): Promise<BookContext> {
  const book = await prisma.book.findFirst({
    where: { id: bookId, deletedAt: null },
    include: { members: { where: { status: "ACTIVE" }, include: { user: true }, orderBy: { joinedAt: "asc" } } },
  });
  if (!book) throw new DomainError("BOOK_NOT_FOUND", "找不到帳本");
  const members = book.members.map((m) => ({
    userId: m.userId,
    nickname: m.nickname,
    role: m.role,
    avatarColor: m.user.avatarColor,
    avatarUrl: m.user.avatarUrl,
  }));
  const me = members.find((m) => m.userId === userId);
  if (!me) throw new DomainError("BOOK_FORBIDDEN", "你不是這個帳本的成員");
  return {
    book: {
      id: book.id,
      name: book.name,
      coverEmoji: book.coverEmoji,
      baseCurrency: book.baseCurrency,
      status: book.status,
      type: book.type as "MAIN" | "TRIP" | "CUSTOM",
      closedAt: book.closedAt,
      homeRate:
        book.baseCurrency !== HOME_CURRENCY && book.homeRateUnits && book.homeRateMinor
          ? { units: book.homeRateUnits, minor: book.homeRateMinor }
          : null,
    },
    me,
    members,
    partner: members.find((m) => m.userId !== userId && m.role !== "VIEWER") ?? null,
    canWrite: book.status === "ACTIVE" && (me.role === "OWNER" || me.role === "PARTNER"),
  };
}

export function assertCanWrite(ctx: BookContext) {
  assert(ctx.canWrite, "BOOK_READ_ONLY", "你沒有這個帳本的編輯權限");
}

async function createDefaultCategories(tx: Tx, bookId: string) {
  const rows = (["EXPENSE", "INCOME"] as const).flatMap((kind) =>
    DEFAULT_CATEGORIES[kind].map(([name, icon], i) => ({ bookId, kind, name, icon, sortOrder: i })),
  );
  await tx.category.createMany({ data: rows });
}

async function createPersonalCash(tx: Tx, bookId: string, userId: string) {
  await tx.account.create({
    data: { bookId, ownerId: userId, name: "現金", type: "CASH" as AccountType, createdById: userId, sortOrder: 0 },
  });
}

export async function createBook(userId: string, input: { name: string; nickname: string }) {
  const name = input.name.trim();
  const nickname = input.nickname.trim();
  assert(name.length >= 1 && name.length <= 30, "BOOK_NAME", "帳本名稱需為 1～30 個字");
  assert(nickname.length >= 1 && nickname.length <= 20, "BOOK_NICKNAME", "暱稱需為 1～20 個字");
  return prisma.$transaction(async (tx) => {
    const book = await tx.book.create({ data: { name, createdById: userId } });
    await tx.couple.create({ data: { bookId: book.id } });
    await tx.bookMember.create({ data: { bookId: book.id, userId, role: "OWNER", nickname } });
    await createDefaultCategories(tx, book.id);
    await createPersonalCash(tx, book.id, userId);
    await tx.account.create({
      data: { bookId: book.id, ownerId: null, name: "共同帳戶", type: "JOINT", createdById: userId, sortOrder: 10 },
    });
    await tx.user.update({ where: { id: userId }, data: { activeBookId: book.id } });
    await tx.auditLog.create({
      data: { bookId: book.id, actorId: userId, action: "CREATE", entityType: "Book", entityId: book.id, after: { name } },
    });
    return book;
  });
}

function newCode() {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

/** 產生（或沿用未過期的）邀請碼。 */
export async function getOrCreateInvite(ctx: BookContext) {
  assertCanWrite(ctx);
  assert(ctx.members.length < MAX_COUPLE_MEMBERS, "INVITE_FULL", "這個帳本已經有兩位成員了");
  const existing = await prisma.invite.findFirst({
    where: { bookId: ctx.book.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  for (let i = 0; i < 5; i++) {
    try {
      return await prisma.invite.create({
        data: {
          bookId: ctx.book.id,
          code: newCode(),
          role: "PARTNER",
          createdById: ctx.me.userId,
          expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
        },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  throw new DomainError("INVITE_CODE", "邀請碼產生失敗，請再試一次");
}

export async function revokeInvites(ctx: BookContext) {
  assertCanWrite(ctx);
  await prisma.invite.updateMany({
    where: { bookId: ctx.book.id, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** 邀請碼預覽（加入頁顯示用），無效回傳 null。 */
export async function previewInvite(codeInput: string) {
  const invite = await prisma.invite.findUnique({
    where: { code: normalizeCode(codeInput) },
    include: { book: { include: { members: { where: { status: "ACTIVE" } } } } },
  });
  if (!invite) return null;
  const inviter = invite.book.members.find((m) => m.userId === invite.createdById);
  const invalidReason =
    invite.revokedAt ? "邀請碼已被取消"
    : invite.usedAt ? "邀請碼已經被使用過了"
    : invite.expiresAt < new Date() ? "邀請碼已過期，請對方重新產生"
    : invite.book.members.length >= MAX_COUPLE_MEMBERS ? "這個帳本已經有兩位成員了"
    : null;
  return { code: invite.code, bookName: invite.book.name, inviterName: inviter?.nickname ?? "", invalidReason };
}

/** 接受邀請：加入帳本、建立個人現金帳戶、邀請碼作廢。 */
export async function acceptInvite(userId: string, codeInput: string, nicknameInput: string) {
  const nickname = nicknameInput.trim();
  assert(nickname.length >= 1 && nickname.length <= 20, "BOOK_NICKNAME", "暱稱需為 1～20 個字");
  const code = normalizeCode(codeInput);
  assert(code.length > 0, "INVITE_INVALID", "請輸入邀請碼");
  return prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findUnique({ where: { code } });
    assert(invite, "INVITE_INVALID", "邀請碼不存在");
    await lockBook(tx, invite.bookId);
    // 鎖定後重新讀取，避免兩人同時使用同一個邀請碼
    const fresh = await tx.invite.findUniqueOrThrow({ where: { id: invite.id } });
    assert(!fresh.revokedAt, "INVITE_REVOKED", "邀請碼已被取消");
    assert(!fresh.usedAt, "INVITE_USED", "邀請碼已經被使用過了");
    assert(fresh.expiresAt > new Date(), "INVITE_EXPIRED", "邀請碼已過期，請對方重新產生");
    const member = await tx.bookMember.findUnique({ where: { bookId_userId: { bookId: fresh.bookId, userId } } });
    assert(!member || member.status !== "ACTIVE", "INVITE_ALREADY_MEMBER", "你已經是這個帳本的成員了");
    const activeCount = await tx.bookMember.count({ where: { bookId: fresh.bookId, status: "ACTIVE" } });
    assert(activeCount < MAX_COUPLE_MEMBERS, "INVITE_FULL", "這個帳本已經有兩位成員了");

    if (member) {
      await tx.bookMember.update({
        where: { id: member.id },
        data: { status: "ACTIVE", role: fresh.role, nickname, leftAt: null },
      });
    } else {
      await tx.bookMember.create({ data: { bookId: fresh.bookId, userId, role: fresh.role, nickname } });
    }
    const hasAccount = await tx.account.count({ where: { bookId: fresh.bookId, ownerId: userId, deletedAt: null } });
    if (!hasAccount) await createPersonalCash(tx, fresh.bookId, userId);
    await tx.invite.update({ where: { id: fresh.id }, data: { usedAt: new Date(), usedById: userId } });
    await tx.user.update({ where: { id: userId }, data: { activeBookId: fresh.bookId } });
    await tx.auditLog.create({
      data: { bookId: fresh.bookId, actorId: userId, action: "JOIN", entityType: "BookMember", entityId: userId },
    });
    return { bookId: fresh.bookId };
  });
}

export async function updateBookSettings(ctx: BookContext, input: { name: string; nickname: string }) {
  assertCanWrite(ctx);
  const name = input.name.trim();
  const nickname = input.nickname.trim();
  assert(name.length >= 1 && name.length <= 30, "BOOK_NAME", "帳本名稱需為 1～30 個字");
  assert(nickname.length >= 1 && nickname.length <= 20, "BOOK_NICKNAME", "暱稱需為 1～20 個字");
  await prisma.$transaction([
    prisma.book.update({ where: { id: ctx.book.id }, data: { name } }),
    prisma.bookMember.update({
      where: { bookId_userId: { bookId: ctx.book.id, userId: ctx.me.userId } },
      data: { nickname },
    }),
  ]);
}

/* ───────────────────────── V15：帳本系統 ───────────────────────── */

export interface BookListItem {
  id: string;
  name: string;
  type: "MAIN" | "TRIP" | "CUSTOM";
  status: string;
  baseCurrency: string;
  startOn: string | null;
  endOn: string | null;
  closedAt: Date | null;
  isActive: boolean;
  /** 使用中（ACTIVE）還是歷史紀錄（已結案） */
  isClosed: boolean;
  note: string | null;
  homeRate: { units: number; minor: number } | null;
}

/** 「家裡的錢」。旁邊那行 ≈ 一律換算成這個幣別。 */
export const HOME_CURRENCY = "TWD";

const dayKey = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * 這個使用者的全部帳本。
 *
 * 排序刻意固定：原帳本永遠第一個，再來是使用中的旅遊／自訂帳本（新的在前），
 * 最後才是已結案的。帳本選擇器直接照這個順序畫，不用再排一次。
 */
export async function listMyBooks(userId: string): Promise<BookListItem[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const rows = await prisma.bookMember.findMany({
    where: { userId, status: "ACTIVE", book: { deletedAt: null } },
    include: { book: true },
  });
  return rows
    .map(({ book }) => ({
      id: book.id,
      name: book.name,
      type: book.type as BookListItem["type"],
      status: book.status as string,
      baseCurrency: book.baseCurrency,
      startOn: dayKey(book.startOn),
      endOn: dayKey(book.endOn),
      closedAt: book.closedAt,
      isActive: book.id === user.activeBookId,
      isClosed: book.status === "CLOSED",
      note: book.note,
      homeRate:
        book.baseCurrency !== HOME_CURRENCY && book.homeRateUnits && book.homeRateMinor
          ? { units: book.homeRateUnits, minor: book.homeRateMinor }
          : null,
    }))
    .sort((a, b) => {
      if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
      if ((a.type === "MAIN") !== (b.type === "MAIN")) return a.type === "MAIN" ? -1 : 1;
      return b.id.localeCompare(a.id); // cuid 單調遞增，新的在前
    });
}

/** 這個使用者的原帳本。購買紀錄固定掛在它身上。 */
export async function mainBookId(userId: string): Promise<string | null> {
  const row = await prisma.bookMember.findFirst({
    where: { userId, status: "ACTIVE", book: { deletedAt: null, type: "MAIN" } },
    orderBy: { joinedAt: "asc" },
  });
  return row?.bookId ?? null;
}

/**
 * 切換目前操作的帳本。
 *
 * **一定要先驗 membership** —— client 傳什麼 bookId 都不能相信（規格點 28）。
 * 已結案的帳本也可以切進去看（唯讀），擋寫入的是 canWrite，不是這裡。
 */
export async function switchBook(userId: string, bookId: string) {
  const member = await prisma.bookMember.findFirst({
    where: { userId, bookId, status: "ACTIVE", book: { deletedAt: null } },
  });
  assert(member, "BOOK_FORBIDDEN", "你不是這個帳本的成員");
  await prisma.user.update({ where: { id: userId }, data: { activeBookId: bookId } });
  return bookId;
}

export interface NewBookInput {
  name: string;
  type: "TRIP" | "CUSTOM";
  /** 不填就沿用原帳本的本位幣 */
  baseCurrency?: string | null;
  startOn?: string | null;
  endOn?: string | null;
  note?: string | null;
  /** 本位幣不是台幣時的參考匯率：homeRateUnits 個外幣 = homeRateMinor 台幣最小單位 */
  homeRateUnits?: number | null;
  homeRateMinor?: number | null;
}

/**
 * 建立第二本（以後的）帳本。
 *
 * 跟 onboarding 的 `createBook()` 是**不同的路徑**，差別很重要：
 *   * 成員直接沿用目前帳本的兩個人（不會要另一半再被邀請一次）
 *   * 不建新的 Couple —— 那是「這段關係」的紀錄，一趟旅行不是一段新關係
 *   * 帳戶只建最小一組（每人一個錢包 + 共同），**不複製真實銀行帳戶**，
 *     不然餘額會變成假的（規格點 21）
 *   * 分類複製目前帳本「還在用」的那些，用起來像共用（Category 是 bookId scoped，
 *     要真共用得改 schema，那會踩到「不要為了帳本功能重寫既有 domain」）
 */
export async function createSecondaryBook(ctx: BookContext, userId: string, input: NewBookInput) {
  assertCanWrite(ctx);
  const name = input.name.trim();
  assert(name.length >= 1 && name.length <= 30, "BOOK_NAME", "帳本名稱需為 1～30 個字");
  assert(input.type === "TRIP" || input.type === "CUSTOM", "BOOK_TYPE", "帳本類型不正確");
  const currency = (input.baseCurrency || ctx.book.baseCurrency).toUpperCase();
  assert(isCurrencyCode(currency), "BOOK_CURRENCY", "不支援的幣別");
  const note = (input.note ?? "").trim().slice(0, 200) || null;
  const start = input.startOn ? fromDateKey(input.startOn) : null;
  const end = input.endOn ? fromDateKey(input.endOn) : null;
  assert(!start || !end || start <= end, "BOOK_DATE", "結束日期不能早於開始日期");

  return prisma.$transaction(async (tx) => {
    const book = await tx.book.create({
      data: {
        name,
        type: input.type,
        baseCurrency: currency,
        startOn: start,
        endOn: end,
        note,
        ...homeRateData(currency, input),
        createdById: userId,
      },
    });

    // 成員照搬：兩個人、同樣的暱稱與角色
    const members = await tx.bookMember.findMany({ where: { bookId: ctx.book.id, status: "ACTIVE" } });
    for (const m of members) {
      await tx.bookMember.create({
        data: { bookId: book.id, userId: m.userId, role: m.role, nickname: m.nickname, status: "ACTIVE" },
      });
      // 每個人一個錢包（記「誰付的」最少需要這個）
      await tx.account.create({
        data: { bookId: book.id, ownerId: m.userId, name: `${m.nickname}的錢包`, type: "CASH" as AccountType, createdById: userId, sortOrder: 0 },
      });
    }
    await tx.account.create({
      data: { bookId: book.id, ownerId: null, name: "共同", type: "JOINT" as AccountType, createdById: userId, sortOrder: 10 },
    });

    // 分類：複製目前帳本還在用的那些（名稱、圖示、順序一樣）
    const cats = await tx.category.findMany({
      where: { bookId: ctx.book.id, isArchived: false },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
    });
    if (cats.length > 0) {
      await tx.category.createMany({
        data: cats.map((c) => ({ bookId: book.id, kind: c.kind, name: c.name, icon: c.icon, sortOrder: c.sortOrder })),
      });
    } else {
      await createDefaultCategories(tx, book.id);
    }

    await tx.auditLog.create({
      data: { bookId: book.id, actorId: userId, action: "CREATE", entityType: "Book", entityId: book.id, after: { name, type: input.type } },
    });
    return book;
  });
}

/**
 * 表單那個單一欄位（「1 個外幣 = ? 台幣」）→ 要存進 Book 的兩個欄位。
 *
 * 參考匯率跟交易匯率用的是同一套存法與同一個解析函式，只是這邊的「本位幣」固定是台幣。
 */
export function homeRatePair(text: string) {
  const pair = parseRatePair(text, HOME_CURRENCY);
  return { homeRateUnits: pair?.foreignUnits ?? null, homeRateMinor: pair?.baseMinor ?? null };
}

/**
 * 只改這本帳本的匯率（旅遊帳本首頁那張小卡用的）。
 *
 * 跟 updateBook() 分開，是因為首頁那張卡只有一個欄位 —— 走 updateBook() 就得把名稱、
 * 起訖日一起送上來，漏一個就會被清掉。匯率是**這本帳本自己的欄位**，
 * 改日本旅遊不會動到韓國旅遊（規格點 11）。
 *
 * 跟交易一樣的財務規則：這裡只寫 Book，不碰任何 Transaction，
 * 所以已經記過的帳用的還是當時那個匯率。
 */
export async function setHomeRate(ctx: BookContext, text: string) {
  assertCanWrite(ctx);
  assert(ctx.book.baseCurrency !== HOME_CURRENCY, "RATE_BASE", "這本帳本本來就是台幣，不需要匯率");
  const pair = parseRatePair(text, HOME_CURRENCY);
  assert(pair, "RATE_VALUE", `請輸入 1 ${ctx.book.baseCurrency} 等於多少台幣（小數最多六位）`);
  await prisma.book.update({
    where: { id: ctx.book.id },
    data: { homeRateUnits: pair!.foreignUnits, homeRateMinor: pair!.baseMinor },
  });
}

/**
 * 把表單填的「換回台幣」匯率整理成要寫進 Book 的欄位。
 * 本位幣就是台幣時一律清成 null —— 不要留下用不到又會誤導的數字。
 */
function homeRateData(currency: string, input: { homeRateUnits?: number | null; homeRateMinor?: number | null }) {
  if (currency === HOME_CURRENCY) return { homeRateUnits: null, homeRateMinor: null };
  const units = input.homeRateUnits ?? null;
  const minor = input.homeRateMinor ?? null;
  if (!units || !minor) return { homeRateUnits: null, homeRateMinor: null };
  assertRate({ foreignUnits: units, baseMinor: minor });
  return { homeRateUnits: units, homeRateMinor: minor };
}

/** 編輯帳本：名稱、日期、備註、換回台幣的匯率。已結案的不能改。 */
export async function updateBook(
  ctx: BookContext,
  input: { name: string; startOn?: string | null; endOn?: string | null; note?: string | null; homeRateUnits?: number | null; homeRateMinor?: number | null },
) {
  assertCanWrite(ctx);
  const name = input.name.trim();
  assert(name.length >= 1 && name.length <= 30, "BOOK_NAME", "帳本名稱需為 1～30 個字");
  const start = input.startOn ? fromDateKey(input.startOn) : null;
  const end = input.endOn ? fromDateKey(input.endOn) : null;
  assert(!start || !end || start <= end, "BOOK_DATE", "結束日期不能早於開始日期");
  await prisma.book.update({
    where: { id: ctx.book.id },
    data: {
      name,
      startOn: start,
      endOn: end,
      note: (input.note ?? "").trim().slice(0, 200) || null,
      ...homeRateData(ctx.book.baseCurrency, input),
    },
  });
}

/**
 * 永久刪除一本帳本，連同裡面的全部資料。
 *
 * **救不回來。** 所以呼叫端一定要先讓使用者把帳本名稱一字不差打進來（confirmName）。
 * 原帳本永遠不能刪 —— 它是這對情侶的本體。
 */
export async function deleteBook(userId: string, bookId: string, confirmName: string) {
  const member = await prisma.bookMember.findFirst({ where: { userId, bookId, status: "ACTIVE" } });
  assert(member, "BOOK_FORBIDDEN", "你不是這個帳本的成員");
  const book = await prisma.book.findFirstOrThrow({ where: { id: bookId } });
  assert(book.type !== "MAIN", "BOOK_MAIN_DELETE", "原帳本不能刪除");
  assert(confirmName.trim() === book.name, "BOOK_CONFIRM_NAME", "帳本名稱不符，請一字不差地輸入");

  await prisma.$transaction(async (tx) => {
    // 依外鍵相依順序一路刪乾淨。Prisma 的 onDelete: Cascade 只有部分關聯設了，
    // 所以這裡明寫順序，確保不會留下孤兒列。
    const txIds = (await tx.transaction.findMany({ where: { bookId }, select: { id: true } })).map((t) => t.id);
    await tx.transactionTag.deleteMany({ where: { transactionId: { in: txIds } } });
    await tx.transactionPayment.deleteMany({ where: { transactionId: { in: txIds } } });
    await tx.transactionSplit.deleteMany({ where: { transactionId: { in: txIds } } });
    await tx.purchaseEntry.deleteMany({ where: { bookId } });
    await tx.purchaseKeyword.deleteMany({ where: { bookId } });
    await tx.purchaseTag.deleteMany({ where: { group: { bookId } } });
    await tx.purchaseCategory.deleteMany({ where: { group: { bookId } } });
    await tx.purchaseGroup.deleteMany({ where: { bookId } });
    await tx.settlement.deleteMany({ where: { bookId } });
    await tx.fundTransaction.deleteMany({ where: { bookId } });
    await tx.goal.deleteMany({ where: { bookId } });
    await tx.fund.deleteMany({ where: { bookId } });
    await tx.checkIn.deleteMany({ where: { bookId } });
    await tx.taskReward.deleteMany({ where: { bookId } });
    await tx.taskPenalty.deleteMany({ where: { bookId } });
    await tx.task.deleteMany({ where: { bookId } });
    await tx.budget.deleteMany({ where: { bookId } });
    await tx.recurringExpense.deleteMany({ where: { bookId } });
    await tx.preorderItem.deleteMany({ where: { preorder: { bookId } } });
    await tx.preorder.deleteMany({ where: { bookId } });
    await tx.attachment.deleteMany({ where: { bookId } });
    await tx.deleteRequest.deleteMany({ where: { bookId } });
    await tx.userAchievement.deleteMany({ where: { bookId } });
    await tx.transaction.deleteMany({ where: { bookId } });
    await tx.account.deleteMany({ where: { bookId } });
    await tx.category.deleteMany({ where: { bookId } });
    await tx.tag.deleteMany({ where: { bookId } });
    await tx.exchangeRate.deleteMany({ where: { bookId } });
    await tx.invite.deleteMany({ where: { bookId } });
    await tx.bookMember.deleteMany({ where: { bookId } });
    await tx.auditLog.deleteMany({ where: { bookId } });
    await tx.couple.deleteMany({ where: { bookId } });
    await tx.book.delete({ where: { id: bookId } });
  });

  // 目前帳本如果就是被刪掉的那本，切回原帳本
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.activeBookId === bookId) {
    const main = await mainBookId(userId);
    if (main) await switchBook(userId, main);
  }
  return book.name;
}

/**
 * 結案。
 *
 * **原帳本永遠不能結案**（規格點 14）。結案不刪任何資料 —— 只是把 status 改掉，
 * 而 canWrite 本來就要求 ACTIVE，所以之後所有財務寫入會被既有的 assertCanWrite 擋下來。
 */
export async function closeBook(ctx: BookContext, userId: string) {
  assertCanWrite(ctx);
  const book = await prisma.book.findUniqueOrThrow({ where: { id: ctx.book.id } });
  assert(book.type !== "MAIN", "BOOK_MAIN_CLOSE", "原帳本不能結案");
  assert(book.status === "ACTIVE", "BOOK_NOT_ACTIVE", "這本帳本已經結案了");
  await prisma.$transaction(async (tx) => {
    await tx.book.update({ where: { id: book.id }, data: { status: "CLOSED", closedAt: new Date() } });
    await tx.auditLog.create({
      data: { bookId: book.id, actorId: userId, action: "UPDATE", entityType: "Book", entityId: book.id, after: { status: "CLOSED" } },
    });
  });
  // 結案後把目前帳本切回原帳本，不然使用者會停在一本動不了的帳本上
  const main = await mainBookId(userId);
  if (main) await switchBook(userId, main);
  return main;
}

/**
 * 重新開啟。回到使用中的帳本，並且**自動切換過去**（規格點 17）。
 * 呼叫端要負責把「會切過去」這件事講給使用者聽。
 */
export async function reopenBook(userId: string, bookId: string) {
  const member = await prisma.bookMember.findFirst({ where: { userId, bookId, status: "ACTIVE" } });
  assert(member, "BOOK_FORBIDDEN", "你不是這個帳本的成員");
  const book = await prisma.book.findFirstOrThrow({ where: { id: bookId, deletedAt: null } });
  assert(book.status === "CLOSED", "BOOK_NOT_CLOSED", "這本帳本沒有結案");
  await prisma.$transaction(async (tx) => {
    await tx.book.update({ where: { id: bookId }, data: { status: "ACTIVE", closedAt: null } });
    await tx.auditLog.create({
      data: { bookId, actorId: userId, action: "UPDATE", entityType: "Book", entityId: bookId, after: { status: "ACTIVE" } },
    });
  });
  await switchBook(userId, bookId);
  return bookId;
}
