/**
 * 試用模式（Demo）的資料形狀。
 *
 * **刻意不使用 Prisma 的型別。** Demo 從頭到尾不碰 Prisma、不碰 PostgreSQL，
 * 所以這裡的 row 只保留畫面真正會用到的欄位，不去背 bookId / createdAt / deletedAt 這些
 * 只有資料庫才需要的東西。
 *
 * 唯一共用的是 `src/server/domain/` 的**純函式**（餘額、分帳、欠款、統計⋯⋯）。
 * 那一層沒有任何 I/O，可以直接在瀏覽器裡跑 —— 所以 Demo 不是「另寫一套假的算法」，
 * 而是同一顆引擎換一個儲存體。
 */
import type { SplitRule } from "@/server/domain/split";
import type { TxType } from "@/server/domain/ledger";

export interface DemoUser {
  id: string;
  nickname: string;
  avatarColor: string;
}

export interface DemoAccount {
  id: string;
  name: string;
  type: "CASH" | "BANK" | "CREDIT_CARD" | "E_WALLET" | "JOINT" | "OTHER";
  /** null = 共同帳戶 */
  ownerId: string | null;
  isActive: boolean;
}

export interface DemoCategory {
  id: string;
  kind: "EXPENSE" | "INCOME";
  name: string;
  icon: string;
}

export interface DemoPayment {
  accountId: string;
  /** 跟著帳戶的 ownerId；null = 共同帳戶 */
  userId: string | null;
  amount: number;
}

export interface DemoSplit {
  userId: string;
  amount: number;
}

export interface DemoTx {
  id: string;
  type: TxType;
  title: string;
  amount: number;
  /** 日期字串（YYYY-MM-DD），Demo 不處理時區細節 */
  occurredOn: string;
  categoryId: string | null;
  note: string;
  payments: DemoPayment[];
  splits: DemoSplit[];
  /** 結算專用 */
  settlement: { fromUserId: string; toUserId: string } | null;
  /** V14：原始幣別。等於本位幣時就是一般的本國消費。 */
  currency: string;
  /** V14：原幣金額（最小單位）。null = 本位幣，沒有換算。 */
  foreignAmount: number | null;
  /** V14：建立當下鎖定的匯率。改設定不會回頭動它。 */
  rateForeignUnits: number | null;
  rateBaseMinor: number | null;
  /** 基金投入專用 */
  fundId: string | null;
  tags: string[];
}

export interface DemoFund {
  id: string;
  name: string;
  icon: string;
  targetAmount: number;
  isArchived: boolean;
}

export interface DemoFundTx {
  id: string;
  fundId: string;
  /** 正數 = 投入，負數 = 動用 */
  amount: number;
  occurredOn: string;
  note: string;
}

export interface DemoTask {
  id: string;
  name: string;
  icon: string;
  /** null = 共同任務（兩個人都要做） */
  assigneeId: string | null;
  rewardAmount: number;
  /** 每週哪幾天（0 = 週日）；空陣列 = 每天 */
  weekdays: number[];
}

export interface DemoCheckIn {
  id: string;
  taskId: string;
  userId: string;
  dateKey: string;
  rewardAmount: number;
}

export interface DemoPreorderItem {
  id: string;
  name: string;
  amount: number;
  /** null = 共同 */
  ownerId: string | null;
}

export interface DemoPreorder {
  id: string;
  name: string;
  seller: string;
  emoji: string;
  expectedOn: string;
  /** null = 共同 */
  ownerId: string | null;
  /** 誰先代墊的 */
  paidById: string | null;
  items: DemoPreorderItem[];
  status: "PENDING" | "ARRIVED";
}

export interface DemoPurchaseGroup {
  id: string;
  name: string;
  icon: string;
}

export interface DemoPurchaseTag {
  id: string;
  groupId: string;
  name: string;
  isDefault: boolean;
}

