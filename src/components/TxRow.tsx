import Link from "next/link";
import { toIconKey } from "@/lib/icons";
import { ArtTile } from "./ArtIcon";
import { formatMoney } from "@/lib/money";
import { formatCurrency } from "@/lib/currency";
import type { BookContext } from "@/server/services/books";
import type { TxType } from "@/server/domain/ledger";

/**
 * 這一列真正會讀到的欄位。
 *
 * 原本直接用 `TxListItem`（Prisma 推導出來的型別），但那個型別帶著 bookId、createdAt、
 * deletedAt⋯⋯一堆畫面根本用不到的欄位。改成明寫契約有兩個好處：
 *   1. 看這個 interface 就知道這一列需要什麼，不用回去翻 Prisma schema
 *   2. 試用模式（src/demo/）可以餵同一個元件，不必假造整個 Prisma row
 * `TxListItem` 在結構上滿足這個介面，所以正式模式的呼叫端一行都不用改。
 */
export interface TxRowItem {
  id: string;
  type: TxType;
  title: string | null;
  amount: number;
  note: string | null;
  sourceType?: string | null;
  /** V14：原始幣別與原幣金額。foreignAmount 有值才代表這是一筆外幣交易。 */
  currency?: string | null;
  foreignAmount?: number | null;
  category: { name: string; icon: string } | null;
  settlement: { fromUserId: string; toUserId: string } | null;
  payments: Array<{ amount: number; account: { name: string; ownerId: string | null } }>;
  splits: Array<{ userId: string; amount: number }>;
  fundEntry?: { deletedAt: Date | null; fund: { name: string } } | null;
  recurring?: unknown;
  tags: Array<{ tag: { name: string } }>;
}

const name = (ctx: BookContext, id: string | null | undefined) =>
  id === null ? "共同" : id === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === id)?.nickname ?? "已離開的成員";

function Row({ href, icon, tone = "neutral", title, sub, amount, amountClass = "", tags }: {
  href: string;
  icon: string;
  tone?: "neutral" | "brand" | "income" | "info" | "pending";
  title: string;
  sub: string;
  amount: string;
  amountClass?: string;
  tags?: string[];
}) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 active:bg-stone-50" data-testid="tx-row">
      <ArtTile name={icon} tone={tone} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium leading-snug text-stone-800">{title}</p>
        <p className="truncate text-xs leading-snug text-stone-500">{sub}</p>
        {tags && tags.length > 0 && (
          <p className="mt-0.5 truncate text-[11px] text-brand-600">{tags.map((t) => `#${t}`).join(" ")}</p>
        )}
      </div>
      <span className={`amount shrink-0 text-[15px] ${amountClass || "text-stone-800"}`}>{amount}</span>
    </Link>
  );
}

/** 記帳列表的一列。所有類型都能點進詳細頁（支出／收入可以編輯）。 */
export function TxRow({ tx, ctx, base = "" }: { tx: TxRowItem; ctx: BookContext; base?: string }) {
  const tags = tx.tags.map((t) => t.tag.name);
  const href = `${base}/transactions/${tx.id}`;

  if (tx.type === "SETTLEMENT" && tx.settlement) {
    const s = tx.settlement;
    return <Row href={href} icon="settle" tone="income" title={`${name(ctx, s.fromUserId)} 還給 ${name(ctx, s.toUserId)}`} sub={`結算${tx.note ? ` · ${tx.note}` : ""}`} amount={formatMoney(tx.amount)} amountClass="rounded-md bg-brand-100 px-1.5 py-0.5 text-brand-700" />;
  }
  if (tx.type === "TRANSFER") {
    const out = tx.payments.find((p) => p.amount > 0);
    const into = tx.payments.find((p) => p.amount < 0);
    const reward = tx.sourceType === "REWARD_DEPOSIT";
    return (
      <Row
        href={href}
        icon={reward ? "piggy-bank" : "transfer"}
        tone="info"
        title={reward ? tx.title ?? "任務獎金入金" : tx.title || "帳戶間轉帳"}
        sub={`${out ? `${name(ctx, out.account.ownerId)}・${out.account.name}` : ""} → ${into ? `${name(ctx, into.account.ownerId)}・${into.account.name}` : ""}・不算收支`}
        amount={formatMoney(tx.amount)}
        amountClass="text-sky-700"
        tags={tags}
      />
    );
  }
  if (tx.type === "OPENING_BALANCE" || tx.type === "ADJUSTMENT") {
    const p = tx.payments[0];
    // payment > 0 代表帳戶減少（例如信用卡未繳），要把方向顯示出來
    const delta = -(p?.amount ?? 0);
    return (
      <Row
        href={href}
        icon="adjust"
        title={tx.type === "OPENING_BALANCE" ? "期初餘額" : "餘額調整"}
        sub={`${name(ctx, p?.account.ownerId)}・${p?.account.name ?? ""}・不算收支`}
        amount={`${delta < 0 ? "-" : "+"}${formatMoney(Math.abs(delta))}`}
        amountClass="text-stone-500"
      />
    );
  }

  const pay = tx.payments[0];
  const payer = pay?.account.ownerId ? `${name(ctx, pay.account.ownerId)}${tx.type === "EXPENSE" ? "付" : "收"} · ${pay.account.name}` : `${pay?.account.name ?? "共同帳戶"}`;
  const mine = tx.splits.find((s) => s.userId === ctx.me.userId)?.amount ?? 0;
  const isIncome = tx.type === "INCOME";
  const isRefund = tx.type === "REFUND";
  const title = isRefund ? `退款：${tx.title || tx.category?.name || ""}` : tx.title || tx.category?.name || (isIncome ? "收入" : "支出");
  const fund = tx.fundEntry && !tx.fundEntry.deletedAt ? ` · ${tx.fundEntry.fund.name}` : "";
  const recurring = tx.recurring ? " · 固定支出" : "";
  // V14：外幣交易把原幣金額放在副標最前面 —— 出國回來看帳時，
  // 「那天到底花了多少日圓」比台幣數字更有記憶點（規格點 13）。
  const foreign = tx.foreignAmount != null && tx.currency ? `${formatCurrency(tx.foreignAmount, tx.currency)} · ` : "";
  return (
    <Row
      href={href}
      icon={isRefund ? "refund" : toIconKey(tx.category?.icon ?? (isIncome ? "banknote" : "tag"))}
      tone={isIncome || isRefund ? "income" : "neutral"}
      title={title}
      sub={`${foreign}${payer}${!isIncome && tx.splits.length > 0 ? ` · 我${isRefund ? "少負擔" : "負擔"} ${formatMoney(Math.abs(mine))}` : ""}${fund}${recurring}`}
      amount={`${isIncome || isRefund ? "+" : "-"}${formatMoney(tx.amount)}`}
      amountClass={isIncome || isRefund ? "rounded-md bg-brand-100 px-1.5 py-0.5 text-brand-700" : "text-stone-800"}
      tags={tags}
    />
  );
}
