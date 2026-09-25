"use client";

import { useState } from "react";
import { toIconKey } from "@/lib/icons";
import { ArtIcon } from "./ArtIcon";
import { cx } from "./ui";

/**
 * 圖示選擇器。選的是 `src/lib/icons.ts` 的 icon key（不是 emoji），
 * 表單送出的仍然是同一個欄位名稱，所以 service 端不用改。
 *
 * 舊資料如果還是 emoji，`toIconKey()` 會先轉成對應的 key，選單不會出現 emoji。
 */
export function IconPicker({
  options,
  defaultValue,
  name = "emoji",
  label = "圖示",
  value: controlled,
  onChange,
}: {
  options: readonly string[];
  defaultValue?: string;
  name?: string;
  label?: string;
  /** 受控用法：由外面管狀態（表單自己組 payload 時用），這時不會送出 hidden input */
  value?: string;
  onChange?: (key: string) => void;
}) {
  const [inner, setInner] = useState(() => {
    const key = toIconKey(defaultValue);
    return options.includes(key) ? key : options[0];
  });
  const value = controlled ?? inner;
  const pick = (key: string) => (onChange ? onChange(key) : setInner(key));
  return (
    // 固定格線而不是 flex-wrap：每一列對齊，換行不會參差不齊
    <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label={label}>
      {controlled === undefined && <input type="hidden" name={name} value={value} />}
      {options.map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          aria-label={key}
          onClick={() => pick(key)}
          className={cx(
            "press flex aspect-square w-full items-center justify-center rounded-2xl transition",
            value === key
              ? "bg-brand-100 ring-2 ring-brand-500 ring-offset-1 ring-offset-white"
              : "bg-white ring-1 ring-line",
          )}
        >
          <ArtIcon name={key} size={22} />
        </button>
      ))}
    </div>
  );
}
