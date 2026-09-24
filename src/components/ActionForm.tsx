"use client";

import { startTransition, type ComponentProps } from "react";

/**
 * 送出後「不清空欄位」的表單。
 * React 19 的 <form action> 在送出後會自動重設欄位，驗證失敗時使用者得重填；
 * 這裡改用 onSubmit + startTransition 呼叫同一個 action，錯誤時保留輸入內容。
 */
export function ActionForm({
  action,
  ...props
}: Omit<ComponentProps<"form">, "action" | "onSubmit"> & { action: (fd: FormData) => void }) {
  return (
    <form
      {...props}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
    />
  );
}
