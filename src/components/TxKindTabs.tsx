import Link from "next/link";
import { ArtIcon } from "./ArtIcon";
import { cx } from "./ui";

const TABS = [
  { href: "/transactions/new", icon: "transaction", label: "記一筆", hint: "支出／收入" },
  { href: "/transactions/transfer", icon: "transfer", label: "轉帳", hint: "帳戶之間" },
  { href: "/transactions/refund", icon: "refund", label: "退款", hint: "退回原消費" },
] as const;

/** 記一筆／轉帳／退款：三種完全不同的紀錄，用分頁分清楚。 */
export function TxKindTabs({ active }: { active: "new" | "transfer" | "refund" }) {
  return (
    <div className="grid grid-cols-3 gap-2 px-4 pb-1">
      {TABS.map((t) => {
        const on = t.href.endsWith(active);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cx(
              "rounded-2xl px-2 py-1.5 text-center shadow-sm",
              on ? "bg-brand-200 text-stone-800 ring-1 ring-brand-400" : "bg-white text-stone-700 active:bg-stone-50",
            )}
          >
            {/* 圖示與標題同一行：金額與分類才是主角，分頁不該佔掉第一屏 */}
            <span className="flex items-center justify-center gap-1">
              <ArtIcon name={t.icon} size={15} />
              <span className="text-sm font-semibold">{t.label}</span>
            </span>
            {/* 選中時底色是淺橘，白字看不見，要用深色 */}
            <span className={cx("block text-[10px] leading-tight", on ? "text-brand-700" : "text-stone-400")}>{t.hint}</span>
          </Link>
        );
      })}
    </div>
  );
}
