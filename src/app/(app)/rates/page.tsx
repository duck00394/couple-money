import { RateRow } from "@/components/RateForms";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { getAppContext } from "@/server/context";
import { ratesForSettings } from "@/server/services/rates";
import { currencyOf } from "@/lib/currency";

/**
 * 幣別與匯率設定。
 *
 * 這一頁只做一件事：設定「之後記帳時要用的匯率」。
 * 它**不會**改到任何一筆既有交易 —— 歷史交易的匯率鎖在那筆交易自己身上。
 * 頁面上把這件事講明白，因為這是使用者最容易誤解、而且誤解起來最貴的地方。
 */
export default async function RatesPage() {
  const { ctx } = await getAppContext();
  const rows = await ratesForSettings(ctx);
  const base = currencyOf(ctx.book.baseCurrency);
  const configured = rows.filter((r) => r.rate);
  const rest = rows.filter((r) => !r.rate);

  return (
    <>
      <PageHeader title="幣別與匯率" back="/more" />
      <div className="px-4">
        <Card className="px-4 py-3.5">
          <p className="text-sm text-stone-700">
            本位幣：<b>{base.symbol} {base.code}</b>
            <span className="ml-1.5 text-xs text-stone-500">{base.name}</span>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-stone-600">
            出國時可以直接用當地幣別記帳，系統會依照你設定的匯率換算成{base.name}。
            統計、欠款、結算一律用{base.name}。
          </p>
        </Card>

        <div className="mt-3 rounded-2xl border-[1.5px] border-brand-500 bg-brand-50 px-3.5 py-3">
          <p className="text-sm font-bold text-brand-700">改匯率不會動到已經記過的帳</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-600">
            每一筆交易在建立的當下就把匯率存起來了。之後你把日圓匯率改掉，
            <b className="text-stone-700">之前記的那些日圓消費金額完全不變</b> ——
            只有之後新增的交易會用新匯率。
          </p>
        </div>

        {configured.length > 0 && (
          <>
            <SectionTitle>已設定 ・ {configured.length} 種</SectionTitle>
            <div className="space-y-2.5">
              {configured.map((r) => (
                <RateRow
                  key={r.code}
                  code={r.code}
                  name={r.name}
                  symbol={r.symbol}
                  baseCurrency={ctx.book.baseCurrency}
                  rate={r.rate}
                  suggestedUnits={r.suggestedUnits}
                />
              ))}
            </div>
          </>
        )}

        <SectionTitle>{configured.length > 0 ? "其他幣別" : "設定匯率"}</SectionTitle>
        <div className="space-y-2.5">
          {rest.map((r) => (
            <RateRow
              key={r.code}
              code={r.code}
              name={r.name}
              symbol={r.symbol}
              baseCurrency={ctx.book.baseCurrency}
              rate={r.rate}
              suggestedUnits={r.suggestedUnits}
            />
          ))}
        </div>

        <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          日圓與韓元的數字比較大，所以預設用「100 JPY」「1000 KRW」當單位 ——
          寫成「1 JPY = 0.215」很容易少看一個零。你可以自己改左邊的數量。
        </p>
      </div>
    </>
  );
}
