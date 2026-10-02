import Link from "next/link";
import { RateRow } from "@/components/RateForms";
import { HomeRateCard } from "@/components/HomeRateCard";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { getAppContext } from "@/server/context";
import { ratesForSettings } from "@/server/services/rates";
import { HOME_CURRENCY } from "@/server/services/books";
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
  const base = currencyOf(ctx.book.baseCurrency);

  /*
   * 出國用的帳本（本位幣不是台幣）只有一件事要設定：這趟旅行的那一種外幣兌台幣。
   *
   * 一趟旅行通常只去一個國家，所以這裡**不列出其他八種幣別** ——
   * 一長串 USD / KRW / EUR / HKD 會讓旅遊記帳看起來像外匯軟體，
   * 而且那些都不是這本帳本用得到的東西。
   * 真正要在台灣記一筆外幣消費，是「原帳本」的事，在原帳本這一頁設定。
   */
  if (ctx.book.baseCurrency !== HOME_CURRENCY) {
    return (
      <>
        <PageHeader title="匯率" back="/more" />
        <div className="px-4">
          <p className="text-sm leading-relaxed text-stone-600">
            這本帳本用 <b className="text-stone-800">{base.symbol} {base.code}</b>（{base.name}）記帳，
            只需要知道「1 {base.code} 大約多少台幣」。
          </p>
          <HomeRateCard
            currency={ctx.book.baseCurrency}
            rate={ctx.book.homeRate}
            canWrite={ctx.book.status === "ACTIVE"}
          />
          <p className="mt-4 text-center text-xs leading-relaxed text-stone-500">
            這張卡也直接放在
            <Link href="/" className="mx-0.5 underline underline-offset-2">首頁</Link>
            ，旅行中不用進來這裡就能改。
          </p>
        </div>
      </>
    );
  }

  const rows = await ratesForSettings(ctx);
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
            />
          ))}
        </div>

        <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          每一列都是「1 個外幣等於多少{base.name}」，把當天看到的匯率打進去就好，
          小數最多六位（例如 1 JPY = 0.2185 {base.code}）。
          <br />
          如果是出國，建議直接建一本旅遊帳本並選當地幣別 —— 那種帳本的匯率就在首頁，不用進來這一頁。
        </p>
      </div>
    </>
  );
}
