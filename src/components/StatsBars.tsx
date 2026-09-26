import Link from "next/link";
import { ArtIcon } from "./ArtIcon";
import { formatMoney } from "@/lib/money";
import { cx } from "./ui";

/**
 * 同一個橘色系的深淺三階。
 * 「我／對方／共同」需要一眼分辨，但不該用不同色相搶戲，所以只變深淺。
 */
const TONES = {
  brand: "bg-brand-400",
  me: "bg-brand-600",
  partner: "bg-brand-400",
  joint: "bg-brand-200",
  green: "bg-brand-500",
  orange: "bg-brand-400",
  stone: "bg-stone-300",
} as const;

export type BarTone = keyof typeof TONES;

/** 一列橫條：左邊名稱、右邊金額，底下是佔比長度。ratio 已經是 0～1。 */
export function BarRow({
  label, amount, ratio, tone = "brand", note, href, testId, icon,
}: {
  label: string;
  icon?: string;
  amount: number;
  ratio: number;
  tone?: BarTone;
  note?: string;
  href?: string;
  testId?: string;
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{icon && <ArtIcon name={icon} size={15} className="text-stone-400" />}<span className="truncate">{label}</span></span>
        <span className="tnum shrink-0 font-semibold" data-testid={testId}>{formatMoney(amount)}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-100">
        <div className={cx("h-full rounded-full transition-all duration-500 ease-out", TONES[tone])} style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
      </div>
      {note && <p className="mt-1 text-[11px] text-stone-400">{note}</p>}
    </>
  );
  const className = "block px-4 py-3 text-sm";
  return href ? (
    <Link href={href} className={cx(className, "active:bg-stone-50")} data-testid="category-row">{body}</Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** 最近幾個月的迷你長條（純 CSS，不引入圖表套件）。 */
export function MiniTrend({ points, labelOf }: { points: Array<{ month: string; netExpense: number; income: number }>; labelOf: (m: string) => string }) {
  const max = Math.max(1, ...points.flatMap((p) => [p.netExpense, p.income]));
  return (
    <div className="flex items-end gap-2 px-4 py-5" data-testid="stats-trend">
      {points.map((p) => (
        <div key={p.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex h-24 w-full items-end justify-center gap-0.5">
            <div
              className="w-1/2 rounded-t-md bg-brand-600"
              style={{ height: `${(p.netExpense / max) * 100}%` }}
              title={`${labelOf(p.month)} 淨支出 ${formatMoney(p.netExpense)}`}
            />
            <div
              className="w-1/2 rounded-t-md bg-brand-200 ring-1 ring-inset ring-brand-400"
              style={{ height: `${(p.income / max) * 100}%` }}
              title={`${labelOf(p.month)} 收入 ${formatMoney(p.income)}`}
            />
          </div>
          <span className="truncate text-[10px] text-stone-400">{labelOf(p.month)}</span>
        </div>
      ))}
    </div>
  );
}
