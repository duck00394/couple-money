import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { BookContext } from "@/server/services/books";
import { Avatar, Card } from "./ui";

export function DebtCard({ ctx, debt, compact }: { ctx: BookContext; debt?: { from: string; to: string; amount: number }; compact?: boolean }) {
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
  const text = !debt ? "目前互不相欠 🎉" : meOwe ? `你要還 ${partner.nickname}` : `${partner.nickname} 要還你`;
  return (
    <Card className={debt ? (meOwe ? "bg-orange-50" : "bg-emerald-50") : undefined}>
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          <Avatar name={ctx.me.nickname} color={ctx.me.avatarColor} />
          <Avatar name={partner.nickname} color={partner.avatarColor} />
        </div>
        <div className="flex-1">
          <p className="text-sm text-stone-600">{text}</p>
          {debt && (
            <p className={`text-2xl font-bold ${meOwe ? "text-orange-600" : "text-emerald-700"}`} data-testid="debt-amount">
              {formatMoney(debt.amount)}
            </p>
          )}
        </div>
        {debt && !compact && (
          <Link href="/settle" className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm active:bg-stone-100">
            結算
          </Link>
        )}
      </div>
    </Card>
  );
}
