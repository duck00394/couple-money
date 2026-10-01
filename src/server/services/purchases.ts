/**
 * 購買紀錄（V12）。
 *
 * **這裡完全不碰金流。** PurchaseEntry 不產生 TransactionPayment 也不產生
 * TransactionSplit，所以 accountBalances() 與 netPositions() 根本看不到它；
 * 帳戶餘額、欠款、分帳、基金、預算、統計、結算一律不受影響。
 * 移除購買紀錄只刪 PurchaseEntry，Transaction 一個欄位都不動。
 *
 * 三個不變式在這裡成立（UI 只是第二層防護）：
 *   1. 每個作品恰好一個預設角色 —— 至多一個由 partial unique index 擋，
 *      至少一個由「建立作品時同一個 $transaction 一起建、且拒絕刪除 default」保證
 *   2. 刪除一般角色時，底下的購買紀錄同一個 $transaction 轉到該作品的預設角色，
 *      不會失去分類，ownerId 原封不動
 *   3. ownerId 必須是這個帳本的成員（或 null = 共同），不接受別的帳本的 userId
 */
import { prisma, lockBook, type Tx } from "../db";
import { assert } from "../domain/errors";
import {
  assertEntryAmount, assertEntryNote, assertEntryTitle, assertGroupName, assertKeyword, assertTagName,
  entryValue, matchKeywords, matchText, nameKey, normalizeKeyword, ownerWhere, totals,
  type EntryValue, type KeywordRule, type PurchaseTotals,
} from "../domain/purchase";
import { fromDateTime } from "@/lib/dates";
import { assertCanWrite, type BookContext } from "./books";
import { auditIn } from "./funds";

type Client = Tx | typeof prisma;

/** 預設角色的出廠名稱。使用者可以改名，所以**只有建立時用得到這個字串**，判斷一律看 isDefault。 */
export const DEFAULT_TAG_NAME = "全角色";

/* ───────────────────────── 共用檢查 ───────────────────────── */

/**
 * 歸屬只能是「共同」或這個帳本的成員。
 *
 * 前端的 chip 只是方便，真正的防線在這裡：沒有這一層的話，
 * 送一個別的帳本的 userId 進來就會在購買紀錄裡長出一個不存在的人。
 */
export function assertOwner(ctx: BookContext, ownerId: string | null): string | null {
  if (ownerId === null) return null;
  assert(
    ctx.members.some((m) => m.userId === ownerId),
    "PURCHASE_OWNER",
    "歸屬只能是共同、或這個帳本的成員",
  );
  return ownerId;
}

/** 取得某個作品的預設角色。不變式壞掉時寧可大聲失敗，也不要靜靜地寫出沒有分類的資料。 */
export async function defaultTagOf(client: Client, groupId: string) {
  const tag = await client.purchaseTag.findFirst({ where: { groupId, isDefault: true } });
  assert(tag, "PURCHASE_DEFAULT_TAG_MISSING", "這個作品缺少預設角色，請聯絡開發者");
  return tag;
}

async function loadGroup(client: Client, ctx: BookContext, groupId: string) {
  const g = await client.purchaseGroup.findFirst({ where: { id: groupId, bookId: ctx.book.id } });
  assert(g, "PURCHASE_GROUP_NOT_FOUND", "找不到這個作品");
  return g;
}

/** 同一個帳本不可以有同名作品（忽略大小寫與前後空白）。 */
async function assertGroupNameFree(client: Client, ctx: BookContext, name: string, exceptId?: string) {
  const rows = await client.purchaseGroup.findMany({ where: { bookId: ctx.book.id }, select: { id: true, name: true } });
  const clash = rows.find((r) => r.id !== exceptId && nameKey(r.name) === nameKey(name));
  assert(!clash, "PURCHASE_GROUP_DUPLICATE", `已經有一個叫「${clash?.name}」的作品了`);
}

/** 同一個作品裡不可以有同名角色。 */
async function assertTagNameFree(client: Client, groupId: string, name: string, exceptId?: string) {
  const rows = await client.purchaseTag.findMany({ where: { groupId }, select: { id: true, name: true } });
  const clash = rows.find((r) => r.id !== exceptId && nameKey(r.name) === nameKey(name));
  assert(!clash, "PURCHASE_TAG_DUPLICATE", `這個作品裡已經有一個叫「${clash?.name}」的角色了`);
}

