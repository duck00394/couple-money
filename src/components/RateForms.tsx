"use client";

import { useActionState, useState } from "react";
import { removeRateAction, setRateAction } from "@/app/actions/rates";
import { ActionForm } from "./ActionForm";
import { Button, Card, ErrorText, Input, cx } from "./ui";
import { formatCurrency, minorPerUnit } from "@/lib/currency";
import { basePerUnit, parseRatePair, toBaseAmount } from "@/server/domain/exchange";

/**
 * 一個幣別的匯率設定列。
 *
 * 一列就是一句話，而且方向固定：**1 個外幣等於多少本位幣**。
 *
 *   1 JPY = [0.22] TWD
 *
 * 左邊永遠是 1，不給改 —— 出國看到的牌告就是這個方向，少一個欄位就少一次誤填。
 * 需要更細的匯率直接多打小數（1 JPY = 0.2185 TWD），存法會自己處理（見 exchange.ts）。
 */
export function RateRow({
  code,
  name,
  symbol,
  baseCurrency,
  rate,
}: {
  code: string;
  name: string;
  symbol: string;
  baseCurrency: string;
  rate: { foreignUnits: number; baseMinor: number } | null;
}) {
  const [state, action, pending] = useActionState(setRateAction, undefined);
  const [delState, delAction, deleting] = useActionState(removeRateAction, undefined);
  const [value, setValue] = useState(rate ? basePerUnit(rate, baseCurrency) : "");

  /*
   * 即時預覽：拿 100 個外幣當例子，確認方向沒有填反。
   *
   * 方向永遠是**外幣 → 本位幣**，不會反過來寫成「100 TWD = 476 JPY」——
   * 使用者只需要回答一個問題：「1 元當地貨幣，大約多少台幣？」
   */
  const pair = parseRatePair(value, baseCurrency);
  const sample = 100 * minorPerUnit(code);
  const preview = pair
    ? `${formatCurrency(sample, code)} ≈ ${formatCurrency(toBaseAmount(sample, { currency: code, ...pair }), baseCurrency)}`
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
        {/* 一行就是一句話：「1 JPY = 0.22 TWD」 */}
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm font-semibold text-stone-600">1 {code} =</span>
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
