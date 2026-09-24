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
}: {
  options: readonly string[];
  defaultValue?: string;
  name?: string;
  label?: string;
}) {
  const [value, setValue] = useState(() => {
    const key = toIconKey(defaultValue);
    return options.includes(key) ? key : options[0];
  });
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      <input type="hidden" name={name} value={value} />
      {options.map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          aria-label={key}
          onClick={() => setValue(key)}
          className={cx(
            "press flex h-11 w-11 items-center justify-center rounded-2xl transition",
            value === key ? "bg-brand-100 text-brand-700 ring-2 ring-brand-500" : "bg-white text-stone-500 shadow-xs",
          )}
        >
          <ArtIcon name={key} size={20} />
        </button>
      ))}
    </div>
  );
}
