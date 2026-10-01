/**
 * 購買紀錄的純邏輯（不碰資料庫）。
 *
 * 購買紀錄回答的是「我們到底買了什麼、花了多少」，**不是財務紀錄**：
 * 這裡算出來的任何數字都只給購買紀錄自己的畫面用，不會流進餘額、欠款、分帳、
 * 基金、預算或統計。那些推導值只吃 TransactionPayment 與 TransactionSplit，
 * 而購買紀錄一筆都不產生。
 *
 * 三個維度彼此獨立，不要互相推定：
 *   作品（group）  ── 第一層入口
 *   歸屬（owner）  ── 這東西是誰的：null = 共同
 *   角色（tag）    ── 作品內的分類
 */
import { MAX_AMOUNT } from "@/lib/money";
import { assert } from "./errors";

/* ───────────────────────── 歸屬（共同／A／B） ───────────────────────── */

/**
 * 表單層用的「共同」哨兵值。
 *
 * 沿用 PreorderForms 既有的慣例：畫面上用 "JOINT"，寫進資料庫前轉成 null。
 * 不用 nullable 以外的做法是因為 PurchaseEntry 沒有任何牽涉 owner 的 unique 約束，
 * 所以 Budget.subjectKey 那種 sentinel 的理由（Postgres 把多個 NULL 視為相異）在這裡不成立。
 */
export const JOINT = "JOINT";

/** 表單值 → 資料庫值。"JOINT"、空字串都是共同。 */
export const toOwnerId = (v: string | null | undefined): string | null => (!v || v === JOINT ? null : v);

/** 資料庫值 → 表單值。 */
export const toOwnerValue = (ownerId: string | null): string => ownerId ?? JOINT;

/** 歸屬的顯示名稱。member 查不到（成員離開）時退回「共同」的說法，不讓畫面出現空白。 */
export function ownerLabel(ownerId: string | null, members: Array<{ userId: string; nickname: string }>): string {
  if (!ownerId) return "共同";
  return members.find((m) => m.userId === ownerId)?.nickname ?? "已離開的成員";
}

/**
 * 歸屬篩選 → Prisma where 片段。
 *
 * 三種狀態要分清楚：
 *   undefined / ""  → 不加條件（歸屬的「全部」＝共同 + A + B）
 *   "JOINT"         → ownerId: null（只看共同）
 *   userId          → ownerId: userId
 */
export function ownerWhere(filter: string | null | undefined): { ownerId?: string | null } {
  if (!filter) return {};
  return { ownerId: filter === JOINT ? null : filter };
}

/* ───────────────────────── 名稱與金額 ───────────────────────── */

export function assertGroupName(name: string): string {
  const v = name.trim();
  assert(v.length >= 1 && v.length <= 20, "PURCHASE_GROUP_NAME", "作品名稱需要 1～20 個字");
  return v;
}

export function assertTagName(name: string): string {
  const v = name.trim();
  assert(v.length >= 1 && v.length <= 20, "PURCHASE_TAG_NAME", "角色名稱需要 1～20 個字");
  return v;
}

export function assertEntryTitle(title: string): string {
  const v = title.trim();
  assert(v.length >= 1 && v.length <= 50, "PURCHASE_TITLE", "品項名稱需要 1～50 個字");
  return v;
}

export function assertEntryAmount(amount: number): number {
  assert(
    Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_AMOUNT,
    "PURCHASE_AMOUNT",
    "請輸入正確的金額",
  );
  return amount;
}

export function assertEntryNote(note: string): string {
  const v = note.trim();
  assert(v.length <= 200, "PURCHASE_NOTE", "備註最多 200 個字");
  return v;
}

/** 名稱比對用的 key：忽略大小寫與前後空白，用來擋同名。 */
export const nameKey = (s: string) => s.trim().toLowerCase();

/* ───────────────────────── 關鍵字比對 ───────────────────────── */

/**
 * 關鍵字的正規化：小寫、去空白、全形英數轉半形。
 * 「Chiikawa」「ｃｈｉｉｋａｗａ」「chiikawa 」比對起來要是同一個字。
 */
