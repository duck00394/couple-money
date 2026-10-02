"use client";

import { useActionState, useState } from "react";
import { removeRateAction, setRateAction } from "@/app/actions/rates";
import { ActionForm } from "./ActionForm";
import { Button, Card, ErrorText, Input, cx } from "./ui";
import { formatCurrency, minorPerUnit } from "@/lib/currency";
import { parseAmount } from "@/lib/money";

/**
 * 一個幣別的匯率設定列。
 *
 * 畫面刻意用「100 JPY = 21.5 TWD」這種寫法，而不是「JPY 0.215」——
 * 後者日常使用很容易看錯一個零，而這個 App 是出國時單手在用的。
 */
export function RateRow({
  code,
  name,
  symbol,
  baseCurrency,
  rate,
  suggestedUnits,
}: {
  code: string;
  name: string;
  symbol: string;
  baseCurrency: string;
  rate: { foreignUnits: number; baseMinor: number } | null;
  suggestedUnits: number;
}) {
  const [state, action, pending] = useActionState(setRateAction, undefined);
  const [delState, delAction, deleting] = useActionState(removeRateAction, undefined);
  const [units, setUnits] = useState(String(rate?.foreignUnits ?? suggestedUnits));
  const [value, setValue] = useState(
    rate ? String(rate.baseMinor / minorPerUnit(baseCurrency)) : "",
  );

  // 即時預覽：讓人在按儲存之前就看到「這樣設對不對」
  const u = Number(units);
  const v = parseAmount(value);
  const preview =
    Number.isFinite(u) && u > 0 && v !== null && v > 0
      ? `1 ${code} ≈ ${formatCurrency(Math.round(v / u), baseCurrency)}`
      : null;

  return (
    <Card className={cx("space-y-3", rate ? "" : "opacity-95")} data-testid="rate-row">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[15px] font-semibold text-stone-800">
          {symbol} {code}
          <span className="ml-1.5 text-xs font-normal text-stone-500">{name}</span>
        </p>
        {rate ? (
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">已設定</span>
        ) : (
          <span className="text-[11px] text-stone-400">未設定</span>
        )}
      </div>

      <ActionForm action={action} className="space-y-2.5">
        <input type="hidden" name="currency" value={code} />
        {/* 一行就是一句話：「100 JPY = 21.5 TWD」 */}
        <div className="flex items-center gap-2">
          <Input
            name="foreignUnits"
            inputMode="numeric"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            className="w-20 text-center"
            aria-label={`${code} 數量`}
          />
          <span className="shrink-0 text-sm font-semibold text-stone-600">{code} =</span>
          <Input
            name="baseValue"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
            className="flex-1 text-center"
            aria-label={`${code} 兌 ${baseCurrency} 匯率`}
          />
          <span className="shrink-0 text-sm font-semibold text-stone-600">{baseCurrency}</span>
        </div>

        {preview && <p className="text-xs text-stone-500" data-testid="rate-preview">{preview}</p>}
        <ErrorText>{state?.error ?? delState?.error}</ErrorText>
        {state?.ok && <p className="text-xs font-semibold text-brand-700">{state.ok}</p>}

        <div className="flex gap-2">
          <Button type="submit" disabled={pending} className="flex-1">
            {pending ? "儲存中…" : rate ? "更新匯率" : "設定匯率"}
          </Button>
        </div>
      </ActionForm>

      {rate && (
        <ActionForm action={delAction}>
          <input type="hidden" name="currency" value={code} />
          <button
            type="submit"
            disabled={deleting}
            className="text-xs text-stone-400 underline-offset-2 hover:underline"
          >
            {deleting ? "移除中…" : "移除這個幣別"}
          </button>
        </ActionForm>
      )}
    </Card>
  );
}
