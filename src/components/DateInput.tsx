"use client";

import { useState, type ComponentProps } from "react";
import { cx, inputClass } from "./ui";

/**
 * 日期輸入：原生 date input（手機會跳出系統日期輪），底下再用台灣習慣的
 * `2026/09/25` 把選到的日期複述一次，因為 iOS 與 Android 顯示的格式不一樣，
 * 使用者常常不確定自己選到哪一天。
 *
 * 受控（有 value）與非受控（只有 defaultValue）都要能正確更新回聲，
 * 所以非受控時自己記一份，不然使用者換了日期、底下那行卻還停在舊的。
 */
export function DateInput({ className, onChange, ...props }: ComponentProps<"input">) {
  const controlled = typeof props.value === "string";
  const [own, setOwn] = useState(typeof props.defaultValue === "string" ? props.defaultValue : "");
  const v = controlled ? (props.value as string) : own;
  const shown = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.replaceAll("-", "/") : "";

  return (
    <>
      <input
        type="date"
        className={cx(inputClass, className)}
        {...props}
        onChange={(e) => {
          if (!controlled) setOwn(e.target.value);
          onChange?.(e);
        }}
      />
      <span className="mt-1 block min-h-[14px] text-[11px] text-stone-400">{shown}</span>
    </>
  );
}