/* ───────────────────────── 作品 ───────────────────────── */

export interface GroupInput {
  name: string;
  icon?: string;
}

/**
 * 建立作品。**同一個 $transaction 內一起建出預設角色**，
 * 不存在「先有作品、之後再補落點」的中間狀態。
 */
export async function createGroup(ctx: BookContext, input: GroupInput) {
  assertCanWrite(ctx);
  const name = assertGroupName(input.name);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    await assertGroupNameFree(tx, ctx, name);
    const last = await tx.purchaseGroup.findFirst({
      where: { bookId: ctx.book.id }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true },
    });
    const group = await tx.purchaseGroup.create({
      data: {
        bookId: ctx.book.id, name, icon: (input.icon ?? "gift").trim() || "gift",
        sortOrder: (last?.sortOrder ?? 0) + 1,
        createdById: ctx.me.userId, updatedById: ctx.me.userId,
      },
    });
    // 不變式 1：每個作品恰好一個預設角色，在這裡就建出來
    await tx.purchaseTag.create({
      data: { groupId: group.id, name: DEFAULT_TAG_NAME, isDefault: true, sortOrder: 0 },
    });
    await auditIn(tx, ctx, "CREATE", "PurchaseGroup", group.id, null, { name, icon: group.icon });
    return group;
  });
}

export async function updateGroup(ctx: BookContext, groupId: string, input: GroupInput) {
  assertCanWrite(ctx);
  const name = assertGroupName(input.name);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await loadGroup(tx, ctx, groupId);
    await assertGroupNameFree(tx, ctx, name, groupId);
    const icon = (input.icon ?? before.icon).trim() || before.icon;
    const updated = await tx.purchaseGroup.update({
      where: { id: groupId }, data: { name, icon, updatedById: ctx.me.userId },
    });
    await auditIn(tx, ctx, "UPDATE", "PurchaseGroup", groupId, { name: before.name, icon: before.icon }, { name, icon });
    return updated;
  });
}

/** 還有購買紀錄的作品不可以刪除（照 assertFundDeletable 的既有做法：先擋住、再請使用者處理）。 */
export async function deleteGroup(ctx: BookContext, groupId: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await loadGroup(tx, ctx, groupId);
    const used = await tx.purchaseEntry.count({ where: { groupId } });
    assert(
      used === 0,
      "PURCHASE_GROUP_IN_USE",
      `「${before.name}」底下還有 ${used} 筆購買紀錄，不能刪除。請先把它們移到別的作品或移除。`,
    );
    // 角色與關鍵字是 onDelete: Cascade，跟著走
    await tx.purchaseGroup.delete({ where: { id: groupId } });
    await auditIn(tx, ctx, "DELETE", "PurchaseGroup", groupId, before, null);
  });
}

/* ───────────────────────── 角色 ───────────────────────── */

export async function createTag(ctx: BookContext, groupId: string, name: string) {
  assertCanWrite(ctx);
  const clean = assertTagName(name);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    await loadGroup(tx, ctx, groupId);
    await assertTagNameFree(tx, groupId, clean);
    const last = await tx.purchaseTag.findFirst({ where: { groupId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const tag = await tx.purchaseTag.create({
      data: { groupId, name: clean, isDefault: false, sortOrder: (last?.sortOrder ?? 0) + 1 },
    });
    await auditIn(tx, ctx, "CREATE", "PurchaseTag", tag.id, null, { groupId, name: clean });
    return tag;
  });
}

/** 改名。**預設角色也可以改名**，改了仍然是這個作品的落點（判斷看 isDefault，不看名字）。 */
export async function renameTag(ctx: BookContext, tagId: string, name: string) {
  assertCanWrite(ctx);
  const clean = assertTagName(name);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.purchaseTag.findFirst({ where: { id: tagId, group: { bookId: ctx.book.id } } });
    assert(before, "PURCHASE_TAG_NOT_FOUND", "找不到這個角色");
    await assertTagNameFree(tx, before.groupId, clean, tagId);
    const updated = await tx.purchaseTag.update({ where: { id: tagId }, data: { name: clean } });
    await auditIn(tx, ctx, "UPDATE", "PurchaseTag", tagId, { name: before.name, isDefault: before.isDefault }, { name: clean });
    return updated;
  });
}

