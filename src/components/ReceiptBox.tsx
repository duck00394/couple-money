"use client";

import { startTransition, useActionState, useState } from "react";
import { addReceiptAction, removeReceiptAction } from "@/app/actions/receipts";
import { PHOTOS_ENABLED } from "@/config/app";
import { compressImage } from "./imageCompress";
import { Button, Card, ErrorText } from "./ui";

export interface Receipt {
  id: string;
  fileName: string;
}

/**
 * 記帳收據照片：看、加、刪。
 * 縮圖用 /api/files/[id]（上傳前已在瀏覽器壓到 ≤1280px），點一下才全螢幕放大。
 * 記帳列表不會載入任何圖片。
 */
export function ReceiptBox({ transactionId, receipts, max, canWrite }: {
  transactionId: string;
  receipts: Receipt[];
  max: number;
  canWrite: boolean;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  const [addState, add, adding] = useActionState(addReceiptAction, undefined);
  const [delState, remove, deleting] = useActionState(removeReceiptAction, undefined);
  const busy = adding || deleting;
  const full = receipts.length >= max;
  // 照片功能關閉（例如部署在沒有持久硬碟的平台）時，完全不顯示這個區塊
  if (!PHOTOS_ENABLED && receipts.length === 0) return null;

  async function pick(file: File | undefined) {
    if (!file) return;
    const blob = await compressImage(file);
    const fd = new FormData();
    fd.set("transactionId", transactionId);
    fd.set("receipt", new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: blob.type || "image/jpeg" }));
    startTransition(() => add(fd));
  }

  return (
    <Card className="space-y-2" data-testid="receipt-box">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-stone-800">收據照片</p>
        <span className="text-[11px] text-stone-400">{PHOTOS_ENABLED ? `${receipts.length}／${max}` : "唯讀"}</span>
      </div>

      {receipts.length === 0 ? (
        <p className="text-xs text-stone-500">還沒有收據。拍一張存起來，之後對帳或退貨找得到。</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {receipts.map((r) => (
            <li key={r.id} className="relative">
              <button type="button" onClick={() => setZoom(r.id)} aria-label={`放大收據 ${r.fileName}`} data-testid="receipt-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${r.id}`} alt={`收據 ${r.fileName}`} className="h-20 w-20 rounded-2xl border border-stone-200 object-cover" />
              </button>
              {canWrite && (
                <form
                  action={remove}
                  className="absolute -right-1.5 -top-1.5"
                  onSubmit={(e) => {
                    if (!confirm("刪除這張收據？記帳本身不會被刪除。")) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-700/85 text-xs text-white shadow-sm disabled:opacity-50"
                    disabled={busy}
                    aria-label={`刪除收據 ${r.fileName}`}
                    data-testid="receipt-delete"
                  >
                    ✕
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && PHOTOS_ENABLED && (
        <label className="block">
          <span className="sr-only">加一張收據</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="加一張收據"
            data-testid="receipt-input"
            disabled={busy || full}
            className="block w-full text-xs file:mr-3 file:rounded-full file:border-0 file:bg-stone-100 file:px-3.5 file:py-2 file:text-stone-600 disabled:opacity-50"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = ""; // 同一張照片再選一次也會觸發
              void pick(f);
            }}
          />
        </label>
      )}
      {full && <p className="text-[11px] text-stone-400">已經有 {max} 張了，要再加請先刪掉一張。</p>}
      {adding && <p className="text-xs text-stone-500" role="status">上傳中…</p>}
      <ErrorText>{addState?.error ?? delState?.error}</ErrorText>
      <p className="text-[11px] text-stone-400">收據只是附件，不會影響金額、統計或誰欠誰。</p>

      {zoom && (
        <div
          className="fade fixed inset-0 z-50 flex items-center justify-center bg-stone-900/90 p-4"
          role="dialog"
          aria-label="收據照片"
          data-testid="receipt-zoom"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${zoom}`} alt="收據照片（放大）" className="max-h-full max-w-full rounded-xl object-contain" />
          <Button type="button" variant="secondary" className="absolute bottom-6 left-1/2 -translate-x-1/2" onClick={() => setZoom(null)}>關閉</Button>
        </div>
      )}
    </Card>
  );
}
