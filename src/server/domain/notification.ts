/**
 * 最近動態（Phase 3-4 H）的純邏輯：決定「哪些 AuditLog 要變成通知」與「要顯示成什麼字」。
 *
 * 這裡只是 AuditLog 的使用者友善呈現：
 *   - 不產生第二份事件紀錄，也不會回頭影響任何財務計算
 *   - **只挑出白名單欄位**，不把 before／after 原封不動吐給前端
 */

/** 會變成通知的事件（`entityType:action`）。沒列到的一律不顯示。 */
export const NOTIFIABLE: Record<string, { icon: string; text: string }> = {
  // 記帳
  "Transaction:CREATE": { icon: "transaction", text: "新增了一筆" },
  "Transaction:UPDATE": { icon: "pencil", text: "修改了一筆" },
  "Transaction:DELETE": { icon: "trash", text: "作廢了一筆" },
  // 帳戶
  "Account:CREATE": { icon: "credit-card", text: "新增了帳戶" },
  "Account:ADJUST": { icon: "adjust", text: "調整了帳戶餘額" },
  // 收據
  "Attachment:CREATE": { icon: "photo", text: "加了一張收據" },
  "Attachment:DELETE": { icon: "photo", text: "刪掉了一張收據" },
  // 結算
  "Settlement:CREATE": { icon: "settle", text: "結算了" },
  "Settlement:DELETE": { icon: "undo", text: "取消了一筆結算" },
  // 任務與打卡
  "CheckIn:CREATE": { icon: "check-circle", text: "完成了打卡" },
  "CheckIn:UPDATE": { icon: "pencil", text: "修改了打卡" },
  "CheckIn:CANCEL": { icon: "undo", text: "取消了打卡" },
  "CheckIn:APPROVE": { icon: "check-circle", text: "確認了打卡" },
  "CheckIn:REJECT": { icon: "undo", text: "退回了打卡" },
  "Task:CREATE": { icon: "target", text: "新增了任務" },
  "Task:UPDATE": { icon: "pencil", text: "修改了任務" },
  "Task:DELETE": { icon: "trash", text: "刪除了任務" },
  "TaskPenalty:WAIVE": { icon: "heart", text: "免除了一次懲罰" },
  // 基金與目標
  "Fund:CREATE": { icon: "piggy-bank", text: "新增了基金" },
  "Fund:UPDATE": { icon: "pencil", text: "修改了基金" },
  "Fund:DELETE": { icon: "trash", text: "刪除了基金" },
  "Fund:REQUEST_DELETE": { icon: "tag", text: "想刪除基金" },
  "Fund:DELETE_REJECTED": { icon: "lock", text: "拒絕刪除基金" },
  "FundTransaction:CREATE": { icon: "piggy-bank", text: "動了基金的錢" },
  "FundTransaction:DELETE": { icon: "undo", text: "作廢了一筆基金紀錄" },
  "FundTransaction:CANCEL": { icon: "undo", text: "取消了獎金入金" },
  "FundTransaction:REWARD_DEPOSIT": { icon: "banknote", text: "把任務獎金入金了" },
  "Goal:CREATE": { icon: "target", text: "新增了目標" },
  "Goal:UPDATE": { icon: "pencil", text: "修改了目標" },
  "Goal:DELETE": { icon: "trash", text: "刪除了目標" },
  "Goal:REQUEST_DELETE": { icon: "tag", text: "想刪除目標" },
  "Goal:DELETE_REJECTED": { icon: "lock", text: "拒絕刪除目標" },
  // 固定支出
  "RecurringExpense:CREATE": { icon: "calendar-clock", text: "新增了固定支出" },
  "RecurringExpense:UPDATE": { icon: "pencil", text: "修改了固定支出" },
  "RecurringExpense:PAUSE": { icon: "lock", text: "停用了固定支出" },
  "RecurringExpense:RESUME": { icon: "check", text: "重新啟用了固定支出" },
  "RecurringExpense:DELETE": { icon: "trash", text: "刪除了固定支出" },
  // 分類
  "Category:CREATE": { icon: "tag", text: "新增了分類" },
  "Category:UPDATE": { icon: "pencil", text: "改了分類名稱" },
  "Category:ARCHIVE": { icon: "lock", text: "停用了分類" },
  "Category:RESTORE": { icon: "recurring", text: "重新啟用了分類" },
  "Category:DELETE": { icon: "trash", text: "刪除了分類" },
  // 預算
  "Budget:CREATE": { icon: "target", text: "設了預算" },
  "Budget:UPDATE": { icon: "pencil", text: "改了預算" },
  "Budget:ARCHIVE": { icon: "lock", text: "停用了預算" },
  "Budget:RESTORE": { icon: "recurring", text: "重新啟用了預算" },
  "Budget:DELETE": { icon: "trash", text: "刪掉了預算" },
  // 帳本
  "BookMember:JOIN": { icon: "couple", text: "加入了帳本" },
};

