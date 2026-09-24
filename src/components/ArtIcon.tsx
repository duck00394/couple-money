import { toIconKey } from "@/lib/icons";

/**
 * 手繪風 icon 插槽。
 *
 * 一律用 <img> 指向 `/public/assets/icons/<key>.png`，
 * 目前放的是線稿佔位圖，直接覆蓋同名檔案就會換成你自己的素材。
 * className 都留在外層，方便整批調整。
 */
export function ArtIcon({ name, size = 22, className = "" }: { name: string; size?: number; className?: string }) {
  const key = toIconKey(name);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 素材要能被使用者直接替換，不走 next/image optimizer
    <img
      src={`/assets/icons/${key}.png`}
      alt=""
      width={size}
      height={size}
      className={`art art-icon ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

const TONE = {
  neutral: "bg-brand-100",
  brand: "bg-brand-200",
  income: "bg-brand-200",
  info: "bg-kraft",
  pending: "bg-amber-50",
} as const;

/** 圓形 icon 磚（清單列、分類格常用）。 */
export function ArtTile({
  name,
  size = 34,
  tone = "neutral",
  className = "",
}: {
  name: string;
  size?: number;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-800 ${TONE[tone] ?? TONE.neutral} ${className}`}
      style={{ width: size, height: size }}
    >
      <ArtIcon name={name} size={Math.round(size * 0.58)} />
    </span>
  );
}

/** 角色／場景插畫插槽。src 指向 /public/assets/ 下的檔案，換圖不用改程式。 */
export function ArtImage({
  src,
  alt,
  className = "",
  width,
  height,
}: {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  // eslint-disable-next-line @next/next/no-img-element -- 同上
  return <img src={src} alt={alt} width={width} height={height} className={`art ${className}`} />;
}
