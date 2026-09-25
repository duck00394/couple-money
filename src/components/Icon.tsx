import { createElement } from "react";
import { iconOf, type IconName } from "@/lib/icons";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/**
 * 全站唯一的圖示元件。
 *
 * 尺寸、線條粗細、顏色都在這裡統一，頁面不要直接 import lucide 的元件，
 * 也不要用 emoji 當圖示（見 `src/lib/icons.ts` 的規則）。
 */
export function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.75,
}: {
  name: IconName | string | null | undefined;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  // 用 createElement：圖示是「查表拿到的元件」，不是在 render 當下建立新元件
  return createElement(iconOf(name), {
    size,
    strokeWidth,
    className: cx("shrink-0", className),
    "aria-hidden": true,
  });
}

/** 列表左側的圓角圖示磚（記帳、分類、帳戶、動態都用這個）。 */
export function IconTile({
  name,
  tone = "neutral",
  size = 40,
  className,
}: {
  name: IconName | string | null | undefined;
  tone?: "neutral" | "brand" | "income" | "info" | "pending";
  size?: number;
  className?: string;
}) {
  const tones = {
    neutral: "bg-stone-100 text-stone-500",
    brand: "bg-brand-100 text-brand-700",
    income: "bg-emerald-50 text-emerald-700",
    info: "bg-sky-50 text-sky-800",
    pending: "bg-amber-50 text-amber-800",
  };
  return (
    <span
      className={cx("flex shrink-0 items-center justify-center rounded-2xl", tones[tone], className)}
      style={{ width: size, height: size }}
    >
      <Icon name={name} size={Math.round(size * 0.45)} />
    </span>
  );
}
