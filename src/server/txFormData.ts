import type { AccountType } from "@prisma/client";
import { toDateKey } from "@/lib/dates";
import type { BookContext } from "./services/books";
import { ACCOUNT_TYPE_ICON, listAccounts, listCategories } from "./services/ledger";
import { allocationsForForm, listFunds } from "./services/funds";

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
  const [accounts, categories, funds, allocations] = await Promise.all([listAccounts(ctx), listCategories(ctx, { keepId: opts.keepCategoryId }), listFunds(ctx, { includeArchived: true }), allocationsForForm(ctx)]);
  return {
    me: { userId: ctx.me.userId, nickname: ctx.me.nickname },
    partner: ctx.partner ? { userId: ctx.partner.userId, nickname: ctx.partner.nickname } : null,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, ownerId: a.ownerId, icon: ACCOUNT_TYPE_ICON[a.type] })),
    categories: categories.map((c) => ({ id: c.id, name: `${c.name}${c.isArchived ? "（已停用）" : ""}`, icon: c.icon, kind: c.kind })),
    today: toDateKey(new Date()),
    funds: funds.map((f) => ({ id: f.id, name: `${f.name}${f.isArchived ? "（封存）" : ""}`, balance: f.balance, isArchived: f.isArchived })),
    /** 每個基金在各帳戶的指定額度（基金支出要動用哪個帳戶的額度） */
    allocations,
  };
}
