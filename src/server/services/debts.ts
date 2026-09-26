/**
 * 逐筆欠款的讀取層。
 *
 * **完全沒有第二套帳務核心**：欠款總額仍然由既有的 `getBalances()` /
 * `netPositions()` 決定，還款仍然走既有的 `settle()`。這裡只是把同一批交易
 * 交給 `buildDebtItems()` 推導出「逐筆欠了多少、被沖銷多少、還剩多少」，
 * 好讓畫面可以逐筆呈現與勾選。不寫入任何東西。
 */
import { prisma } from "../db";
import { DEBT_TYPES } from "../domain/ledger";
import { buildDebtItems, type DebtItemsView } from "../domain/debt-items";
import { toDateKey } from "@/lib/dates";
import { toIconKey } from "@/lib/icons";
import type { BookContext } from "./books";

const TYPE_TITLE: Record<string, string> = {
  EXPENSE: "消費",
  INCOME: "收入",
  REFUND: "退款",
  SETTLEMENT: "結算",
};

/** 畫面上要一眼看得出這筆是什麼；退款特別標出來，不然只看到店名會以為是消費。 */
function label(type: string, title: string | null, category?: string): string {
  const base = title?.trim() || category || TYPE_TITLE[type] || "紀錄";
  return type === "REFUND" && !base.startsWith("退款") ? `退款：${base}` : base;
}

/** 我目前欠對方的逐筆明細（由舊到新）。沒有欠款時 items 會是空的。 */
export async function myDebtItems(ctx: BookContext, meId = ctx.me.userId): Promise<DebtItemsView> {
  const rows = await prisma.transaction.findMany({
    where: { bookId: ctx.book.id, deletedAt: null, status: "POSTED", type: { in: [...DEBT_TYPES] } },
    select: {
      id: true,
      type: true,
      occurredAt: true,
      title: true,
      amount: true,
      category: { select: { name: true, icon: true } },
      payments: { select: { accountId: true, userId: true, amount: true } },
      splits: { select: { userId: true, amount: true } },
    },
    /**
     * FIFO 走的是**記錄順序**（createdAt），不是交易日期。
     *
     * 只填日期的記帳一律存成當地中午，所以「今天下午 3 點結算、接著再記一筆今天的午餐」
     * 用日期排會變成午餐排在結算前面，那筆結算就會被算成付了還沒記的午餐。
     * 用記錄順序就不會有這個問題：結算一定在它結清的那些帳之後，
     * 補記的舊帳也不會被更早的結算吃掉。畫面上仍然顯示各自的日期。
     */
    orderBy: [{ createdAt: "asc" }],
  });

  return buildDebtItems(
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      dateKey: toDateKey(r.occurredAt),
      title: label(r.type, r.title, r.category?.name),
      icon: toIconKey(r.category?.icon ?? (r.type === "REFUND" ? "refund" : "transaction")),
      amount: r.amount,
      payments: r.payments,
      splits: r.splits,
    })),
    meId,
  );
}
