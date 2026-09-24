"use client";

import { useEffect, useState } from "react";

/** 顯示短暫提示（例如打卡成功、達成里程碑）。任何地方呼叫 showToast() 即可。 */
export function showToast(message: string, tone: "ok" | "error" = "ok") {
  window.dispatchEvent(new CustomEvent("cm-toast", { detail: { message, tone } }));
}

export function ToastHost() {
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "error"; id: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onToast = (e: Event) => {
      const { message, tone } = (e as CustomEvent).detail;
      setToast({ message, tone, id: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 5000);
    };
    window.addEventListener("cm-toast", onToast);
    return () => {
      window.removeEventListener("cm-toast", onToast);
      clearTimeout(timer);
    };
  }, []);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 mx-auto flex max-w-md justify-center px-4">
      <p
        key={toast.id}
        role="status"
        data-testid="toast"
        onClick={() => setToast(null)}
        className={`pointer-events-auto rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg ${toast.tone === "ok" ? "bg-stone-900 text-white" : "bg-red-600 text-white"}`}
      >
        {toast.message}
      </p>
    </div>
  );
}