export function normalizeKeyword(raw: string): string {
  return raw
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function assertKeyword(raw: string): string {
  const v = normalizeKeyword(raw);
  assert(v.length >= 1 && v.length <= 30, "PURCHASE_KEYWORD", "關鍵字需要 1～30 個字");
  return v;
}

/** 一筆交易拿來比對的文字：名稱 + 店家 + 備註。金額與分類不參與。 */
export function matchText(parts: { title?: string | null; merchant?: string | null; note?: string | null }): string {
  return normalizeKeyword([parts.title ?? "", parts.merchant ?? "", parts.note ?? ""].join(" "));
}

export interface KeywordRule {
  word: string;
  groupId: string;
  /** null = 作品關鍵字，命中後落到該作品的預設角色 */
  tagId: string | null;
}

export interface KeywordHit {
  groupId: string;
  /** null = 沒對到角色，交給呼叫端換成該作品的預設角色 */
  tagId: string | null;
  /** 命中的那個關鍵字，拿來給使用者看「為什麼會抓到」 */
  word: string;
  /** true = 只對到作品、沒對到角色 */
  fallback: boolean;
}

/**
 * 關鍵字比對。**只判斷作品與角色，永遠不判斷歸屬。**
 *
 * 規則：
 *   1. 先看角色關鍵字，命中就用它
 *   2. 只命中作品關鍵字 → 回傳 tagId = null，由呼叫端換成該作品的預設角色
 *   3. 同時命中多個 → 用比較長的那個關鍵字（愈長愈明確）；一樣長就用先建立的
 *   4. 都沒命中 → null，畫面上不提示
 */
export function matchKeywords(text: string, rules: KeywordRule[]): KeywordHit | null {
  const hits = rules.filter((r) => r.word.length > 0 && text.includes(r.word));
  if (hits.length === 0) return null;
  // 角色關鍵字優先；同一級距裡比關鍵字長度；再一樣就維持傳入順序（建立順序）
  const best = hits.reduce((a, b) => {
    const aRole = a.tagId !== null ? 1 : 0;
    const bRole = b.tagId !== null ? 1 : 0;
    if (aRole !== bRole) return aRole > bRole ? a : b;
    return b.word.length > a.word.length ? b : a;
  });
  return { groupId: best.groupId, tagId: best.tagId, word: best.word, fallback: best.tagId === null };
}

/* ───────────────────────── 金額與件數 ───────────────────────── */

/**
 * 一筆購買紀錄在畫面上的金額與日期。
 *
 * transactionId 有值時，金額與日期**一律讀交易的**，本表不另存一份，
 * 所以不可能出現「交易 $250、購買紀錄 $200」。
 */
export interface EntrySource {
  title: string | null;
  occurredAt: Date | null;
  amount: number | null;
  transaction: { title: string | null; occurredAt: Date; amount: number; deletedAt: Date | null } | null;
}

export interface EntryValue {
  title: string;
  occurredAt: Date;
  amount: number;
  /** 原始記帳被作廢了：不計入件數與金額，但紀錄仍然留著 */
  voided: boolean;
  /** 有沒有對應的記帳。false = 手動的歷史購買，金額與日期可以編輯 */
  fromTransaction: boolean;
}

export function entryValue(e: EntrySource): EntryValue {
  if (e.transaction) {
    return {
      title: e.transaction.title ?? "(沒有名稱)",
      occurredAt: e.transaction.occurredAt,
      amount: e.transaction.amount,
      voided: e.transaction.deletedAt !== null,
      fromTransaction: true,
    };
  }
  return {
    title: e.title ?? "(沒有名稱)",
    occurredAt: e.occurredAt ?? new Date(0),
    amount: e.amount ?? 0,
    voided: false,
    fromTransaction: false,
  };
}

export interface PurchaseTotals {
  count: number;
  amount: number;
}

/**
 * 件數與金額。**原始記帳已作廢的一律不算**——那筆錢沒有真的花出去。
 * 這是全專案唯一一份「購買紀錄怎麼加總」的定義，首頁、作品內頁、篩選後的總計全部用它。
 */
export function totals(values: EntryValue[]): PurchaseTotals {
  const live = values.filter((v) => !v.voided);
  return { count: live.length, amount: live.reduce((a, v) => a + v.amount, 0) };
}