/**
 * 刻意排除的事件（列在這裡是為了說明「為什麼不顯示」，避免日後有人以為漏做）：
 *   Transaction:EXPORT        匯出 CSV 是自己的事，不需要通知對方
 *   RecurringExpense:GENERATE 產生記帳時已經有 Transaction:CREATE，會重複
 *   RecurringExpense:SKIP     同上
 *   Task:PENALTY              漏做懲罰是系統自動產生的，actor 是「剛好打開 App 的人」，顯示出來會誤導
 *   Book:CREATE               建立帳本時還只有自己一個人
 */
export const EXCLUDED = ["Transaction:EXPORT", "RecurringExpense:GENERATE", "RecurringExpense:SKIP", "Task:PENALTY", "Book:CREATE"];

export function isNotifiable(entityType: string, action: string): boolean {
  return `${entityType}:${action}` in NOTIFIABLE;
}

/** 交易型別 → 通知裡的說法。 */
const TX_WORD: Record<string, string> = {
  EXPENSE: "支出",
  INCOME: "收入",
  REFUND: "退款",
  TRANSFER: "轉帳",
  SETTLEMENT: "結算",
  OPENING_BALANCE: "期初餘額",
  ADJUSTMENT: "餘額調整",
};

/** 只從 before／after 取出白名單裡的基本型別欄位，其他一律丟掉。 */
function pickNumber(obj: unknown, key: string): number | undefined {
  const v = (obj as Record<string, unknown> | null)?.[key];
  return typeof v === "number" ? v : undefined;
}
function pickString(obj: unknown, key: string): string | undefined {
  const v = (obj as Record<string, unknown> | null)?.[key];
  return typeof v === "string" && v.length > 0 ? v.slice(0, 50) : undefined;
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  createdAt: Date;
  before: unknown;
  after: unknown;
}

/** 由呼叫端一次查好的關聯資料（避免每筆通知再查一次）。 */
export interface LinkedInfo {
  /** 相關實體的名稱（任務標題、基金名稱、帳戶名稱…） */
  name?: string;
  /** 還看得到嗎（已作廢就不給連結） */
  alive?: boolean;
  /** 要連到哪一筆記帳（收據、餘額調整用） */
  transactionId?: string;
  transactionAlive?: boolean;
}

export interface NotificationView {
  id: string;
  icon: string;
  /** 「阿本 新增了一筆支出」 */
  text: string;
  /** 「火鍋・$1,000」；可能是空字串 */
  detail: string;
  at: Date;
  /** 點下去要去哪；沒有可看的目標就是 null */
  href: string | null;
}

/**
 * 一筆 AuditLog → 一則通知。不在白名單就回 null。
 * money 由呼叫端傳入（純函式不依賴格式化設定）。
 */
