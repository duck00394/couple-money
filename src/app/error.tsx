"use client";

import { useEffect } from "react";
import { ArtIcon } from "@/components/ArtIcon";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400"><ArtIcon name="tool" size={22} /></p>
      <h1 className="text-lg font-bold">載入失敗</h1>
      <p className="text-sm text-stone-500">這個畫面載入時發生問題，資料沒有被改動。</p>
      <button onClick={() => reset()} className="mt-2 rounded-xl bg-brand-200 ring-1 ring-brand-400/60 px-4 py-2.5 text-sm font-semibold text-stone-800">再試一次</button>
    </main>
  );
}
