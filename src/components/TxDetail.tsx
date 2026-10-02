import Link from "next/link";
import { ArtIcon } from "./ArtIcon";
import { homeApprox, moneyFmt } from "@/lib/money";
import { formatCurrency } from "@/lib/currency";
import { allocateForeign, basePerUnit, rateLabel } from "@/server/domain/exchange";
import { dateHeading, hasTimeOfDay, toDateKey, toTimeKey } from "@/lib/dates";
import { TX_TYPE_LABEL, type TxType } from "@/server/domain/ledger";
import type { BookContext } from "@/server/services/books";
import type { TxListItem } from "@/server/services/ledger";
import { Card } from "./ui";

const who = (ctx: BookContext, id: string | null | undefined) =>
  id === null ? "共同" : id === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === id)?.nickname ?? "已離開的成員";

/** 紀錄的詳細資料（所有類型共用）。 */
export function TxDetail({ tx, ctx, related }: { tx: TxListItem; ctx: BookContext; related?: { id: string; title: string | null; amount: number } | null }) {
  const fmtMoney = moneyFmt(ctx.book.baseCurrency);
  const label = tx.type === "TRANSFER" && tx.sourceType === "REWARD_DEPOSIT" ? "任務獎金入金（轉帳）" : TX_TYPE_LABEL[tx.type as TxType];
  const countsAsMoney = tx.type === "EXPENSE" || tx.type === "INCOME" || tx.type === "REFUND";
  const fund = tx.fundEntry && !tx.fundEntry.deletedAt ? tx.fundEntry : null;
  // 外幣交易：把各人的本位幣負擔依比例攤回原幣（加總保證等於原幣總額）
  const foreignShares =
    tx.foreignAmount != null && tx.currency && tx.splits.length > 0
      ? allocateForeign(tx.foreignAmount, tx.splits.map((s) => Math.abs(s.amount)))
      : null;
  /*
   * V16：台幣參考值用**這筆交易當初鎖住的匯率**，不是帳本現在的匯率。
   *
   * 所以旅途中在首頁把匯率改掉，這一筆仍然顯示記帳那天的「約 NT$1,050」。
   * 舊資料（還沒有鎖匯率的那些）退回帳本目前的匯率 —— 算得出一個近似值，
   * 總比整行消失好，而且不會寫回資料庫。
   */
  const lockedHomeRate =
    tx.homeRateUnits && tx.homeRateMinor ? { units: tx.homeRateUnits, minor: tx.homeRateMinor } : null;
  const homeText = homeApprox(tx.amount, lockedHomeRate ?? ctx.book.homeRate);
  const homeRateText = lockedHomeRate
    ? `1 ${ctx.book.baseCurrency} = ${basePerUnit({ foreignUnits: lockedHomeRate.units, baseMinor: lockedHomeRate.minor }, "TWD")} TWD`
    : null;
  return (
    <Card className="space-y-3 text-sm" data-testid="tx-detail">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-stone-500">{label}</p>
          <p className="text-lg font-bold break-words">{tx.title || tx.category?.name || label}</p>
          <p className="text-xs text-stone-500">
            {dateHeading(toDateKey(tx.occurredAt))}・{toDateKey(tx.occurredAt).replaceAll("-", "/")}
            {/* 轉帳與退款一定有填時間；其他類型只有真的填了時間才顯示 */}
            {(hasTimeOfDay(tx.occurredAt) || tx.type === "TRANSFER" || tx.type === "REFUND") && ` ${toTimeKey(tx.occurredAt)}`}
          </p>
        </div>
        {/*
          V14：外幣交易把**原幣金額當主角**，台幣換算放小字。
          出國回來看帳的時候，「¥2,500」才是有記憶點的那個數字（規格點 13）。
          匯率也一起寫出來，不然之後匯率設定改了，使用者會看不懂這筆為什麼是這個數。
        */}
        {tx.foreignAmount != null && tx.currency ? (
          <div className="shrink-0 text-right">
            <p className="text-2xl font-bold" data-testid="tx-foreign">
              {formatCurrency(tx.foreignAmount, tx.currency)}
            </p>
            <p className="text-sm text-stone-600">≈ {fmtMoney(tx.amount)}</p>
            {tx.rateForeignUnits != null && tx.rateBaseMinor != null && (
              <p className="mt-0.5 text-[11px] text-stone-400" data-testid="tx-rate">
                {rateLabel(
                  { currency: tx.currency, foreignUnits: tx.rateForeignUnits, baseMinor: tx.rateBaseMinor },
                  ctx.book.baseCurrency,
                )}
              </p>
            )}
          </div>
        ) : (
          <div className="shrink-0 text-right">
            <p className="text-2xl font-bold">{fmtMoney(tx.amount)}</p>
            {homeText && (
              <p className="text-sm text-stone-600" data-testid="tx-home">約 {homeText}</p>
            )}
            {homeRateText && (
              <p className="mt-0.5 text-[11px] text-stone-400" data-testid="tx-home-rate">
                交易時匯率 {homeRateText}
              </p>
            )}
          </div>
        )}
      </div>
      {!countsAsMoney && (
        <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {tx.type === "TRANSFER" ? "帳戶間轉帳：來源帳戶扣款、目的帳戶增加，不算收入也不算支出，不影響誰欠誰。" : tx.type === "SETTLEMENT" ? "結算：還錢的紀錄，會降低欠款，不算收入或支出。" : "期初／調整：只影響帳戶餘額，不算收支、不影響欠款。"}
        </p>
      )}
      {tx.type === "REFUND" && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          退款是獨立的一筆紀錄，不會修改原始消費：實際淨支出 = 原始消費 − 退款。兩人的負擔依原本的分帳比例一起減少，欠款自動重算。
        </p>
      )}
      <div>
        <p className="mb-1 text-xs font-semibold text-stone-500">金流</p>
        <ul className="space-y-1">
          {tx.payments.map((p) => (
            <li key={p.id} className="flex justify-between">
              <span>{who(ctx, p.account.ownerId)}・{p.account.name}</span>
              <span className={p.amount < 0 ? "text-emerald-600" : ""}>{p.amount < 0 ? "+" : "-"}{fmtMoney(Math.abs(p.amount))}</span>
            </li>
          ))}
        </ul>
      </div>
      {tx.splits.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-stone-500">{tx.type === "REFUND" ? "退款減少的負擔" : "各自負擔"}</p>
          <ul className="space-y-1">
            {tx.splits.map((s, i) => (
              <li key={s.id} className="flex justify-between">
                <span>{who(ctx, s.userId)}</span>
                <span>
                  {/*
                    V14：外幣交易連分帳也要看得到原幣（規格點 14）。
                    分帳本身是在本位幣上算的（既有 domain 一行都沒改），這裡只是把它
                    依比例攤回原幣顯示；用 allocateForeign 分配，所以各人加起來
                    一定剛好等於原幣總額，不會因為四捨五入湊不回 ¥10,000。
                  */}
                  {foreignShares && <span className="mr-1.5 text-stone-500">{formatCurrency(foreignShares[i], tx.currency!)}</span>}
                  {fmtMoney(Math.abs(s.amount))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tx.category && (
        <p className="flex items-center gap-1.5">
          <span className="text-stone-500">分類：</span>
          <ArtIcon name={tx.category.icon} size={16} />
          {tx.category.name}
        </p>
      )}
      {tx.tags.length > 0 && <p className="break-words"><span className="text-stone-500">標籤：</span>{tx.tags.map((t) => `#${t.tag.name}`).join(" ")}</p>}
      {tx.note && <p className="break-words"><span className="text-stone-500">備註：</span>{tx.note}</p>}
      {fund && (
        <p>
          <span className="text-stone-500">基金：</span>
          <Link href={`/funds/${fund.fundId}`} className="text-brand-600 underline">{fund.fund.name}</Link>（基金實際金額 −{fmtMoney(tx.amount)}）
        </p>
      )}
      {tx.recurring && (
        <p data-testid="tx-recurring">
          <span className="text-stone-500">來源：</span>
          {tx.recurring.deletedAt ? (
            <span>固定支出：{tx.recurring.name}（設定已刪除）</span>
          ) : (
            <Link href={`/recurring/${tx.recurring.id}`} className="text-brand-600 underline">固定支出：{tx.recurring.name}</Link>
          )}
        </p>
      )}
      {tx.sourceType === "REWARD_DEPOSIT" && tx.sourceId && (
        <p><span className="text-stone-500">來源：</span><Link href={`/funds/${tx.sourceId}`} className="text-brand-600 underline">基金的任務獎金入金</Link></p>
      )}
      {related && (
        <p>
          <span className="text-stone-500">原始消費：</span>
          <Link href={`/transactions/${related.id}`} className="text-brand-600 underline">{related.title || "消費"}（{fmtMoney(related.amount)}）</Link>
        </p>
      )}
      {tx.type === "SETTLEMENT" && <p><Link href="/settle" className="text-brand-600 underline">到結算頁查看或取消</Link></p>}
      <p className="border-t border-line pt-2 text-xs text-stone-400">
        建立：{who(ctx, tx.createdById)}・{tx.createdAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
        {tx.version > 1 && `・已修改 ${tx.version - 1} 次（最後：${who(ctx, tx.updatedById)}）`}
      </p>
    </Card>
  );
}