/**
 * 刪除一般角色。
 *
 * 不變式 2：底下的購買紀錄在**同一個 $transaction** 內轉到該作品的預設角色。
 * 順序不能顛倒（先轉、後刪），否則外鍵會擋住。ownerId 一個字都不動。
 */
export async function deleteTag(ctx: BookContext, tagId: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.purchaseTag.findFirst({ where: { id: tagId, group: { bookId: ctx.book.id } } });
    assert(before, "PURCHASE_TAG_NOT_FOUND", "找不到這個角色");
    assert(
      !before.isDefault,
      "PURCHASE_TAG_DEFAULT",
      "這是這個作品的預設角色，不能刪除。沒有它的話，只對到作品的購買紀錄就沒地方放了。可以改名。",
    );
    const fallback = await defaultTagOf(tx, before.groupId);
    const moved = await tx.purchaseEntry.updateMany({ where: { tagId }, data: { tagId: fallback.id } });
    await tx.purchaseTag.delete({ where: { id: tagId } });
    await auditIn(tx, ctx, "DELETE", "PurchaseTag", tagId, before, { movedTo: fallback.id, movedCount: moved.count });
    return { movedCount: moved.count, fallbackName: fallback.name };
  });
}

/* ───────────────────────── 關鍵字 ───────────────────────── */

export async function addKeyword(ctx: BookContext, input: { groupId: string; tagId: string | null; word: string }) {
  assertCanWrite(ctx);
  const word = assertKeyword(input.word);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    await loadGroup(tx, ctx, input.groupId);
    if (input.tagId) {
      const tag = await tx.purchaseTag.findFirst({ where: { id: input.tagId, groupId: input.groupId } });
      assert(tag, "PURCHASE_TAG_NOT_FOUND", "找不到這個角色");
    }
    const dup = await tx.purchaseKeyword.findUnique({ where: { bookId_word: { bookId: ctx.book.id, word } } });
    assert(!dup, "PURCHASE_KEYWORD_DUPLICATE", `關鍵字「${word}」已經用在別的地方了`);
    const kw = await tx.purchaseKeyword.create({
      data: { bookId: ctx.book.id, groupId: input.groupId, tagId: input.tagId, word },
    });
    await auditIn(tx, ctx, "CREATE", "PurchaseKeyword", kw.id, null, { word, groupId: input.groupId, tagId: input.tagId });
    return kw;
  });
}

export async function deleteKeyword(ctx: BookContext, keywordId: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    const before = await tx.purchaseKeyword.findFirst({ where: { id: keywordId, bookId: ctx.book.id } });
    assert(before, "PURCHASE_KEYWORD_NOT_FOUND", "找不到這個關鍵字");
    await tx.purchaseKeyword.delete({ where: { id: keywordId } });
    await auditIn(tx, ctx, "DELETE", "PurchaseKeyword", keywordId, before, null);
  });
}

async function keywordRules(client: Client, bookId: string): Promise<KeywordRule[]> {
  const rows = await client.purchaseKeyword.findMany({
    where: { bookId }, orderBy: { createdAt: "asc" },
    select: { word: true, groupId: true, tagId: true },
  });
  return rows;
}

/**
 * 關鍵字比對一段文字。只回傳作品與角色，**永遠不判斷歸屬**。
 * 只命中作品時換成該作品的預設角色（名稱可能已被改掉，所以查 isDefault 而不是查名字）。
 */
export async function detect(
  ctx: BookContext,
  parts: { title?: string | null; merchant?: string | null; note?: string | null },
  client: Client = prisma,
): Promise<{ groupId: string; tagId: string; word: string; fallback: boolean } | null> {
  const hit = matchKeywords(matchText(parts), await keywordRules(client, ctx.book.id));
  if (!hit) return null;
  const tagId = hit.tagId ?? (await defaultTagOf(client, hit.groupId)).id;
  return { groupId: hit.groupId, tagId, word: hit.word, fallback: hit.fallback };
}

export interface TrialRow {
  transactionId: string;
  title: string;
  hit: boolean;
  groupName?: string;
  tagName?: string;
  word?: string;
}

/**
 * 試跑：拿最近的記帳跑一次，看看目前的關鍵字會抓到什麼。
 * **純唯讀，一筆資料都不會改。** 命中與沒命中都回傳，因為「沒亂抓」跟「有抓到」一樣重要。
 */
