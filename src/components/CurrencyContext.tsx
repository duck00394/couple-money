"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { moneyFmt } from "@/lib/money";

/**
 * 目前帳本的本位幣。
 *
 * Client Component 沒辦法拿到 server 端的 BookContext，又不想每個元件都 prop drilling，
 * 所以在 (app)/layout.tsx 放一個 Provider，底下任何元件用 `useMoney()` 就能拿到
 * 已經綁好幣別的格式化函式。切換帳本時 layout 會重新渲染，值自然跟著換。
 */
const Ctx = createContext<string>("TWD");

export function CurrencyProvider({ currency, children }: { currency: string; children: ReactNode }) {
  return <Ctx.Provider value={currency}>{children}</Ctx.Provider>;
}

/** 目前帳本的本位幣代碼。 */
export const useCurrency = () => useContext(Ctx);

/** 已經綁好本位幣的 formatMoney。 */
export function useMoney() {
  const currency = useCurrency();
  return useMemo(() => moneyFmt(currency), [currency]);
}
