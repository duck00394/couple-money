import { randomInt } from "node:crypto";
import { Prisma, type AccountType } from "@prisma/client";
import { prisma, lockBook, type Tx } from "../db";
import { assert, DomainError } from "../domain/errors";

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
  book: { id: string; name: string; coverEmoji: string; currency: string; status: string };
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
    book: { id: book.id, name: book.name, coverEmoji: book.coverEmoji, currency: book.currency, status: book.status },
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