export async function trialRun(ctx: BookContext, take = 50): Promise<TrialRow[]> {
  const [txs, rules, groups, tags] = await Promise.all([
    prisma.transaction.findMany({
      where: { bookId: ctx.book.id, type: "EXPENSE", status: "POSTED", deletedAt: null },
      orderBy: { occurredAt: "desc" }, take,
      select: { id: true, title: true, merchant: true, note: true },
    }),
    keywordRules(prisma, ctx.book.id),
    prisma.purchaseGroup.findMany({ where: { bookId: ctx.book.id }, select: { id: true, name: true } }),
    prisma.purchaseTag.findMany({ where: { group: { bookId: ctx.book.id } }, select: { id: true, groupId: true, name: true, isDefault: true } }),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const defaultTag = new Map(tags.filter((t) => t.isDefault).map((t) => [t.groupId, t]));
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  return txs.map((t) => {
    const hit = matchKeywords(matchText(t), rules);
    if (!hit) return { transactionId: t.id, title: t.title ?? "(沒有名稱)", hit: false };
    const tid = hit.tagId ?? defaultTag.get(hit.groupId)?.id;
    return {
      transactionId: t.id,
      title: t.title ?? "(沒有名稱)",
      hit: true,
      groupName: groupName.get(hit.groupId) ?? "",
      // 落點一律讀 tag 目前的名字：預設角色被改名成「未分類」時這裡也會跟著變
      tagName: tid ? tagName.get(tid) ?? "" : "",
      word: hit.word,
    };
  });
}

/* ───────────────────────── 購買紀錄 ───────────────────────── */

const ENTRY_INCLUDE = {
  transaction: { select: { title: true, occurredAt: true, amount: true, deletedAt: true } },
} as const;

export interface EntryView extends EntryValue {
  id: string;
  groupId: string;
  groupName: string;
  tagId: string;
  tagName: string;
  tagIsDefault: boolean;
  ownerId: string | null;
  transactionId: string | null;
  note: string | null;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

function toView(
  e: Awaited<ReturnType<typeof prisma.purchaseEntry.findMany>>[number] & {
    transaction: { title: string | null; occurredAt: Date; amount: number; deletedAt: Date | null } | null;
    group: { name: string };
    tag: { name: string; isDefault: boolean };
  },
): EntryView {
  return {
    ...entryValue(e),
    id: e.id,
    groupId: e.groupId,
    groupName: e.group.name,
    tagId: e.tagId,
    tagName: e.tag.name,
    tagIsDefault: e.tag.isDefault,
    ownerId: e.ownerId,
    transactionId: e.transactionId,
    note: e.note,
    createdById: e.createdById,
    updatedById: e.updatedById,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export interface GroupSummary {
  id: string;
  name: string;
  icon: string;
  tagCount: number;
  keywordCount: number;
  totals: PurchaseTotals;
  /** 共同／各成員的件數，首頁用一行小字帶過，不做成篩選 */
  byOwner: Array<{ ownerId: string | null; count: number }>;
  deletable: boolean;
}

/** 購買紀錄首頁：作品列表。作品是唯一的第一層入口，這裡不展開任何角色。 */
export async function listGroups(ctx: BookContext): Promise<GroupSummary[]> {
  const [groups, entries, tagCounts, kwCounts] = await Promise.all([
    prisma.purchaseGroup.findMany({ where: { bookId: ctx.book.id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.purchaseEntry.findMany({ where: { bookId: ctx.book.id }, include: ENTRY_INCLUDE }),
    prisma.purchaseTag.groupBy({ by: ["groupId"], where: { group: { bookId: ctx.book.id } }, _count: { _all: true } }),
    prisma.purchaseKeyword.groupBy({ by: ["groupId"], where: { bookId: ctx.book.id }, _count: { _all: true } }),
  ]);
  const tagCount = new Map(tagCounts.map((t) => [t.groupId, t._count._all]));
  const kwCount = new Map(kwCounts.map((t) => [t.groupId, t._count._all]));
  return groups.map((g) => {
    const mine = entries.filter((e) => e.groupId === g.id);
    const values = mine.map(entryValue);
    const byOwner = [null, ...ctx.members.map((m) => m.userId)].map((ownerId) => ({
      ownerId,
      count: mine.filter((e, i) => e.ownerId === ownerId && !values[i].voided).length,
    }));
    return {
      id: g.id, name: g.name, icon: g.icon,
      tagCount: tagCount.get(g.id) ?? 0,
      keywordCount: kwCount.get(g.id) ?? 0,
      totals: totals(values),
      byOwner,
      deletable: mine.length === 0,
    };
  });
}

export interface GroupDetail {
  id: string;
  name: string;
  icon: string;
  tags: Array<{ id: string; name: string; isDefault: boolean; count: number }>;
  entries: EntryView[];
  /** 目前篩選條件下的件數與金額 */
  totals: PurchaseTotals;
  /** 原始記帳已作廢、需要處理的那幾筆（不含在 entries 裡） */
  voided: EntryView[];
}

/**
 * 作品內頁。歸屬與角色是**兩個互不相干的維度**，可以同時套用，
 * 件數與金額跟著篩選走（用同一組 where 算出來的那批紀錄加總）。
 */
export async function getGroupDetail(
  ctx: BookContext,
  groupId: string,
  filter: { owner?: string | null; tagId?: string | null } = {},
): Promise<GroupDetail> {
  const group = await loadGroup(prisma, ctx, groupId);
  const [tags, all] = await Promise.all([
    prisma.purchaseTag.findMany({ where: { groupId }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] }),
    prisma.purchaseEntry.findMany({
      where: { bookId: ctx.book.id, groupId },
      include: { ...ENTRY_INCLUDE, group: { select: { name: true } }, tag: { select: { name: true, isDefault: true } } },
    }),
  ]);
  const views = all.map(toView);
  // 兩個維度各自獨立：歸屬的「全部」＝不加 ownerId 條件，角色的「全部」＝不加 tagId 條件
  const where = ownerWhere(filter.owner);
  const matched = views.filter(
    (v) => (!("ownerId" in where) || v.ownerId === where.ownerId) && (!filter.tagId || v.tagId === filter.tagId),
  );
  const byDate = (a: EntryView, b: EntryView) => b.occurredAt.getTime() - a.occurredAt.getTime();
  return {
    id: group.id, name: group.name, icon: group.icon,
    tags: tags.map((t) => ({
      id: t.id, name: t.name, isDefault: t.isDefault,
      // 角色旁邊的件數也跟著目前的歸屬篩選走
      count: views.filter((v) => v.tagId === t.id && !v.voided && (!("ownerId" in where) || v.ownerId === where.ownerId)).length,
    })),
    entries: matched.filter((v) => !v.voided).sort(byDate),
    totals: totals(matched),
    voided: matched.filter((v) => v.voided).sort(byDate),
  };
}

export async function getEntry(ctx: BookContext, id: string): Promise<EntryView | null> {
  const e = await prisma.purchaseEntry.findFirst({
    where: { id, bookId: ctx.book.id },
    include: { ...ENTRY_INCLUDE, group: { select: { name: true } }, tag: { select: { name: true, isDefault: true } } },
  });
  return e ? toView(e) : null;
}

/** 這筆交易有沒有已經加入購買紀錄（含已作廢的，避免同一筆重複加兩次）。 */
export async function entryOfTransaction(ctx: BookContext, transactionId: string): Promise<EntryView | null> {
  const e = await prisma.purchaseEntry.findFirst({
    where: { transactionId, bookId: ctx.book.id },
    include: { ...ENTRY_INCLUDE, group: { select: { name: true } }, tag: { select: { name: true, isDefault: true } } },
  });
  return e ? toView(e) : null;
}

/** 還沒加入購買紀錄的記帳，給「從既有記帳挑一筆」用。 */
export async function listAddableTransactions(ctx: BookContext, take = 30) {
  const rows = await prisma.transaction.findMany({
    where: {
      bookId: ctx.book.id, type: "EXPENSE", status: "POSTED", deletedAt: null,
      purchaseEntry: null, // 已經加入過的不再出現，這就是防重複的機制
    },
    orderBy: { occurredAt: "desc" }, take,
    include: { category: { select: { name: true, icon: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    title: t.title ?? "(沒有名稱)",
    amount: t.amount,
    occurredAt: t.occurredAt,
    categoryName: t.category?.name ?? "未分類",
    categoryIcon: t.category?.icon ?? "tag",
  }));
}

export interface EntryInput {
  groupId: string;
  tagId: string;
  /** null = 共同 */
  ownerId: string | null;
  note?: string;
}

/** 手動歷史購買才要填的三個欄位。 */
export interface ManualEntryInput extends EntryInput {
  title: string;
  amount: number;
  occurredOn: string;
}

/** 共用：檢查作品、角色、歸屬三者都合法且彼此相容。 */
async function resolveTarget(tx: Tx, ctx: BookContext, input: EntryInput) {
  await loadGroup(tx, ctx, input.groupId);
  const tag = await tx.purchaseTag.findFirst({ where: { id: input.tagId, groupId: input.groupId } });
  assert(tag, "PURCHASE_TAG_NOT_FOUND", "這個角色不屬於這個作品");
  return { tagId: tag.id, ownerId: assertOwner(ctx, input.ownerId) };
}

/**
 * 從既有交易加入購買紀錄。
 * 金額與日期**直接引用**那筆交易，本表不另存一份，所以不可能對不起來。
 */
export async function addFromTransaction(ctx: BookContext, transactionId: string, input: EntryInput) {
  assertCanWrite(ctx);
  const note = assertEntryNote(input.note ?? "");
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const t = await tx.transaction.findFirst({ where: { id: transactionId, bookId: ctx.book.id } });
    assert(t, "PURCHASE_TX_NOT_FOUND", "找不到這筆記帳");
    const dup = await tx.purchaseEntry.findUnique({ where: { transactionId } });
    assert(!dup, "PURCHASE_TX_DUPLICATE", "這筆記帳已經加入過購買紀錄了");
    const { tagId, ownerId } = await resolveTarget(tx, ctx, input);
    const entry = await tx.purchaseEntry.create({
      data: {
        bookId: ctx.book.id, groupId: input.groupId, tagId, ownerId, transactionId,
        note: note || null, createdById: ctx.me.userId, updatedById: ctx.me.userId,
      },
    });
    await auditIn(tx, ctx, "CREATE", "PurchaseEntry", entry.id, null, { transactionId, groupId: input.groupId, tagId, ownerId });
    return entry;
  });
}

/**
 * 獨立的歷史購買。**不建立 Transaction**，所以不影響帳戶餘額、欠款、分帳、
 * 基金、預算與統計——它只是購買歷史。
 */
export async function addManual(ctx: BookContext, input: ManualEntryInput) {
  assertCanWrite(ctx);
  const title = assertEntryTitle(input.title);
  const amount = assertEntryAmount(input.amount);
  const note = assertEntryNote(input.note ?? "");
  let occurredAt: Date;
  try {
    occurredAt = fromDateTime(input.occurredOn, null);
  } catch {
    assert(false, "PURCHASE_DATE", "日期格式不正確");
    throw new Error("unreachable");
  }
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const { tagId, ownerId } = await resolveTarget(tx, ctx, input);
    const entry = await tx.purchaseEntry.create({
      data: {
        bookId: ctx.book.id, groupId: input.groupId, tagId, ownerId,
        transactionId: null, title, amount, occurredAt, note: note || null,
        createdById: ctx.me.userId, updatedById: ctx.me.userId,
      },
    });
    await auditIn(tx, ctx, "CREATE", "PurchaseEntry", entry.id, null, { title, amount, groupId: input.groupId, tagId, ownerId });
    return entry;
  });
}

export interface UpdateEntryInput extends EntryInput {
  /** 只有手動紀錄可以改；來自記帳的傳進來會被忽略 */
  title?: string;
  amount?: number;
  occurredOn?: string;
}

/**
 * 編輯購買紀錄。
 *
 * 作品、歸屬、角色兩種來源都可以改。
 * **金額與日期只有手動紀錄能改**——來自記帳的那種一律讀交易的，
 * 購買紀錄不會、也不該蓋掉財務資料。
 */
export async function updateEntry(ctx: BookContext, id: string, input: UpdateEntryInput) {
  assertCanWrite(ctx);
  const note = assertEntryNote(input.note ?? "");
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.purchaseEntry.findFirst({ where: { id, bookId: ctx.book.id } });
    assert(before, "PURCHASE_ENTRY_NOT_FOUND", "找不到這筆購買紀錄");
    const { tagId, ownerId } = await resolveTarget(tx, ctx, input);

    const data: Record<string, unknown> = { groupId: input.groupId, tagId, ownerId, note: note || null, updatedById: ctx.me.userId };
    if (before.transactionId === null) {
      // 手動紀錄：三個欄位都能改
      if (input.title !== undefined) data.title = assertEntryTitle(input.title);
      if (input.amount !== undefined) data.amount = assertEntryAmount(input.amount);
      if (input.occurredOn !== undefined) {
        try {
          data.occurredAt = fromDateTime(input.occurredOn, null);
        } catch {
          assert(false, "PURCHASE_DATE", "日期格式不正確");
        }
      }
    }
    const updated = await tx.purchaseEntry.update({ where: { id }, data });
    await auditIn(tx, ctx, "UPDATE", "PurchaseEntry", id, before, data);
    return updated;
  });
}

/** 移除購買紀錄。**只刪 PurchaseEntry，Transaction 一個欄位都不動。** */
export async function removeEntry(ctx: BookContext, id: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    const before = await tx.purchaseEntry.findFirst({ where: { id, bookId: ctx.book.id } });
    assert(before, "PURCHASE_ENTRY_NOT_FOUND", "找不到這筆購買紀錄");
    await tx.purchaseEntry.delete({ where: { id } });
    await auditIn(tx, ctx, "DELETE", "PurchaseEntry", id, before, null);
    return { transactionId: before.transactionId };
  });
}

/**
 * 原始記帳被作廢之後，把購買紀錄轉成手動的。
 *
 * 把交易的 title / occurredAt / amount **複製進 PurchaseEntry 自己的欄位**，
 * 再把 transactionId 設成 null。groupId / tagId / ownerId / note 原封不動。
 * 轉完之後它就是一筆普通的手動紀錄：重新計入統計，三個欄位也可以編輯了。
 */
export async function convertToManual(ctx: BookContext, id: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.purchaseEntry.findFirst({
      where: { id, bookId: ctx.book.id },
      include: { transaction: { select: { title: true, occurredAt: true, amount: true, deletedAt: true } } },
    });
    assert(before, "PURCHASE_ENTRY_NOT_FOUND", "找不到這筆購買紀錄");
    assert(before.transaction, "PURCHASE_NOT_FROM_TX", "這筆本來就是手動紀錄，不用轉");
    const t = before.transaction;
    const updated = await tx.purchaseEntry.update({
      where: { id },
      data: {
        transactionId: null,
        title: t.title ?? "(沒有名稱)",
        occurredAt: t.occurredAt,
        amount: t.amount,
        updatedById: ctx.me.userId,
      },
    });
    await auditIn(tx, ctx, "UPDATE", "PurchaseEntry", id, { transactionId: before.transactionId }, { convertedToManual: true, title: updated.title, amount: updated.amount });
    return updated;
  });
}

