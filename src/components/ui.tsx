import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ArtIcon } from "./ArtIcon";

/**
 * 共用 UI 元件（Design System）。
 *
 * 顏色、圓角、陰影、字級一律來自 `globals.css` 的 design token，
 * 這裡只決定「元件長什麼樣」。頁面請優先用這些元件，不要各自寫一套樣式。
 */

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

/* ─────────────────────────────── 容器 ─────────────────────────────── */

/**
 * 一張「紙」。奶油風的分層靠的是暖白紙張 + 髮絲線 + 留白，
 * 不是靠陰影把卡片墊高，所以這裡只留一層幾乎看不見的微光。
 */
/** 一張手帳紙：圓角 + 深咖啡虛線邊框 + 位移硬陰影。 */
/**
 * 卡片。
 * 預設是手帳風的虛線紙（主要區塊用）；`quiet` 是次要容器，只有一條髮絲線，
 * 這樣虛線才會是「這裡比較重要」的訊號，而不是滿版的裝飾。
 */
export function Card({ className, quiet, ...props }: ComponentProps<"div"> & { quiet?: boolean }) {
  return <div className={cx(quiet ? "paper-quiet" : "paper", "p-4", className)} {...props} />;
}

/** 卡片內的分隔線（列與列之間）。 */
export function Divider({ className }: { className?: string }) {
  return <hr className={cx("border-dashed border-line", className)} />;
}

/**
 * 日期輸入。
 *
 * 原生 date input 的顯示格式是瀏覽器／系統地區設定決定的，網頁改不了
 * （在英文系統上會顯示成 09/25/2026）。與其自己做一個日期元件，
 * 這裡只在旁邊補一行台灣格式的回聲，讓人一眼確認自己選到哪一天。
 */
export { DateInput } from "./DateInput";

/* ─────────────────────────────── 按鈕 ─────────────────────────────── */

const btn = {
  primary: "border-[1.5px] border-stone-800 bg-brand-500 text-white shadow-md active:translate-y-px active:shadow-xs disabled:border-stone-300 disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none",
  secondary: "border-[1.5px] border-stone-800 bg-brand-100 text-stone-800 shadow-xs active:translate-y-px active:shadow-none disabled:text-stone-400",
  soft: "border-[1.5px] border-stone-800 bg-kraft text-stone-800 shadow-xs active:translate-y-px active:shadow-none disabled:text-stone-400",
  danger: "border-[1.5px] border-red-600 bg-white text-red-600 shadow-xs active:translate-y-px active:shadow-none",
  ghost: "text-stone-600 active:bg-stone-100",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof btn }) {
  return (
    <button
      className={cx(
        "press flex h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-all disabled:cursor-not-allowed disabled:active:scale-100 disabled:active:translate-y-0",
        btn[variant],
        className,
      )}
      {...props}
    />
  );
}

export function LinkButton({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof btn }) {
  return (
    <Link
      className={cx("press flex h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-all", btn[variant], className)}
      {...props}
    />
  );
}

/* ─────────────────────────────── 表單 ─────────────────────────────── */

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "block h-12 w-full rounded-xl border-[1.5px] border-stone-800 bg-white px-3.5 text-base text-stone-800 outline-none transition placeholder:text-stone-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputClass, "appearance-none pr-9", props.className)} />;
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rise rounded-xl border-[1.5px] border-red-600 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-700">
      {children}
    </p>
  );
}

/* ─────────────────────────────── 標題與導覽 ─────────────────────────────── */

/**
 * 頭像：有上傳頭貼就顯示圓形照片（正方形裁切），沒有就用色塊 + 名字第一個字。
 * 照片走 /api/files/[id]，只有同帳本的人讀得到，所以這裡直接用 <img> 就好。
 */
export function Avatar({ name, color, size = 36, src }: { name: string; color: string; size?: number; src?: string | null }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 頭貼走 /api/files 權限檢查，不能交給 next/image 的 optimizer
      <img
        src={src}
        alt={`${name} 的頭貼`}
        width={size}
        height={size}
        className="art-round shrink-0"
        style={{ width: size, height: size, background: color }}
      />
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-stone-800 font-semibold text-stone-800"
      style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {Array.from(name)[0] ?? "?"}
    </span>
  );
}

