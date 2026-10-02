/**
 * 從 DemoState 算出畫面要的東西。
 *
 * **每一個數字都走 `src/server/domain/` 的純函式**，不在這裡自己算第二套：
 *   帳戶餘額 → accountBalances（−Σpayment）
 *   誰欠誰   → netPositions / suggestSettlements
 *   收支統計 → totalsFromGroups
 * 這是 Demo 可信的理由：它跟正式模式共用同一份定義，不是一個長得像的假畫面。
 */
import { accountBalances, freeAmount, netPositions, suggestSettlements } from "@/server/domain/balance";
import { INCOME_EXPENSE_TYPES } from "@/server/domain/ledger";
import { ACCOUNT_TYPE_ICON } from "@/lib/accounts";
import { toDateKey } from "@/lib/dates";
import { sum } from "@/lib/money";
import type { BookContext, BookMemberView } from "@/server/services/books";
import type { TxRowItem } from "@/components/TxRow";
import { taskDueOn } from "./engine";
import type { DemoAccount, DemoFund, DemoState, DemoTx } from "./types";
import { DEMO_ME } from "./data";

/* ───────────────────────── 帳本情境 ───────────────────────── */

const member = (u: { id: string; nickname: string; avatarColor: string }, role: string): BookMemberView => ({
  userId: u.id,
  nickname: u.nickname,
  role,
  avatarColor: u.avatarColor,
  avatarUrl: null, // Demo 不上傳圖片，用 avatarColor + 首字
});

/**
 * 造一個 BookContext 給既有元件用。
 *
 * BookContext 只是一個 plain interface（`src/server/services/books.ts`），
 * 所以用 `import type` 取得它不會把 Prisma 帶進瀏覽器 —— 型別在編譯後就消失了。
 */
export function demoCtx(state: DemoState): BookContext {
  const [a, b] = state.users;
  return {
    book: { id: "demo_book", name: "我們的試用帳本", coverEmoji: "🍊", baseCurrency: "TWD", status: "ACTIVE", type: "MAIN", closedAt: null, homeRate: null },
    me: member(a, "OWNER"),
    members: [member(a, "OWNER"), member(b, "PARTNER")],
    partner: member(b, "PARTNER"),
    canWrite: true,
  };
}

/* ───────────────────────── 交易 ───────────────────────── */

/** DemoTx → TxRow 要的形狀。TxRow 的欄位契約寫在 components/TxRow.tsx。 */
export function toTxRow(state: DemoState, tx: DemoTx): TxRowItem {
  const cat = state.categories.find((c) => c.id === tx.categoryId) ?? null;
  const fund = tx.fundId ? state.funds.find((f) => f.id === tx.fundId) ?? null : null;
  const acc = (id: string) => {
    const a = state.accounts.find((x) => x.id === id);
    return { name: a?.name ?? "已刪除的帳戶", ownerId: a?.ownerId ?? null };
  };
  return {
    id: tx.id,
    type: tx.type,
    title: tx.title,
    amount: tx.amount,
    note: tx.note || null,
    sourceType: null,
    currency: tx.currency,
    foreignAmount: tx.foreignAmount,
    category: cat ? { name: cat.name, icon: cat.icon } : null,
    settlement: tx.settlement,
    payments: tx.payments.map((p) => ({ amount: p.amount, account: acc(p.accountId) })),
    splits: tx.splits,
    fundEntry: fund ? { deletedAt: null, fund: { name: fund.name } } : null,
    recurring: null,
    tags: tx.tags.map((name) => ({ tag: { name } })),
  };
}

/** 依日期新到舊排序（同一天的用 id 讓順序可重現）。 */
export function sortedTxs(state: DemoState): DemoTx[] {
  return [...state.txs].sort(
    (a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id),
  );
}

export interface DateGroup {
  key: string;
  items: TxRowItem[];
}

/** 把交易依日期分組（今天的單獨拉出來，其餘照日期往下）。 */
export function feed(state: DemoState, todayKey: string, historyTake = 12) {
  const all = sortedTxs(state);
  const today = all.filter((t) => t.occurredOn === todayKey);
  const history = all.filter((t) => t.occurredOn < todayKey).slice(0, historyTake);
  const groups: DateGroup[] = [];
  for (const tx of history) {
    const last = groups.at(-1);
    const row = toTxRow(state, tx);
    if (last && last.key === tx.occurredOn) last.items.push(row);
    else groups.push({ key: tx.occurredOn, items: [row] });
  }
  return { today: today.map((t) => toTxRow(state, t)), groups, todayCount: today.length };
}

