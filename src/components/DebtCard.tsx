import Link from "next/link";
import { homeApprox, moneyFmt } from "@/lib/money";
import type { BookContext } from "@/server/services/books";
import { Avatar, Card } from "./ui";

export function DebtCard({ ctx, debt, compact, base = "" }: { ctx: BookContext; debt?: { from: string; to: string; amount: number }; compact?: boolean; base?: string }) {
  const fmtMoney = moneyFmt(ctx.book.baseCurrency);
  const partner = ctx.partner;
  if (!partner) {
    return (
      <Card className="text-center">
        <p className="text-stone-600">還沒綁定另一半</p>
        <Link href="/more?invite=1" className="mt-2 inline-block font-semibold text-brand-600">產生邀請碼 →</Link>
      </Card>
    );
  }
  const meOwe = debt?.from === ctx.me.userId;
  const text = !debt ? "目前互不相欠" : meOwe ? `你要還 ${partner.nickname}` : `${partner.nickname} 要還你`;
  return (
    <Card className={debt ? (meOwe ? "bg-orange-50" : "bg-emerald-50") : undefined}>
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          <Avatar name={ctx.me.nickname} color={ctx.me.avatarColor} src={ctx.me.avatarUrl} />
          <Avatar name={partner.nickname} color={partner.avatarColor} src={partner.avatarUrl} />
        </div>
        <div className="flex-1">
          <p className="text-sm text-stone-600">{text}</p>
          {debt && (
            <>
              <p className={`text-2xl font-bold ${meOwe ? "text-orange-600" : "text-emerald-700"}`} data-testid="debt-amount">
                {fmtMoney(debt.amount)}
              </p>
              {homeApprox(debt.amount, ctx.book.homeRate) && (
                <p className="text-xs text-stone-500">約 {homeApprox(debt.amount, ctx.book.homeRate)}</p>
              )}
            </>
          )}
        </div>
        {/* 結算每週會用到一次，別讓它只是一顆白色小膠囊 */}
        {debt && !compact && (
          <Link
            href={`${base}/settle`}
            className="press shrink-0 rounded-full border-[1.5px] border-stone-800 bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md"
            data-testid="go-settle"
          >
            {meOwe ? "去還款" : "看明細"}
          </Link>
        )}
      </div>
    </Card>
  );
}
