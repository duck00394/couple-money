import Link from "next/link";
import { ArtIcon } from "@/components/ArtIcon";

/** 帳本以外的 404（例如錯誤的邀請連結）。 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400"><ArtIcon name="search" size={22} /></p>
      <h1 className="text-lg font-bold">找不到這個頁面</h1>
      <p className="text-sm text-stone-500">連結可能不正確，或這筆資料已經被刪除。</p>
      <Link href="/" className="mt-2 rounded-xl bg-brand-200 ring-1 ring-brand-400/60 px-4 py-2.5 text-sm font-semibold text-stone-800">回首頁</Link>
    </main>
  );
}
