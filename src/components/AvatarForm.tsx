"use client";

import { startTransition, useActionState, useState } from "react";
import { removeAvatarAction, setAvatarAction } from "@/app/actions/avatars";
import { AVATARS, avatarKeyOf, avatarSrc } from "@/lib/avatars";
import { Avatar, cx, ErrorText } from "./ui";

/**
 * 自己的頭貼：從專案內固定的幾張圖片裡挑一張。
 *
 * 沒有上傳、沒有相簿、沒有相機 —— 圖片都是 `public/assets/avatars/` 裡既有的檔案，
 * 點一下就存好，不需要再按第二次確認。只會動到登入者本人的頭貼。
 */
export function AvatarForm({ name, email, color, src }: { name: string; email: string; color: string; src: string | null }) {
  const [open, setOpen] = useState(false);
  const [setState, save, saving] = useActionState(setAvatarAction, undefined);
  const [delState, remove, removing] = useActionState(removeAvatarAction, undefined);
  const busy = saving || removing;
  const current = avatarKeyOf(src);

  const pick = (key: string) => {
    if (busy || key === current) return;
    const fd = new FormData();
    fd.set("key", key);
    startTransition(() => save(fd));
  };

  return (
    <div data-testid="avatar-box">
      <div className="flex items-center gap-3.5">
        <Avatar name={name} color={color} size={56} src={src} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-stone-800">{name}</p>
          <p className="truncate text-xs text-stone-500">{email}</p>
          <div className="mt-1.5 flex items-center gap-3 text-xs">
            <button
              type="button"
              className="font-medium text-brand-600 underline underline-offset-2 disabled:opacity-50"
              onClick={() => setOpen((v) => !v)}
              disabled={busy}
              data-testid="avatar-pick"
            >
              {open ? "收起" : src ? "換頭貼" : "選一個頭貼"}
            </button>
            {src && (
              <form action={remove} className="inline">
                <button className="text-stone-400 underline underline-offset-2 disabled:opacity-50" disabled={busy} data-testid="avatar-remove">
                  移除
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div className="mt-3 rounded-2xl bg-canvas/70 p-3" data-testid="avatar-picker">
          <p className="mb-2 text-xs text-stone-500">點一下就換好，不用再按確認</p>
          <div className="grid grid-cols-5 gap-2.5" role="radiogroup" aria-label="選擇頭貼">
            {AVATARS.map((a) => {
              const on = current === a.key;
              return (
                <button
                  key={a.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={a.label}
                  disabled={busy}
                  onClick={() => pick(a.key)}
                  className={cx(
                    "press aspect-square rounded-full transition disabled:opacity-60",
                    on ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-canvas" : "ring-1 ring-line",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- 固定素材，不走 optimizer */}
                  <img src={avatarSrc(a.key)} alt="" className="h-full w-full rounded-full" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {setState?.ok && <p className="mt-2 text-xs text-brand-700" role="status">{setState.ok}</p>}
      <ErrorText>{setState?.error ?? delState?.error}</ErrorText>
    </div>
  );
}
