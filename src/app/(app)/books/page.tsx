import Link from "next/link";
import { CloseBookButton, ReopenBookButton } from "@/components/BookForms2";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney, moneyFmt } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { listMyBooks } from "@/server/services/books";
import { bookTotals } from "@/server/services/stats";

/**
 * 帳本管理。
 *
 * 使用中與歷史紀錄分開兩區（規格點 3、15）。歷史帳本**不隱藏、不刪除**，
 * 點進去仍然看得到完整的交易與統計（規格點 16）。
 */
export default async function BooksPage({ searchParams }: PageProps<"/books">) {
  const sp = await searchParams;
  const { user } = await getAppContext();
  const books = await listMyBooks(user.id);
  const live = books.filter((b) => !b.isClosed);
  const closed = books.filter((b) => b.isClosed);
  // 每本帳本的總支出：讓歷史紀錄一眼看得到「那趟花了多少」
  const totals = new Map(
    await Promise.all(books.map(async (b) => [b.id, await bookTotals(b.id, b.homeRate)] as const)),
  );

  const Row = ({ b }: { b: (typeof books)[number] }) => {
    const t = totals.get(b.id);
    return (
      <Card className="space-y-2.5" data-testid="book-card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-stone-800">
              {b.name}
              {b.isActive && <span className="ml-1.5 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] text-brand-700">使用中</span>}
              {b.type === "MAIN" && <span className="ml-1.5 text-[11px] text-stone-400">原帳本</span>}
            </p>
            <p className="mt-0.5 truncate text-xs text-stone-500">
              {b.startOn && `${b.startOn.replaceAll("-", "/")}${b.endOn ? `～${b.endOn.replaceAll("-", "/")}` : ""}・`}
              {b.baseCurrency}
              {b.closedAt && `・${b.closedAt.toISOString().slice(0, 10).replaceAll("-", "/")} 結案`}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="amount text-[15px] text-stone-800">{moneyFmt(b.baseCurrency)(t?.expense ?? 0)}</p>
            {/* V16：外幣帳本在旁邊附一行「約 NT$」，回國之後還是知道花了多少台幣。
                每一筆用它自己記帳當下的匯率換算再加總（bookTotals 算好） */}
            {t?.homeExpense != null && (
              <p className="text-[11px] text-stone-500">約 {formatMoney(t.homeExpense, { symbol: "NT$" })}</p>
            )}
            <p className="text-[11px] text-stone-400">{t?.count ?? 0} 筆</p>
          </div>
        </div>

        {b.isActive && (
          <Link href="/books/edit" className="text-xs font-semibold text-brand-600">帳本設定・匯率・日期 →</Link>
        )}

        {b.isClosed ? (
          <ReopenBookButton bookId={b.id} name={b.name} />
        ) : b.isActive && b.type !== "MAIN" ? (
          <CloseBookButton name={b.name} />
        ) : !b.isActive ? (
          <p className="text-xs text-stone-400">切換到這本帳本後才能結案</p>
        ) : null}
      </Card>
    );
  };

  return (
    <>
      <PageHeader
        title="帳本"
        back="/more"
        right={<Link href="/books/new" className="text-sm font-semibold text-brand-600">＋ 新增</Link>}
      />
      <div className="px-4">
        {sp.deleted === "1" && (
          <div className="mb-3 rounded-2xl border-[1.5px] border-stone-800 bg-stone-100 px-3.5 py-3">
            <p className="text-sm font-bold text-stone-800">已永久刪除</p>
            <p className="mt-1 text-xs text-stone-600">那本帳本與裡面的資料都不在了，目前帳本換回原帳本。</p>
          </div>
        )}
        {sp.closed === "1" && (
          <div className="mb-3 rounded-2xl border-[1.5px] border-brand-500 bg-brand-50 px-3.5 py-3">
            <p className="text-sm font-bold text-brand-700">已結案，資料都還在</p>
            <p className="mt-1 text-xs text-stone-600">那本帳本已經移到下面的「歷史紀錄」，目前帳本換回原帳本了。</p>
          </div>
        )}

        <SectionTitle>使用中</SectionTitle>
        <div className="space-y-2.5">{live.map((b) => <Row key={b.id} b={b} />)}</div>

        {closed.length > 0 && (
          <>
            <SectionTitle>歷史紀錄 ・ {closed.length} 本</SectionTitle>
            <div className="space-y-2.5">{closed.map((b) => <Row key={b.id} b={b} />)}</div>
          </>
        )}

        {live.length === 1 && closed.length === 0 && (
          <Card quiet className="mt-3 p-0">
            <Empty icon="plane" action={<Link href="/books/new" className="text-sm font-semibold text-brand-600">建立旅遊帳本 →</Link>}>
              出國前建一本旅遊帳本，那趟的花費就不會跟日常混在一起
            </Empty>
          </Card>
        )}

        <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          帳本之間的交易、統計、欠款完全分開。<b className="text-stone-700">結案不會刪除任何資料</b> ——
          只是移到歷史紀錄，隨時可以重新開啟。原帳本不能結案。
        </p>
      </div>
    </>
  );
}
