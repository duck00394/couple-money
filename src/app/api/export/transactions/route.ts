import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { getBookContext } from "@/server/services/books";
import { parseFilter } from "@/server/domain/search";
import { contentDisposition, csvFileName } from "@/server/domain/csv";
import { exportTransactionsCsv, recordExport } from "@/server/services/export";
import { toDateKey } from "@/lib/dates";

/**
 * 匯出目前搜尋條件下的記帳（CSV）。
 * 條件用的是與記帳頁完全相同的網址參數與 parseFilter()，不另外接受帳本 id：
 * 匯出範圍一律是「登入者目前的帳本」，跨帳本不可能匯出。
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const ctx = await getBookContext(user.id);
  if (!ctx) return new Response("Not found", { status: 404 });

  const filter = parseFilter(Object.fromEntries(req.nextUrl.searchParams.entries()));
  const { csv, count } = await exportTransactionsCsv(ctx, filter);
  await recordExport(ctx, { count, filter });

  const today = toDateKey(new Date());
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(csvFileName("transactions", today), csvFileName("交易明細", today)),
      "Cache-Control": "no-store",
      "X-Export-Count": String(count),
    },
  });
}
