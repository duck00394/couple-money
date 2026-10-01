import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { getAppContext } from "@/server/context";
import { trialRun } from "@/server/services/purchases";

/**
 * 關鍵字試跑。
 *
 * **純唯讀，一筆資料都不會改。** 命中與沒命中都列出來，因為「沒亂抓」跟「有抓到」一樣重要。
 * 這一頁是跨全部作品的，所以落點會寫出「作品 / 角色」——那是必要資訊，不是重複。
 */
export default async function PurchaseTrialPage() {
  const { ctx } = await getAppContext();
  const rows = await trialRun(ctx);
  const hits = rows.filter((r) => r.hit);
  const misses = rows.filter((r) => !r.hit);

  return (
    <>
      <PageHeader title="試跑・全部作品" back="/purchases/manage" />
      <div className="px-4">
        <div className="rounded-2xl border-[1.5px] border-brand-500 bg-brand-50 px-3.5 py-3">
          <p className="text-sm font-bold text-brand-700">這只是模擬，沒有改動任何資料</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-600">
            拿最近 {rows.length} 筆記帳跑一次，看看目前的關鍵字會抓到什麼。關掉這一頁什麼都不會發生。<br />
            這一頁<b>跨全部作品</b>（要看的就是「會不會抓到不該抓的」），所以落點會寫出作品與角色。
          </p>
        </div>

        {rows.length === 0 ? (
          <Empty icon="search">還沒有可以拿來試跑的記帳</Empty>
        ) : (
          <>
            <SectionTitle>會命中 ・ {hits.length} 筆</SectionTitle>
            {hits.length === 0 ? (
              <Empty icon="search">目前的關鍵字一筆都沒抓到</Empty>
            ) : (
              <Card className="divide-y divide-line p-0">
                {hits.map((r) => (
                  <div key={r.transactionId} className="flex items-start gap-2.5 px-4 py-3" data-testid="trial-hit">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-800 bg-brand-500 text-[11px] font-bold text-white">✓</span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.title}</p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        → {r.groupName} / <b className="text-brand-700">{r.tagName}</b>
                        <span className="text-stone-400">　命中「{r.word}」</span>
                      </p>
                    </div>
                  </div>
                ))}
              </Card>
            )}

            <SectionTitle>不會命中 ・ {misses.length} 筆</SectionTitle>
            <Card className="divide-y divide-line p-0">
              {misses.slice(0, 20).map((r) => (
                <div key={r.transactionId} className="flex items-start gap-2.5 px-4 py-3" data-testid="trial-miss">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-300 bg-white text-[11px] font-bold text-stone-400">○</span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-stone-500">{r.title}</p>
                    <p className="mt-0.5 text-xs text-stone-400">沒有任何關鍵字對到</p>
                  </div>
                </div>
              ))}
              {misses.length > 20 && <p className="px-4 py-3 text-center text-xs text-stone-400">還有 {misses.length - 20} 筆沒有列出來</p>}
            </Card>
          </>
        )}

        <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          試跑<b className="text-stone-700">不會</b>把這些舊資料加進購買紀錄。要補舊的請到購買紀錄按「＋ 新增」一筆一筆挑。
        </p>
      </div>
    </>
  );
}
