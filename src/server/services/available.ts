/**
 * 首頁「可以花的錢」＝ 現在真的可以刷下去、不會動到已經有歸屬的錢。
 *
 * 注意跟帳戶頁的「可自由使用」不是同一個數字：那個是「帳戶餘額 − 已指定給基金」，
 * 是基金投入的上限；這裡還要再扣掉預購待結，所以畫面上不用同一個詞，免得對不起來。
 *
 *   帳戶可用   非信用卡帳戶的餘額加總（信用卡是負債，不是可以花的錢）
 * − 基金已指定 已經指定給基金的錢（帳戶裡還在，但已經有用途）
 * − 預購待結   已經下訂、還沒付的那部分
 * = 可自由使用
 *
 * 刻意**不扣預算**：預算是「打算花多少」的提醒，不是已經發生或已經承諾的支出，
 * 扣掉會讓同一筆錢被算兩次（先被預算扣、實際花的時候又被扣一次）。
 *
 * 也不會 double count：預購待結款還沒有任何 Transaction，所以它不在帳戶餘額裡；
 * 一旦真的付款，那筆錢會從「待結」消失、同時從帳戶餘額扣掉，兩邊剛好交棒。
 */
import { prisma } from "../db";
import { earmarkedByAccount } from "./funds";
import { listAccounts } from "./ledger";
import { pendingPreorders } from "./preorders";
import type { BookContext } from "./books";

export interface Available {
  /** 非信用卡帳戶的餘額加總 */
  accounts: number;
  /** 已經指定給基金的（只算還在用的帳戶） */
  earmarked: number;
  /** 預購還沒付的 */
  preorder: number;
  /** 可自由使用（可能是負的，代表已經超支） */
  free: number;
}

export async function availableMoney(ctx: BookContext, opts: { today?: string } = {}): Promise<Available> {
  const [accounts, earmarkedMap, preorders] = await Promise.all([
    listAccounts(ctx),
    earmarkedByAccount(prisma, ctx.book.id),
    pendingPreorders(ctx, opts),
  ]);
  const usable = accounts.filter((a) => a.type !== "CREDIT_CARD");
  const total = usable.reduce((a, x) => a + x.balance, 0);
  const earmarked = usable.reduce((a, x) => a + (earmarkedMap.get(x.id) ?? 0), 0);
  return {
    accounts: total,
    earmarked,
    preorder: preorders.remaining,
    free: total - earmarked - preorders.remaining,
  };
}
