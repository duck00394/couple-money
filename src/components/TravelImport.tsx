"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importTravelAction, previewTravelAction } from "@/app/actions/travelImport";
import { formatMoney } from "@/lib/money";
import { Button, Card, ErrorText, LinkButton, Select } from "./ui";

type Preview = Awaited<ReturnType<typeof import("@/server/services/travelImport").previewTravel>>;
const KEY = "cm_travel_ticket";
const FAIL = "匯出失敗，旅行資料沒有被刪除。";

function readTicket() {
  try {
    const hash = window.location.hash.slice(1);
    if (hash) {
      sessionStorage.setItem(KEY, hash);
      // 讀完就從網址拿掉，避免被複製、分享或留在瀏覽紀錄
      history.replaceState(null, "", window.location.pathname);
      return hash;
    }
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return window.location.hash.slice(1);
  }
}

export function TravelImport() {
  const router = useRouter();
  const ticket = useRef("");
  const busy = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [bookId, setBookId] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ created: number; skipped: number; bookName: string } | null>(null);

  useEffect(() => {
    (async () => {
      ticket.current = readTicket();
      if (!ticket.current) {
        setError("找不到匯出連結，請回旅行日記按「匯出到情侶帳本」。");
        return setLoading(false);
      }
      try {
        const r = await previewTravelAction(ticket.current);
        if ("login" in r) return router.push("/login?next=/import/travel");
        if ("error" in r) setError(r.error ?? FAIL);
        if ("preview" in r && r.preview) {
          setPreview(r.preview);
          const first = r.preview.previousBookId ?? r.preview.books[0]?.id ?? "";
          setBookId(first);
          if (r.preview.previousBookId) setMode("existing");
        }
      } catch {
        setError("連線失敗，請再試一次。旅行資料沒有被改動。");
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    if (busy.current) return; // 連點只會送一次
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const r = await importTravelAction(ticket.current, mode === "existing" ? { mode, bookId } : { mode: "new" });
      if ("login" in r) return router.push("/login?next=/import/travel");
      if ("error" in r) setError(r.error ?? FAIL);
      if ("result" in r && r.result) {
        setDone(r.result);
        try { sessionStorage.removeItem(KEY); } catch {}
      }
    } catch {
      setError(`${FAIL}（連線中斷：可以直接再按一次，已匯入的不會重複）`);
    }
    busy.current = false;
    setSaving(false);
  }

  if (loading) return <Card className="mt-6 text-sm text-stone-500">讀取旅行資料中…</Card>;

  if (done)
    return (
      <Card className="mt-6 space-y-3" data-testid="travel-import-done">
        <p className="text-lg font-bold text-stone-800">已匯出 {done.created} 筆記帳</p>
        {done.skipped > 0 && <p className="text-sm text-stone-500">另外 {done.skipped} 筆之前已經匯入過，這次略過，不會重複。</p>}
        <p className="text-sm text-stone-500">帳本：{done.bookName}</p>
        <LinkButton href="/transactions" className="w-full">查看情侶帳本</LinkButton>
      </Card>
    );

  if (!preview)
    return (
      <div className="mt-6 space-y-3">
        <ErrorText>{error || FAIL}</ErrorText>
        <LinkButton href="/" variant="secondary" className="w-full">回情侶帳本</LinkButton>
      </div>
    );

  const total = formatMoney(preview.total, { symbol: "NT$" });
  return (
    <div className="mt-6 space-y-4">
      <Card className="space-y-1" data-testid="travel-import-preview">
        <p className="font-bold text-stone-800">{preview.trip.title}</p>
        <p className="text-sm text-stone-500">{preview.trip.startDate} ～ {preview.trip.endDate}</p>
        <p className="text-sm text-stone-700">{preview.count} 筆記帳・共 {total}（已換成台幣，換匯不算）</p>
      </Card>

      {preview.count === 0 ? (
        <ErrorText>這趟旅行還沒有可以匯出的記帳。</ErrorText>
      ) : (
        <Card className="space-y-3">
          <p className="font-semibold text-stone-800">要匯出這趟旅行的記帳嗎？</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" checked={mode === "new"} onChange={() => setMode("new")} />
            建立新帳本「{preview.suggestedName}」
          </label>
          {preview.books.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="mode" checked={mode === "existing"} onChange={() => setMode("existing")} />
                匯入現有帳本
              </label>
              {mode === "existing" && (
                <Select value={bookId} onChange={(e) => setBookId(e.target.value)} aria-label="選擇帳本">
                  {preview.books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.id === preview.previousBookId ? "（上次匯出到這本）" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </>
          )}
          <p className="text-xs leading-relaxed text-stone-500">
            付款人與分攤會照旅行裡的設定；按下匯出的人對應到你，旅伴對應到另一半。外幣以記帳當時鎖定的匯率換成台幣，原幣金額寫在備註。
          </p>
          <ErrorText>{error}</ErrorText>
          <Button className="w-full" disabled={saving} onClick={run}>
            {saving ? "匯出中…" : `匯出 ${preview.count} 筆記帳`}
          </Button>
        </Card>
      )}
    </div>
  );
}
