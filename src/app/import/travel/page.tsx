import type { Metadata } from "next";
import { TravelImport } from "@/components/TravelImport";

export const metadata: Metadata = { title: "從旅行日記匯入", referrer: "no-referrer" };

/** 旅行日記「匯出到情侶帳本」打開的頁面。票在網址 # 後面，只在瀏覽器裡讀，不會送到伺服器的 log。 */
export default function TravelImportPage() {
  return (
    <main className="px-5 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-stone-800">從旅行日記匯入</h1>
      <p className="mt-1 text-sm leading-relaxed text-stone-500">把旅行的記帳複製一份過來。旅行日記裡的資料不會被改動。</p>
      <TravelImport />
    </main>
  );
}
