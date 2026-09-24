/**
 * 帳戶間轉帳的純規則（無資料庫相依）。
 *
 * 轉帳只是把錢從一個帳戶搬到另一個帳戶：不算收入、不算支出、不影響誰欠誰、不影響分帳。
 * 轉出的限制是「可自由使用金額」＝ 帳戶餘額 − 已指定給基金的金額，
 * 這樣基金指定的金額永遠都有實際的錢對應得到（不會把基金的錢轉走）。
 */
import { formatMoney, MAX_AMOUNT } from "../../lib/money";
import { assert, DomainError } from "./errors";

export interface TransferAccount {
  id: string;
  name: string;
  /** 信用卡：餘額是負的（未繳金額），不能當轉出帳戶 */
  isCard: boolean;
  /** 目前餘額 */
  balance: number;
  /** 已指定給基金的金額 */
  earmarked: number;
}

/** 可自由使用金額 = 餘額 − 已指定給基金。 */
export function freeAmount(a: { balance: number; earmarked: number }): number {
  return a.balance - a.earmarked;
}

/** 轉帳前的檢查；不合法時丟出帶有清楚訊息的 DomainError。 */
export function assertTransferable(from: TransferAccount, to: TransferAccount, amount: number): void {
  assert(Number.isSafeInteger(amount) && amount > 0, "TX_AMOUNT", "請輸入大於 0 的金額");
  assert(amount <= MAX_AMOUNT, "TX_AMOUNT", "金額太大");
  assert(from.id !== to.id, "TRANSFER_SAME", "轉出與轉入帳戶不能相同");
  assert(
    !from.isCard,
    "TRANSFER_FROM_CARD",
    `「${from.name}」是信用卡，不能當轉出帳戶。要繳卡費請從現金或銀行帳戶轉入信用卡。`,
  );
  const free = freeAmount(from);
  if (amount <= free) return;
  if (amount > from.balance) {
    throw new DomainError(
      "TRANSFER_OVER_BALANCE",
      `「${from.name}」目前餘額只有 ${formatMoney(Math.max(0, from.balance))}，不夠轉出 ${formatMoney(amount)}。`,
    );
  }
  throw new DomainError(
    "TRANSFER_OVER_FREE",
    `「${from.name}」餘額 ${formatMoney(from.balance)} 之中有 ${formatMoney(from.earmarked)} 已經指定給基金，` +
      `可自由使用只剩 ${formatMoney(Math.max(0, free))}，不夠轉出 ${formatMoney(amount)}。請先從基金取回，或改用其他帳戶。`,
  );
}

/**
 * 不變式：每個帳戶「已指定給基金的金額」都要有實際的錢對應得到（餘額 ≥ 已指定）。
 * 任何會讓帳戶餘額變少的動作（轉帳、支出、改金額、刪除收入、作廢轉帳）之後都要通過這個檢查，
 * 否則基金會出現「帳上有、實際沒有」的金額。沒有指定給基金的帳戶不受影響（餘額可以是負的）。
 */
export function assertEarmarkBacked(accounts: TransferAccount[], action: "cancel" | "spend" = "cancel"): void {
  for (const a of accounts) {
    if (a.earmarked <= 0) continue;
    if (freeAmount(a) < 0) {
      const state = `「${a.name}」的餘額 ${formatMoney(a.balance)} 會少於已指定給基金的 ${formatMoney(a.earmarked)}`;
      throw new DomainError(
        "TRANSFER_EARMARK_BACKING",
        action === "cancel"
          ? `作廢後${state}。請先從基金取回這筆錢，再作廢這筆紀錄。`
          : `這樣${state}。基金指定的錢不能拿去做別的用途：請改用其他帳戶付款、把這筆標記為基金支出，或先從基金取回。`,
      );
    }
  }
}