/* ───────────────────────── 餘額與欠款 ───────────────────────── */

/** 跟正式的 getBalances 同一個算法（同一份 domain 函式）。 */
export function balances(state: DemoState) {
  const net = netPositions(state.txs, state.users.map((u) => u.id));
  return { net, accounts: accountBalances(state.txs), debts: suggestSettlements(net) };
}

export interface AccountView {
  id: string;
  name: string;
  type: DemoAccount["type"];
  ownerId: string | null;
  balance: number;
}

/**
 * 帳戶餘額。
 *
 * 刻意**不**在單一帳戶上扣基金：Demo 的基金投入沒有綁定來源帳戶，硬要攤到某個帳戶
 * 會算出「可用 −$5,569」這種看起來像 bug 的數字。基金的扣除放在帳本層級
 * （availableMoney），那才是 freeAmount 真正的定義域。
 */
export function accounts(state: DemoState): AccountView[] {
  const bal = balances(state).accounts;
  return state.accounts.map((a) => ({ ...a, balance: bal.get(a.id) ?? 0 }));
}

/* ───────────────────────── 統計 ───────────────────────── */

export interface MonthSummary {
  label: string;
  expense: number;
  income: number;
  myShare: number;
}

/** 本月收支。退款的分帳本來就是負的，加總會自動沖銷。 */
export function monthSummary(state: DemoState, todayKey: string): MonthSummary {
  const month = todayKey.slice(0, 7);
  const rows = state.txs.filter(
    (t) => INCOME_EXPENSE_TYPES.includes(t.type) && t.occurredOn.startsWith(month),
  );
  const expense = sum(rows.filter((r) => r.type === "EXPENSE").map((r) => r.amount))
    - sum(rows.filter((r) => r.type === "REFUND").map((r) => r.amount));
  const income = sum(rows.filter((r) => r.type === "INCOME").map((r) => r.amount));
  const myShare = sum(
    rows
      .filter((r) => r.type === "EXPENSE" || r.type === "REFUND")
      .map((r) => sum(r.splits.filter((s) => s.userId === DEMO_ME).map((s) => s.amount))),
  );
  const [y, m] = month.split("-");
  return { label: `${y} 年 ${Number(m)} 月`, expense, income, myShare };
}

export interface CategoryStat {
  categoryId: string;
  name: string;
  icon: string;
  amount: number;
  share: number;
}

