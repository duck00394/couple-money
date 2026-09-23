"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, Home, Menu, ReceiptText, Target } from "lucide-react";
import { cx } from "./ui";

const items = [
  { href: "/", label: "首頁", icon: Home, match: (p: string) => p === "/" },
  { href: "/transactions", label: "記帳", icon: ReceiptText, match: (p: string) => p.startsWith("/transactions") || p.startsWith("/settle") || p.startsWith("/accounts") || p.startsWith("/recurring") || p.startsWith("/stats") },
  { href: "/tasks", label: "任務", icon: CalendarCheck, match: (p: string) => p.startsWith("/tasks") },
  { href: "/goals", label: "目標", icon: Target, match: (p: string) => p.startsWith("/goals") || p.startsWith("/funds") },
  { href: "/more", label: "更多", icon: Menu, match: (p: string) => p.startsWith("/more") || p.startsWith("/activity") || p.startsWith("/categories") || p.startsWith("/budgets") },
];

export function BottomNav() {
  const path = usePathname();
  // 導覽列在所有頁面都看得到（表單的送出列會固定在它上方，見 globals.css 的 .sticky-submit-bar）
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md border-t border-stone-200/80 bg-white/92 backdrop-blur-lg">
      <ul className="grid h-16 grid-cols-5">
        {items.map(({ href, label, icon: Icon, match }) => {
          const active = match(path);
          return (
            <li key={href}>
              <Link
                href={href}
                className="group flex h-full flex-col items-center justify-center gap-1 text-[11px]"
                aria-current={active ? "page" : undefined}
              >
                <span
                  className={cx(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200",
                    active ? "bg-brand-100" : "bg-transparent group-active:bg-stone-100",
                  )}
                >
                  <Icon size={20} strokeWidth={active ? 2.3 : 1.9} className={active ? "text-brand-700" : "text-stone-400"} />
                </span>
                <span className={cx(active ? "font-semibold text-brand-700" : "text-stone-500")}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
