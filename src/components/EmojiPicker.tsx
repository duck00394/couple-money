"use client";

import { useState } from "react";
import { cx } from "./ui";

/** 圖示選擇（表單欄位名稱 emoji）。 */
export function EmojiPicker({ options, defaultValue, name = "emoji" }: { options: string[]; defaultValue?: string; name?: string }) {
  const [value, setValue] = useState(defaultValue ?? options[0]);
  const list = options.includes(value) ? options : [value, ...options];
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="圖示">
      <input type="hidden" name={name} value={value} />
      {list.map((e) => (
        <button
          key={e}
          type="button"
          role="radio"
          aria-checked={value === e}
          onClick={() => setValue(e)}
          className={cx("h-10 w-10 rounded-xl text-xl", value === e ? "bg-brand-100 ring-2 ring-brand-500" : "bg-white shadow-sm")}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
