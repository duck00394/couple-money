import Link from "next/link";

/** 帳本以外的 404（例如錯誤的邀請連結）。 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-4xl">🔍</p>
      <h1 className="text-lg font-bold">找不到這個頁面</h1>
      <p className="text-sm text-stone-500">連結可能不正確，或這筆資料已經被刪除。</p>
      <Link href="/" className="mt-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white">回首頁</Link>
    </main>
  );
}