/** 本月各分類支出，由大到小。 */
export function categoryStats(state: DemoState, todayKey: string): CategoryStat[] {
  const month = todayKey.slice(0, 7);
  const byCat = new Map<string, number>();
  for (const t of state.txs) {
    if (!t.occurredOn.startsWith(month)) continue;
    const dir = t.type === "EXPENSE" ? 1 : t.type === "REFUND" ? -1 : 0;
    if (dir === 0 || !t.categoryId) continue;
    byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + t.amount * dir);
  }
  const total = sum([...byCat.values()].filter((v) => v > 0));
  return [...byCat]
    .filter(([, v]) => v > 0)
    .map(([categoryId, amount]) => {
      const c = state.categories.find((x) => x.id === categoryId);
      return {
        categoryId,
        name: c?.name ?? "未分類",
        icon: c?.icon ?? "tag",
        amount,
        share: total > 0 ? amount / total : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

/** 每個人本月負擔多少（展示「共同 / 我 / 另一半」的差別）。 */
export function burdenByUser(state: DemoState, todayKey: string) {
  const month = todayKey.slice(0, 7);
  return state.users.map((u) => ({
    userId: u.id,
    nickname: u.nickname,
    amount: sum(
      state.txs
        .filter((t) => t.occurredOn.startsWith(month) && (t.type === "EXPENSE" || t.type === "REFUND"))
        .map((t) => sum(t.splits.filter((s) => s.userId === u.id).map((s) => s.amount))),
    ),
  }));
}

/* ───────────────────────── 基金 ───────────────────────── */

export interface FundView extends DemoFund {
  balance: number;
  progress: number;
}

export const fundBalance = (state: DemoState, fundId: string) =>
  sum(state.fundTxs.filter((f) => f.fundId === fundId).map((f) => f.amount));

export const fundTotal = (state: DemoState) =>
  sum(state.funds.filter((f) => !f.isArchived).map((f) => fundBalance(state, f.id)));

export function funds(state: DemoState): FundView[] {
  return state.funds.map((f) => {
    const balance = fundBalance(state, f.id);
    return { ...f, balance, progress: f.targetAmount > 0 ? Math.min(1, balance / f.targetAmount) : 0 };
  });
}

/* ───────────────────────── 任務與獎勵 ───────────────────────── */

export interface TaskCardView {
  id: string;
  name: string;
  icon: string;
  rewardAmount: number;
  /** 共同任務 = null */
  assigneeId: string | null;
  /** 這張卡是誰的那一份 */
  subjectId: string;
  /** 白話的週期說明 */
  scheduleText: string;
  dueToday: boolean;
  doneToday: boolean;
  /** 這個人這個任務累積賺到多少 */
  earned: number;
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 今日任務卡。共同任務會產生兩張卡（我的那份 + 另一半的那份），
 * 跟正式模式 EACH 任務的行為一致。
 */
export function taskCards(state: DemoState, todayKey: string): TaskCardView[] {
  const cards: TaskCardView[] = [];
  for (const t of state.tasks) {
    const subjects = t.assigneeId === null ? state.users.map((u) => u.id) : [t.assigneeId];
    for (const subjectId of subjects) {
      cards.push({
        id: t.id,
        name: t.name,
        icon: t.icon,
        rewardAmount: t.rewardAmount,
        assigneeId: t.assigneeId,
        subjectId,
        scheduleText: t.weekdays.length === 0 ? "每天一次" : `每週 ${t.weekdays.map((d) => WEEK[d]).join("、")}`,
        dueToday: taskDueOn(t, todayKey),
        doneToday: state.checkIns.some(
          (c) => c.taskId === t.id && c.userId === subjectId && c.dateKey === todayKey,
        ),
        earned: sum(
          state.checkIns.filter((c) => c.taskId === t.id && c.userId === subjectId).map((c) => c.rewardAmount),
        ),
      });
    }
  }
  return cards;
}

/** 獎勵：今天賺到多少、累積多少。Demo 不做提領，所以累積就是餘額。 */
export function rewards(state: DemoState, todayKey: string) {
  const forUser = (userId: string) => ({
    today: sum(state.checkIns.filter((c) => c.userId === userId && c.dateKey === todayKey).map((c) => c.rewardAmount)),
    total: sum(state.checkIns.filter((c) => c.userId === userId).map((c) => c.rewardAmount)),
  });
  const mine = forUser(DEMO_ME);
  return {
    mine,
    byUser: new Map(state.users.map((u) => [u.id, forUser(u.id)])),
    todayTotal: sum(state.checkIns.filter((c) => c.dateKey === todayKey).map((c) => c.rewardAmount)),
  };
}

/* ───────────────────────── 預購 ───────────────────────── */

export interface PreorderView {
  id: string;
  name: string;
  seller: string;
  emoji: string;
  expectedOn: string;
  ownerId: string | null;
  paidById: string | null;
  status: string;
  total: number;
  items: Array<{ id: string; name: string; amount: number; ownerId: string | null }>;
  /** 每個人該負擔多少（規則同 v11：共同品項平分，有歸屬的算該人的） */
  dues: Array<{ userId: string; amount: number }>;
}

/**
 * 預購的應付金額。
 *
 * 規則跟正式模式一樣（v11 修掉的那個 bug）：
 *   有任何「指定歸屬」的品項時 → 逐項算，共同品項才平分
 *   全部都是共同品項時        → 整筆平分
 */
export function preorders(state: DemoState): PreorderView[] {
  const ids = state.users.map((u) => u.id);
  return state.preorders.map((p) => {
    const total = sum(p.items.map((i) => i.amount));
    const dues = new Map<string, number>(ids.map((id) => [id, 0]));
    const hasOwned = p.items.some((i) => i.ownerId !== null);
    for (const item of p.items) {
      if (item.ownerId !== null && hasOwned) {
        dues.set(item.ownerId, (dues.get(item.ownerId) ?? 0) + item.amount);
      } else {
        // 共同品項一律平分（分不盡的餘數給第一個人，跟 allocate 的行為一致）
        const each = Math.floor(item.amount / ids.length);
        const rest = item.amount - each * ids.length;
        ids.forEach((id, i) => dues.set(id, (dues.get(id) ?? 0) + each + (i === 0 ? rest : 0)));
      }
    }
    return { ...p, total, dues: [...dues].map(([userId, amount]) => ({ userId, amount })) };
  });
}

export const pendingPreorders = (state: DemoState) => preorders(state).filter((p) => p.status === "PENDING");

/* ───────────────────────── 購買紀錄 ───────────────────────── */

export interface PurchaseGroupView {
  id: string;
  name: string;
  icon: string;
  count: number;
  total: number;
}

export function purchaseGroups(state: DemoState): PurchaseGroupView[] {
  return state.purchaseGroups.map((g) => {
    const rows = state.purchaseEntries.filter((e) => e.groupId === g.id);
    return { ...g, count: rows.length, total: sum(rows.map((e) => e.amount)) };
  });
}

/** 某個作品底下：依商品分類 → 歸屬 → 角色的四層下鑽。 */
export function purchaseDrill(
  state: DemoState,
  groupId: string,
  filter: { categoryId?: string; ownerId?: string | null | undefined; tagId?: string } = {},
) {
  let rows = state.purchaseEntries.filter((e) => e.groupId === groupId);
  if (filter.categoryId) rows = rows.filter((e) => e.categoryId === filter.categoryId);
  if (filter.ownerId !== undefined) rows = rows.filter((e) => e.ownerId === filter.ownerId);
  if (filter.tagId) rows = rows.filter((e) => e.tagId === filter.tagId);
  return rows.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id));
}

export const purchaseTotal = (state: DemoState) => sum(state.purchaseEntries.map((e) => e.amount));

/* ───────────────────────── 首頁彙總 ───────────────────────── */

/**
 * 可自由使用的錢 = 全部帳戶餘額 − 已指定給基金的金額。
 * freeAmount 是 domain 層唯一一份定義，這裡不自己再寫一次減法。
 */
export function availableMoney(state: DemoState) {
  const total = sum(accounts(state).map((a) => a.balance));
  const earmarked = fundTotal(state);
  return { total, earmarked, free: freeAmount(total, earmarked) };
}

export const today = (now = new Date()) => toDateKey(now);

/* ───────────────────────── 記帳表單的選項 ───────────────────────── */

/**
 * 給 `<TransactionForm>` 的 props。
 *
 * 欄位與正式模式的 `loadTxFormOptions()` 對齊，所以同一個表單元件兩邊都能用。
 * 刻意留空的：allocations（Demo 的基金不綁帳戶）、presets 與 tagOptions
 * （那是從既有紀錄歸納出來的便利功能，不是展示重點）、preorders
 * （預購付款會牽動代墊與欠款，Demo 只做到「看得到預購」）。
 */
export function txFormOptions(state: DemoState, todayKey: string) {
  const ctx = demoCtx(state);
  return {
    me: { userId: ctx.me.userId, nickname: ctx.me.nickname },
    partner: ctx.partner ? { userId: ctx.partner.userId, nickname: ctx.partner.nickname } : null,
    accounts: state.accounts
      .filter((a) => a.isActive)
      .map((a) => ({ id: a.id, name: a.name, type: a.type, ownerId: a.ownerId, icon: ACCOUNT_TYPE_ICON[a.type] })),
    categories: state.categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon, kind: c.kind })),
    today: todayKey,
    // V14：試用模式也能切幣別。沒設匯率的幣別不會出現在選單裡。
    baseCurrency: state.baseCurrency,
    rates: state.rates,
    funds: funds(state).map((f) => ({ id: f.id, name: f.name, balance: f.balance, isArchived: f.isArchived })),
    purchaseGroups: state.purchaseGroups.map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      tags: state.purchaseTags.filter((t) => t.groupId === g.id).map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault })),
      categories: state.purchaseCategories
        .filter((c) => c.groupId === g.id)
        .map((c) => ({ id: c.id, name: c.name, isDefault: c.isDefault })),
    })),
  };
}


/** 某一筆交易 → 編輯表單的 initial。只有支出／收入可以編輯。 */
export function txInitial(state: DemoState, id: string) {
  const tx = state.txs.find((t) => t.id === id);
  if (!tx || (tx.type !== "EXPENSE" && tx.type !== "INCOME")) return null;
  // 由 splits 反推分帳規則：Demo 一律用「自訂金額」帶回，數字一定對得上原本那筆
  const dir = tx.type === "EXPENSE" ? 1 : -1;
  return {
    id: tx.id,
    version: 1,
    type: tx.type,
    amount: tx.amount,
    accountId: tx.payments[0]?.accountId ?? "",
    categoryId: tx.categoryId,
    title: tx.title,
    note: tx.note,
    occurredOn: tx.occurredOn,
    split: {
      method: "AMOUNT" as const,
      participants: state.users.map((u) => ({
        userId: u.id,
        value: Math.abs(sum(tx.splits.filter((s) => s.userId === u.id).map((s) => s.amount * dir))),
      })),
    },
    fundId: tx.fundId,
    fundAccountId: null,
    tags: tx.tags,
    currency: tx.currency,
    foreignAmount: tx.foreignAmount,
  };
}