/**
 * 記帳存檔後的自動判斷。
 *
 * **只判斷作品與角色，歸屬一律預設共同（null）**——付款人與購買歸屬是兩回事，
 * 小艾刷卡買給阿本的公仔，payer 是小艾、歸屬是阿本，不可以互相推定。
 * 已經加入過的交易不重複處理。
 */
export async function autoAttach(ctx: BookContext, transactionId: string, client: Client = prisma) {
  const t = await client.transaction.findFirst({
    where: { id: transactionId, bookId: ctx.book.id, type: "EXPENSE" },
    select: { id: true, title: true, merchant: true, note: true },
  });
  if (!t) return null;
  const exists = await client.purchaseEntry.findUnique({ where: { transactionId } });
  if (exists) return null;
  const hit = await detect(ctx, t, client);
  if (!hit) return null;
  const entry = await prisma.purchaseEntry.create({
    data: {
      bookId: ctx.book.id, groupId: hit.groupId, tagId: hit.tagId,
      ownerId: null, // 一律共同，不從付款人猜
      transactionId, createdById: ctx.me.userId, updatedById: ctx.me.userId,
    },
  });
  await auditIn(prisma, ctx, "CREATE", "PurchaseEntry", entry.id, null, { auto: true, word: hit.word, transactionId });
  return entry;
}

/** 記帳表單／Toast 要用的選單資料。 */
export async function optionsForForm(ctx: BookContext) {
  const groups = await prisma.purchaseGroup.findMany({
    where: { bookId: ctx.book.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { tags: { orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] } },
  });
  return groups.map((g) => ({
    id: g.id, name: g.name, icon: g.icon,
    tags: g.tags.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault })),
  }));
}

export { normalizeKeyword };