export interface DemoPurchaseCategory {
  id: string;
  groupId: string;
  name: string;
  isDefault: boolean;
}

export interface DemoPurchaseEntry {
  id: string;
  groupId: string;
  categoryId: string;
  tagId: string;
  /** null = 共同 */
  ownerId: string | null;
  title: string;
  amount: number;
  occurredOn: string;
  note: string;
  /** 連到記帳的那一筆；Demo 裡只用來顯示「來自記帳」 */
  transactionId: string | null;
}

/** Demo 的完整狀態。只存在記憶體裡，重新整理就回到預設資料。 */
export interface DemoState {
  users: DemoUser[];
  accounts: DemoAccount[];
  categories: DemoCategory[];
  txs: DemoTx[];
  funds: DemoFund[];
  fundTxs: DemoFundTx[];
  tasks: DemoTask[];
  checkIns: DemoCheckIn[];
  preorders: DemoPreorder[];
  purchaseGroups: DemoPurchaseGroup[];
  purchaseTags: DemoPurchaseTag[];
  purchaseCategories: DemoPurchaseCategory[];
  purchaseEntries: DemoPurchaseEntry[];
  /** V14：帳本本位幣與自訂匯率 */
  baseCurrency: string;
  rates: Array<{ currency: string; foreignUnits: number; baseMinor: number }>;
  /** 流水號，讓產生的 id 可重現（Demo 不需要 cuid） */
  seq: number;
}

/* ───────────────────────── 操作 ───────────────────────── */

/**
 * Demo 能做的所有變更。
 *
 * 預設資料本身也是用這些操作「跑」出來的（見 data.ts），所以 seed 走的是跟使用者
 * 一模一樣的路徑 —— 不會出現「預設資料看起來正常但自己新增就壞掉」。
 */
export type DemoOp =
  | { kind: "tx.add"; input: TxInput }
  | { kind: "tx.update"; id: string; input: TxInput }
  | { kind: "tx.delete"; id: string }
  | { kind: "account.add"; id?: string; name: string; type: DemoAccount["type"]; ownerId: string | null }
  | { kind: "account.opening"; accountId: string; amount: number; occurredOn: string }
  | { kind: "fund.add"; id?: string; name: string; icon: string; targetAmount: number }
  | { kind: "fund.deposit"; fundId: string; amount: number; occurredOn: string; note?: string }
  | { kind: "task.add"; id?: string; name: string; icon: string; assigneeId: string | null; rewardAmount: number; weekdays: number[] }
  | { kind: "task.checkIn"; taskId: string; userId: string; dateKey: string }
  | { kind: "task.undoCheckIn"; taskId: string; userId: string; dateKey: string }
  | { kind: "settle"; fromUserId: string; toUserId: string; amount: number; occurredOn: string; note?: string }
  | { kind: "preorder.add"; input: Omit<DemoPreorder, "id" | "items"> & { items: Array<Omit<DemoPreorderItem, "id">> } }
  | { kind: "purchase.add"; input: Omit<DemoPurchaseEntry, "id"> }
  | { kind: "purchase.remove"; id: string }
  | { kind: "rate.set"; currency: string; foreignUnits: number; baseMinor: number };

/** 記帳的輸入。欄位名稱與正式的 TransactionInput 對齊，表單才能共用同一份 FormData 契約。 */
export interface TxInput {
  type: Extract<TxType, "EXPENSE" | "INCOME" | "REFUND">;
  title: string;
  amount: number;
  occurredOn: string;
  categoryId: string | null;
  note: string;
  /** 付款（收款）帳戶與金額 */
  payers: Array<{ accountId: string; amount: number }>;
  rule: SplitRule;
  fundId?: string | null;
  tags?: string[];
  /** V14：原始幣別。不填 = 本位幣。填外幣時 amount 會被忽略並由匯率重算。 */
  currency?: string | null;
  /** V14：原幣金額（最小單位）。 */
  foreignAmount?: number | null;
}
