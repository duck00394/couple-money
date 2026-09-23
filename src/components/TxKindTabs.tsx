import Link from "next/link";
import { cx } from "./ui";

const TABS = [
  { href: "/transactions/new", icon: "🧾", label: "記一筆", hint: "支出／收入" },
  { href: "/transactions/transfer", icon: "🔁", label: "轉帳", hint: "帳戶之間" },
  { href: "/transactions/refund", icon: "↩️", label: "退款", hint: "退回原消費" },
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
            className={cx("rounded-2xl px-2 py-2 text-center shadow-sm", on ? "bg-brand-500 text-white" : "bg-white text-stone-700 active:bg-stone-50")}
          >
            <span className="block text-lg leading-6">{t.icon}</span>
            <span className="block text-sm font-semibold">{t.label}</span>
            <span className={cx("block text-[10px]", on ? "text-white/80" : "text-stone-400")}>{t.hint}</span>
          </Link>
        );
      })}
    </div>
  );
}
