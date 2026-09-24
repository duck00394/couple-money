"use client";

import { startTransition, useActionState, useRef } from "react";
import { removeAvatarAction, setAvatarAction } from "@/app/actions/avatars";
import { PHOTOS_ENABLED } from "@/config/app";
import { cropSquare } from "./imageCompress";
import { Avatar, ErrorText } from "./ui";

/**
 * 自己的頭貼：換一張、移除。只會動到登入者本人的頭貼。
 * 選好照片後會先在瀏覽器裁成正方形再上傳，所以圓形顯示不會變形。
 */
export function AvatarForm({ name, email, color, src }: { name: string; email: string; color: string; src: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [setState, save, saving] = useActionState(setAvatarAction, undefined);
  const [delState, remove, removing] = useActionState(removeAvatarAction, undefined);
  const busy = saving || removing;

  async function pick(file: File | undefined) {
    if (!file) return;
    const blob = await cropSquare(file);
    const fd = new FormData();
    fd.set("avatar", new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: blob.type || "image/jpeg" }));
    startTransition(() => save(fd));
    if (input.current) input.current.value = "";
  }

  return (
    <div data-testid="avatar-box">
      <div className="flex items-center gap-3.5">
        <Avatar name={name} color={color} size={56} src={src} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-stone-800">{name}</p>
          <p className="truncate text-xs text-stone-500">{email}</p>
          {PHOTOS_ENABLED && (
            <div className="mt-1.5 flex items-center gap-3 text-xs">
              <button
                type="button"
                className="text-brand-600 underline underline-offset-2 disabled:opacity-50"
                onClick={() => input.current?.click()}
                disabled={busy}
                data-testid="avatar-pick"
              >
                {src ? "換頭貼" : "上傳頭貼"}
              </button>
              {src && (
                <form action={remove} className="inline">
                  <button className="text-stone-400 underline underline-offset-2 disabled:opacity-50" disabled={busy} data-testid="avatar-remove">
                    移除
                  </button>
                </form>
              )}
              {busy && <span className="text-stone-400">處理中…</span>}
            </div>
          )}
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label="選擇頭貼照片"
        onChange={(e) => pick(e.currentTarget.files?.[0])}
      />
      <ErrorText>{setState?.error ?? delState?.error}</ErrorText>
      {PHOTOS_ENABLED ? (
        <p className="mt-2 text-[11px] text-stone-400">JPG／PNG／WebP，2MB 以內。會自動裁成正方形，只有你們兩個看得到。</p>
      ) : (
        <p className="mt-2 text-[11px] text-stone-400">這個版本暫時不支援照片上傳。</p>
      )}
    </div>
  );
}