export function PageHeader({ title, back, right }: { title: string; back?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-2 bg-canvas/90 px-4 backdrop-blur-md">
      {back && (
        <Link
          href={back}
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-2xl text-stone-500 active:bg-stone-200"
          aria-label="返回"
        >
          ‹
        </Link>
      )}
      <h1 className="flex-1 truncate text-xl font-semibold tracking-tight text-stone-800">{title}</h1>
      {right}
    </header>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 mt-8 flex items-center justify-between gap-3 px-1">
      <h2 className="text-[13px] font-semibold tracking-wide text-stone-700">{children}</h2>
      {right}
    </div>
  );
}

/* ─────────────────────────────── 狀態 ─────────────────────────────── */

const badge = {
  neutral: "bg-stone-100 text-stone-700",
  brand: "bg-brand-500 text-white",
  income: "bg-brand-100 text-brand-700",
  warn: "bg-orange-50 text-orange-700",
  danger: "bg-red-50 text-red-700",
  pending: "bg-amber-50 text-amber-800",
  info: "bg-sky-50 text-sky-800",
};

/** 小標籤：狀態、分類、提醒都用它，不要每頁各自寫 rounded-full。 */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof badge;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border-[1.5px] border-stone-800 px-2 py-0.5 text-xs font-bold", badge[tone], className)}>
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  className,
  tone = "brand",
}: {
  value: number;
  className?: string;
  tone?: "brand" | "green" | "orange" | "red" | "me" | "partner" | "joint";
}) {
  // 同一個橘色系的三階：給「我／對方／共同」這種需要分辨但不該搶戲的比較用
  const colors = { brand: "bg-brand-500", green: "bg-brand-500", orange: "bg-orange-400", red: "bg-red-500", me: "bg-brand-600", partner: "bg-brand-400", joint: "bg-brand-200" };
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={cx("h-2 overflow-hidden rounded-full border-[1.5px] border-stone-800 bg-stone-100", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cx("h-full rounded-full transition-all duration-500 ease-out", colors[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 空狀態：一個線性圖示 + 一句話 +（選填）一個行動。圖示用 icon key，不是 emoji。 */
export function Empty({ icon, children, action }: { icon?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      {icon && (
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border-[1.5px] border-stone-800 bg-brand-100">
          <ArtIcon name={icon} size={22} />
        </span>
      )}
      <p className="text-sm text-stone-500">{children}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/** 載入骨架：換頁與區塊載入都用同一個灰階。 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-2xl bg-stone-200/60", className)} />;
}

export function ListLink({
  href,
  icon,
  children,
  right,
  sub,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3.5 active:bg-stone-50">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-800 bg-brand-100">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-stone-800">{children}</span>
        {sub && <span className="block truncate text-xs text-stone-500">{sub}</span>}
      </span>
      {right}
      <span className="text-stone-300">›</span>
    </Link>
  );
}

/** 預設收合的區塊（例如編輯表單），避免詳細頁太長。 */
export function Collapsible({ title, children, className, open }: { title: string; children: ReactNode; className?: string; open?: boolean }) {
  return (
    <details className={cx("group mt-6", className)} open={open}>
      <summary className="paper mb-2 flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-sm font-semibold text-stone-700">
        {title}
        <span className="text-stone-400 transition group-open:rotate-90">›</span>
      </summary>
      {children}
    </details>
  );
}

/** 兩段式進度條：實線＝實際金額、淡色斜紋＝尚未入金獎金（不是現金）。 */
export function TwoPartProgress({
  real,
  pending,
  target,
  className,
  tone = "brand",
}: {
  real: number;
  pending: number;
  target: number;
  className?: string;
  tone?: "brand" | "green";
}) {
  const r = target > 0 ? Math.max(0, Math.min(1, real / target)) : 0;
  const p = target > 0 ? Math.max(0, Math.min(1 - r, Math.max(0, pending) / target)) : 0;
  return (
    <div
      className={cx("flex h-2 overflow-hidden rounded-full border-[1.5px] border-stone-800 bg-stone-100", className)}
      role="progressbar"
      aria-valuenow={Math.round(r * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cx("h-full transition-all duration-500 ease-out", tone === "green" ? "bg-brand-500" : "bg-brand-400")} style={{ width: `${r * 100}%` }} />
      <div
        className="h-full bg-amber-300 bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(255,255,255,.55)_4px_8px)]"
        style={{ width: `${p * 100}%` }}
      />
    </div>
  );
}
