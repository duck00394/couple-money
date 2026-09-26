import { prisma } from "./db";
import type { AccountType } from "@prisma/client";
import { toDateKey } from "@/lib/dates";
import type { BookContext } from "./services/books";
import { ACCOUNT_TYPE_ICON, listAccounts, listCategories } from "./services/ledger";
import { allocationsForForm, listFunds } from "./services/funds";
import { rankTags } from "./domain/tags";

/** 帳戶選單顯示名稱（與記帳表單一致）：我的・玉山卡、共同帳戶。下拉選單是純文字，圖示在列表才顯示。 */
export function accountOptionLabel(ctx: BookContext, a: { name: string; type: AccountType; ownerId: string | null }) {
  const owner = a.ownerId === null ? "" : a.ownerId === ctx.me.userId ? "我的・" : `${ctx.members.find((m) => m.userId === a.ownerId)?.nickname ?? ""}・`;
  return `${owner}${a.name}`;
}

/**
 * 記帳表單需要的選項（帳戶、分類、成員）。
 * `keepCategoryId`：編輯舊紀錄時，那筆原本的分類即使已停用也要留在選單裡。
 */
export async function loadTxFormOptions(ctx: BookContext, opts: { keepCategoryId?: string | null } = {}) {
  const [accounts, categories, funds, allocations, tags] = await Promise.all([listAccounts(ctx), listCategories(ctx, { keepId: opts.keepCategoryId }), listFunds(ctx, { includeArchived: true }), allocationsForForm(ctx), recentTags(ctx)]);
  return {
    me: { userId: ctx.me.userId, nickname: ctx.me.nickname },
    partner: ctx.partner ? { userId: ctx.partner.userId, nickname: ctx.partner.nickname } : null,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, ownerId: a.ownerId, icon: ACCOUNT_TYPE_ICON[a.type] })),
    categories: categories.map((c) => ({ id: c.id, name: `${c.name}${c.isArchived ? "（已停用）" : ""}`, icon: c.icon, kind: c.kind })),
    today: toDateKey(new Date()),
    funds: funds.map((f) => ({ id: f.id, name: `${f.name}${f.isArchived ? "（封存）" : ""}`, balance: f.balance, isArchived: f.isArchived })),
    /** 每個基金在各帳戶的指定額度（基金支出要動用哪個帳戶的額度） */
    allocations,
    /** 最近用過的標籤，直接點就能加，不用重打 */
    tagOptions: tags,
  };
}

/**
 * 「最近常用」：從既有的記帳紀錄自己歸納出來，不建任何新資料表、不做模板管理。
 *
 * 一個組合 = 相同的（名稱／分類／付款帳戶／分帳方式）。
 * 依「用過幾次」排序，取前幾個。金額不帶入 —— 每次花的錢都不一樣，
 * 帶錯金額比沒帶更危險，所以只帶「每次都要重選一遍」的那些欄位。
 */
export async function recentPresets(ctx: BookContext, take = 5) {
  const rows = await prisma.transaction.findMany({
    where: { bookId: ctx.book.id, deletedAt: null, status: "POSTED", type: "EXPENSE" },
    select: { title: true, categoryId: true, splitRule: true, payments: { select: { accountId: true } } },
    orderBy: { occurredAt: "desc" },
    take: 120, // 只看最近這些，不用掃整本帳
  });

  const byKey = new Map<string, { title: string; categoryId: string | null; accountId: string; splitRule: unknown; count: number }>();
  for (const r of rows) {
    const title = (r.title ?? "").trim();
    const accountId = r.payments[0]?.accountId;
    if (!title || !accountId) continue; // 沒名字的組合沒辦法讓人認出來
    const k = `${title}|${r.categoryId ?? ""}|${accountId}`;
    const hit = byKey.get(k);
    if (hit) hit.count++;
    else byKey.set(k, { title, categoryId: r.categoryId, accountId, splitRule: r.splitRule, count: 1 });
  }

  return [...byKey.values()]
    .filter((p) => p.count >= 2) // 只出現過一次的不算「常用」
    .sort((a, b) => b.count - a.count)
    .slice(0, take);
}

/**
 * 「最近用過的標籤」：掃最近幾筆有標籤的記帳，歸納成可以直接點的 chip。
 *
 * 標籤本來就有 Tag / TransactionTag 兩張表，這裡**不新增任何資料**，
 * 也不做標籤管理頁；只掃已存在的紀錄，所以交易被刪掉之後，
 * 沒有任何紀錄在用的標籤會自己從快選裡消失。
 */
export async function recentTags(ctx: BookContext, take = 12): Promise<string[]> {
  const rows = await prisma.transaction.findMany({
    where: { bookId: ctx.book.id, deletedAt: null, status: "POSTED", tags: { some: {} } },
    select: { tags: { select: { tag: { select: { name: true } } } } },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 200, // 只看最近這些，不用掃整本帳
  });
  return rankTags(rows.map((r) => ({ tags: r.tags.map((t) => t.tag.name) })), take);
}
