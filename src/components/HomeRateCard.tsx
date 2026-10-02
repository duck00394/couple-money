"use client";

import { useActionState, useState } from "react";
import { setHomeRateAction } from "@/app/actions/bookEdit";
import { ActionForm } from "./ActionForm";
import { Button, Card, ErrorText, Input } from "./ui";
import { basePerUnit } from "@/server/domain/exchange";

/**
 * 旅遊帳本首頁的匯率小卡。
 *
 * 在日本旅遊打開 App，最想立刻看到的兩件事是「記一筆」與「現在 1 日圓大概多少台幣」。
 * 所以匯率不藏在「更多 → 幣別與匯率」裡面，而是直接出現在首頁，就地就能改。
 *
 * 方向永遠是**外幣 → 台幣**（1 JPY ≈ 0.21 TWD），不會因為這本帳本的本位幣是日圓
 * 就反過來寫成「100 TWD = 476 JPY」—— 使用者只需要回答一個問題：
 * 「1 元當地貨幣，大約多少台幣？」
 *
 * 只顯示這本帳本自己的那一種外幣。要設定其他國家的匯率是「原帳本」的事
 * （在台灣記一筆外幣消費），不是出國記帳的事。
 */
export function HomeRateCard({
  currency,
  rate,
  canWrite,
}: {
  currency: string;
  /** 存起來的整數對：units 個外幣 = minor 個台幣最小單位。null = 還沒設定 */
  rate: { units: number; minor: number } | null;
  canWrite: boolean;
}) {
  const [state, action, pending] = useActionState(setHomeRateAction, undefined);
  const [open, setOpen] = useState(false);
  const value = rate ? basePerUnit({ foreignUnits: rate.units, baseMinor: rate.minor }, "TWD") : "";

  return (
    <Card className="mt-4 px-4 py-3.5" data-testid="home-rate">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-stone-500">匯率</p>
          <p className="amount mt-0.5 truncate text-[19px] text-stone-800" data-testid="home-rate-label">
            {rate ? `1 ${currency} ≈ ${value} TWD` : `還沒設定 ${currency} 匯率`}
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            data-testid="edit-home-rate"
            className="press shrink-0 rounded-full border-[1.5px] border-stone-800 bg-white px-3.5 py-2 text-[13px] font-semibold text-stone-800 shadow-xs"
          >
            {open ? "收起來" : rate ? "修改匯率" : "設定匯率"}
          </button>
        )}
      </div>

      {open && canWrite && (
        <ActionForm action={action} className="mt-3 space-y-2.5 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm font-semibold text-stone-600">1 {currency} =</span>
            <Input
              name="homeRateValue"
              inputMode="decimal"
              defaultValue={value}
              placeholder="0"
              className="flex-1 text-center"
              aria-label={`1 ${currency} 等於多少台幣`}
            />
            <span className="shrink-0 text-sm font-semibold text-stone-600">TWD</span>
          </div>
          <ErrorText>{state?.error}</ErrorText>
          {state?.ok && <p className="text-xs font-semibold text-brand-700">{state.ok}</p>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "儲存中…" : "儲存"}
          </Button>
          {/* 說明只在展開的時候出現 —— 收起來的時候這張卡就只有三行，不佔首頁版面 */}
          <p className="text-[11px] leading-relaxed text-stone-400">
            改匯率只影響之後記的帳。已經記過的那幾筆金額不會變。
          </p>
        </ActionForm>
      )}
    </Card>
  );
}
