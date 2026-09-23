"use client";

import { startTransition, useActionState, useState } from "react";
import { cancelCheckInAction, checkInAction, editCheckInAction, reviewCheckInAction, waivePenaltyAction } from "@/app/actions/tasks";
import { PHOTOS_ENABLED } from "@/config/app";
import { compressImage } from "./imageCompress";
import { showToast } from "./Toast";
import { Button, cx, ErrorText, inputClass } from "./ui";

type Result = Awaited<ReturnType<typeof checkInAction>>;
/** 包一層：成功或失敗都顯示提示（按鈕所在的列可能在重新整理後消失）。 */
const withToast = (fn: (prev: Result, fd: FormData) => Promise<Result>) => async (prev: Result, fd: FormData) => {
  const r = await fn(prev, fd);
  if (r?.ok) showToast(r.ok);
  if (r?.error) showToast(r.error, "error");
  return r;
};

function PhotoPicker({ onChange, preview, required }: { onChange: (b: Blob | null, url: string | null) => void; preview: string | null; required: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-stone-600">照片{required ? "（必填）" : "（選填）"}</span>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="打卡照片預覽" className="mb-2 max-h-48 rounded-xl object-cover" />
      ) : null}
      <input
        type="file"
        accept="image/*"
        aria-label="上傳照片"
        className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-stone-100 file:px-4 file:py-2"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return onChange(null, null);
          const blob = await compressImage(f);
          onChange(blob, URL.createObjectURL(blob));
        }}
      />
    </label>
  );
}

export function QuickCheckIn({ taskId, title }: { taskId: string; title: string }) {
  const [state, action, busy] = useActionState(withToast(checkInAction), undefined);
  return (
    <div className="flex flex-col items-end">
      <form action={action}>
        <input type="hidden" name="taskId" value={taskId} />
        <button className="rounded-full bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white active:bg-brand-600 disabled:bg-brand-200" disabled={busy} aria-label={`打卡 ${title}`}>
          {busy ? "…" : "打卡"}
        </button>
      </form>
      {(state?.error || state?.ok) && <span className={cx("mt-1 max-w-44 text-right text-[11px]", state.error ? "text-red-600" : "text-emerald-700")} role="status">{state.error ?? state.ok}</span>}
    </div>
  );
}

/** 任務詳細頁的打卡面板：打卡（備註＋照片）、修改、取消。 */
export function CheckInPanel({ taskId, requiresPhoto: requiresPhotoProp, existing, canCancel }: {
  taskId: string;
  requiresPhoto: boolean;
  existing: { id: string; status: string; note: string | null; photoId: string | null } | null;
  canCancel: boolean;
}) {
  // 照片功能關閉時，「需要照片」的任務也要能打卡（不然會卡死）
  const requiresPhoto = requiresPhotoProp && PHOTOS_ENABLED;
  const [note, setNote] = useState(existing?.note ?? "");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(existing?.photoId ? `/api/files/${existing.photoId}` : null);
  const [editing, setEditing] = useState(false);
  const [state, action, busy] = useActionState(withToast(checkInAction), undefined);
  const [editState, editAction, editing2] = useActionState(withToast(editCheckInAction), undefined);
  const [cancelState, cancelAction, cancelling] = useActionState(withToast(cancelCheckInAction), undefined);

  const active = existing && (existing.status === "PENDING" || existing.status === "APPROVED");
  const submit = (fn: (fd: FormData) => void, extra: Record<string, string>) => {
    const fd = new FormData();
    Object.entries(extra).forEach(([k, v]) => fd.set(k, v));
    fd.set("note", note);
    if (photo) fd.set("photo", new File([photo], "photo.jpg", { type: photo.type || "image/jpeg" }));
    startTransition(() => fn(fd));
  };

  if (active && !editing) {
    return (
      <div className="space-y-3">
        <p className={cx("rounded-xl px-3 py-2 text-sm font-semibold", existing.status === "APPROVED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")} data-testid="checkin-status">
          {existing.status === "APPROVED" ? "✓ 今天已完成" : "⏳ 已打卡，等另一半確認"}
        </p>
        {existing.note && <p className="text-sm text-stone-600">備註：{existing.note}</p>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {existing.photoId && <img src={`/api/files/${existing.photoId}`} alt="打卡照片" className="max-h-48 rounded-xl object-cover" />}
        {state?.ok && <p className="text-sm text-emerald-700" role="status">{state.ok}</p>}
        {editState?.ok && <p className="text-sm text-emerald-700">{editState.ok}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>修改</Button>
          {canCancel && (
            <Button type="button" variant="danger" disabled={cancelling} onClick={() => { if (confirm("取消打卡？這次的獎金與里程碑會收回。")) submit(cancelAction, { id: existing.id }); }}>
              取消打卡
            </Button>
          )}
        </div>
        <ErrorText>{cancelState?.error}</ErrorText>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {existing?.status === "REJECTED" && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">上次打卡被退回，可以重新打卡</p>}
      {existing?.status === "CANCELLED" && <p className="rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-600">今天的打卡已取消，可以重新打卡</p>}
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-stone-600">備註（選填）</span>
        <textarea aria-label="打卡備註" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} rows={2} className={cx(inputClass, "h-auto py-2.5")} />
      </label>
      {PHOTOS_ENABLED && <PhotoPicker required={requiresPhoto} preview={preview} onChange={(b, url) => { setPhoto(b); setPreview(url); }} />}
      <ErrorText>{state?.error ?? editState?.error}</ErrorText>
      {editing && active ? (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={() => setEditing(false)}>取消修改</Button>
          <Button type="button" disabled={editing2} onClick={() => { submit(editAction, { id: existing.id }); setEditing(false); }}>儲存</Button>
        </div>
      ) : (
        <Button type="button" className="w-full" disabled={busy || (requiresPhoto && !photo)} onClick={() => submit(action, { taskId })}>
          {busy ? "打卡中…" : "✓ 完成打卡"}
        </Button>
      )}
      {state?.ok && <p className="text-sm text-emerald-700" role="status">{state.ok}</p>}
    </div>
  );
}

export function ReviewButtons({ id, label }: { id: string; label?: string }) {
  const [state, action, busy] = useActionState(reviewCheckInAction, undefined);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="approve" value="false" />
          <button className="rounded-full bg-stone-100 px-3 py-1.5 text-xs" disabled={busy} aria-label={`退回 ${label ?? ""}`.trim()}>退回</button>
        </form>
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="approve" value="true" />
          <button className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white" disabled={busy} aria-label={`確認完成 ${label ?? ""}`.trim()}>確認完成</button>
        </form>
      </div>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </div>
  );
}

export function WaivePenaltyButton({ id }: { id: string }) {
  const [state, action, busy] = useActionState(waivePenaltyAction, undefined);
  return (
    <form action={action} onSubmit={(e) => { if (!confirm("免除這次懲罰？扣款會退回基金。")) e.preventDefault(); }} className="text-right">
      <input type="hidden" name="id" value={id} />
      <button className="text-xs text-brand-600 underline" disabled={busy}>免除</button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