export function describeAudit(
  row: AuditRow,
  opts: { actorName: string; linked?: LinkedInfo; money: (minor: number) => string },
): NotificationView | null {
  const key = `${row.entityType}:${row.action}`;
  const meta = NOTIFIABLE[key];
  if (!meta) return null;
  const { actorName, linked = {}, money } = opts;
  const parts: string[] = [];
  let text = `${actorName} ${meta.text}`;
  let href: string | null = null;

  switch (row.entityType) {
    case "Transaction": {
      const snap = row.action === "CREATE" ? row.after : row.before;
      const type = pickString(snap, "type") ?? "";
      const word = TX_WORD[type] ?? "紀錄";
      text = `${actorName} ${meta.text}${word}`;
      const title = pickString(snap, "title");
      const amount = pickNumber(snap, "amount");
      if (title) parts.push(title);
      if (amount !== undefined) parts.push(money(amount));
      if (row.action === "UPDATE") {
        const now = pickNumber(row.after, "amount");
        if (amount !== undefined && now !== undefined && now !== amount) parts.push(`→ ${money(now)}`);
      }
      if (linked.alive) href = `/transactions/${row.entityId}`;
      break;
    }
    case "Account": {
      if (row.action === "ADJUST") {
        const delta = pickNumber(row.after, "delta");
        if (linked.name) parts.push(linked.name);
        if (delta !== undefined) parts.push(`${delta > 0 ? "+" : "−"}${money(Math.abs(delta))}`);
        href = linked.transactionAlive && linked.transactionId ? `/transactions/${linked.transactionId}` : "/accounts";
      } else {
        const name = pickString(row.after, "name") ?? linked.name;
        if (name) parts.push(name);
        href = "/accounts";
      }
      break;
    }
    case "Attachment": {
      if (linked.transactionAlive && linked.transactionId) href = `/transactions/${linked.transactionId}`;
      if (linked.name) parts.push(linked.name);
      break;
    }
    case "Settlement": {
      const amount = pickNumber(row.action === "CREATE" ? row.after : row.before, "amount");
      if (amount !== undefined) parts.push(money(amount));
      href = "/settle";
      break;
    }
    case "CheckIn": {
      if (linked.name) parts.push(linked.name);
      if (linked.alive && linked.transactionId) href = `/tasks/${linked.transactionId}`;
      break;
    }
    case "Task":
    case "TaskPenalty": {
      if (linked.name) parts.push(linked.name);
      if (linked.alive) href = `/tasks/${row.entityType === "Task" ? row.entityId : linked.transactionId ?? ""}`;
      break;
    }
    case "Fund":
    case "FundTransaction": {
      if (linked.name) parts.push(linked.name);
      const amount = pickNumber(row.action === "CREATE" || row.action === "REWARD_DEPOSIT" ? row.after : row.before, "amount");
      if (amount !== undefined) parts.push(money(Math.abs(amount)));
      if (linked.alive && linked.transactionId) href = `/funds/${linked.transactionId}`;
      break;
    }
    case "Goal": {
      if (linked.name) parts.push(linked.name);
      if (linked.alive) href = `/goals/${row.entityId}`;
      break;
    }
    case "RecurringExpense": {
      if (linked.name) parts.push(linked.name);
      if (linked.alive) href = `/recurring/${row.entityId}`;
      break;
    }
    case "Budget": {
      const name = pickString(row.after, "name") ?? pickString(row.before, "name");
      const month = pickString(row.after, "month") ?? pickString(row.before, "month");
      const amount = pickNumber(row.after, "amount") ?? pickNumber(row.before, "amount");
      if (month) parts.push(month);
      if (name) parts.push(name);
      if (amount !== undefined) parts.push(money(amount));
      href = month ? `/budgets?m=${month}` : "/budgets";
      break;
    }
    case "Category": {
      const name = pickString(row.after, "name") ?? pickString(row.before, "name") ?? linked.name;
      if (name) parts.push(name);
      href = "/categories";
      break;
    }
    case "BookMember": {
      href = "/more";
      break;
    }
  }

  return { id: row.id, icon: meta.icon, text, detail: parts.join("・"), at: row.createdAt, href };
}

/** 依帳本時區的日期分組標題。 */
export function groupLabel(dateKey: string, todayKey: string, yesterdayKey: string): string {
  if (dateKey === todayKey) return "今天";
  if (dateKey === yesterdayKey) return "昨天";
  return "更早";
}
