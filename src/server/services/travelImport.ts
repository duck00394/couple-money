import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, lockBook } from "../db";
import { assert, DomainError } from "../domain/errors";
import { allocate, formatMoney } from "@/lib/money";
import { createSecondaryBook, listMyBooks, loadContext, switchBook, type BookContext } from "./books";
import { createTransactionIn, type TransactionInput } from "./ledger";

/**
 * 從「旅行日記」匯入一趟旅行的記帳。
 *
 * 兩個 App 不共用資料庫，也不在瀏覽器放金鑰：
 *   旅行 App 簽一張 10 分鐘有效的匯出票（放在網址 # 後面），使用者帶著它打開這裡；
 *   這裡的伺服器拿票向 TRAVEL_DIARY_URL/api/couple-export 取資料（POST，票不進網址、不進 log）。
 * 匯入只是複製：旅行 App 的資料完全不會被改動。
 * 每筆都用 `travel:<旅行消費 id>:<第幾位付款人>` 當 clientRequestId，同一本帳本重複匯入不會重複記帳。
 */

const Part = z.object({ userId: z.string().min(1), twd: z.number().int().nonnegative() });
const Payload = z.object({
  version: z.literal(1),
  source: z.literal("trip-diary"),
  trip: z.object({ id: z.string().min(1), title: z.string(), startDate: z.string(), endDate: z.string() }),
  exporterId: z.string().min(1),
  members: z.array(z.object({ id: z.string().min(1), name: z.string() })).min(1),
  expenses: z.array(
    z.object({
      id: z.string().regex(/^[\w-]{6,60}$/),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      title: z.string().nullable(),
      category: z.string(),
      note: z.string().nullable(),
      currency: z.string(),
      amount: z.number().int().positive(),
      rate: z.number().positive(),
      twd: z.number().int().positive(),
      payers: z.array(Part).min(1),
      shares: z.array(Part).min(1),
    }),
  ),
});
export type TravelPayload = z.infer<typeof Payload>;

const travelUrl = () => (process.env.TRAVEL_DIARY_URL ?? "").replace(/\/+$/, "");
const FAIL = "匯出失敗，旅行資料沒有被刪除。";

/** 拿匯出票向旅行 App 取資料。只記錄錯誤種類，不記錄任何交易內容。 */
export async function fetchTravel(ticket: string, fetcher: typeof fetch = fetch): Promise<TravelPayload> {
  assert(/^https?:\/\//.test(travelUrl()), "TRAVEL_OFF", "還沒設定旅行日記的網址（TRAVEL_DIARY_URL）");
  assert(/^[\w-]+\.[\w-]+$/.test(ticket) && ticket.length < 600, "TRAVEL_TICKET", "匯出連結無效，請回旅行日記重新按「匯出到情侶帳本」");
  let res: Response;
  try {
    res = await fetcher(`${travelUrl()}/api/couple-export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    console.error("travel-import: fetch failed");
    throw new DomainError("TRAVEL_NETWORK", "連不上旅行日記，請稍後再試。旅行資料沒有被改動。");
  }
  if (res.status === 401) throw new DomainError("TRAVEL_TICKET", "匯出連結已過期（10 分鐘），請回旅行日記重新按「匯出到情侶帳本」");
  if (!res.ok) {
    console.error(`travel-import: travel api status ${res.status}`);
    throw new DomainError("TRAVEL_API", FAIL);
  }
  const parsed = Payload.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    console.error("travel-import: payload shape mismatch");
    throw new DomainError("TRAVEL_SHAPE", FAIL);
  }
  return parsed.data;
}

/** 旅行的類別 → 情侶帳本的類別名稱（找不到就用「旅行」，再不行「其他」）。 */
const CATEGORY_MAP: Record<string, string> = { 早餐: "餐飲", 午餐: "餐飲", 晚餐: "餐飲", 點心: "餐飲", 交通: "交通", 購物: "購物", 住宿: "旅行", 門票: "旅行" };
export const tripMarker = (tripId: string) => `travel:${tripId}`;

/**
 * 旅行成員 → 帳本成員：按下匯出的人 = 我，另一位 = 另一半。
 * 情侶帳本只有兩個人，所以超過兩位成員的旅行不能匯入（會講清楚，不會亂對應）。
 */
export function mapMembers(p: TravelPayload, ctx: BookContext): Record<string, string> {
  const others = p.members.filter((m) => m.id !== p.exporterId);
  assert(others.length <= 1, "TRAVEL_MEMBERS", "這趟旅行超過兩個人，情侶帳本只能記兩個人的帳");
  const out: Record<string, string> = { [p.exporterId]: ctx.me.userId };
  if (others[0]) {
    const used = new Set(p.expenses.flatMap((e) => [...e.payers, ...e.shares].filter((x) => x.twd > 0).map((x) => x.userId)));
    if (used.has(others[0].id)) assert(ctx.partner, "TRAVEL_PARTNER", "這本帳本還沒有另一半，無法對應旅伴的付款與分攤");
    if (ctx.partner) out[others[0].id] = ctx.partner.userId;
  }
  return out;
}

/** 一筆旅行消費 → 一或多筆記帳（每位付款人一筆；分攤依比例拆好，加總一定等於原金額）。 */
export function toInputs(
  p: TravelPayload,
  members: Record<string, string>,
  account: (userId: string) => string,
  category: (name: string) => string | null,
): TransactionInput[] {
  const out: TransactionInput[] = [];
  for (const e of p.expenses) {
    const payers = e.payers.filter((x) => x.twd > 0);
    const shares = e.shares.filter((x) => x.twd > 0);
    if (!payers.length || !shares.length) continue;
    const foreign = e.currency !== "TWD" ? `${e.currency} ${formatMoney(e.amount, { symbol: "" })}（匯率 ${+e.rate.toFixed(6)}）` : "";
    const note = [foreign, e.note ?? "", `來自旅行日記「${p.trip.title}」`].filter(Boolean).join("\n").slice(0, 500);
    payers.forEach((payer, i) => {
      const parts = allocate(payer.twd, shares.map((s) => s.twd));
      const byUser = new Map<string, number>();
      shares.forEach((s, k) => {
        const uid = members[s.userId];
        assert(uid, "TRAVEL_MEMBERS", "有一筆消費的分攤對象對應不到帳本成員");
        byUser.set(uid, (byUser.get(uid) ?? 0) + parts[k]);
      });
      const payerUid = members[payer.userId];
      assert(payerUid, "TRAVEL_MEMBERS", "有一筆消費的付款人對應不到帳本成員");
      out.push({
        type: "EXPENSE",
        amount: payer.twd,
        accountId: account(payerUid),
        categoryId: category(e.category),
        title: (e.title || e.category).slice(0, 50),
        note,
        occurredOn: e.date,
        split: { method: "AMOUNT", participants: [...byUser].filter(([, v]) => v > 0).map(([userId, value]) => ({ userId, value })) },
        clientRequestId: `travel:${e.id}:${i}`,
        currency: null,
      });
    });
  }
  return out;
}

/** 匯入頁的預覽：有幾筆、總共多少、之前匯出過的帳本、可以選的帳本。 */
export async function previewTravel(userId: string, ticket: string) {
  const p = await fetchTravel(ticket);
  const books = (await listMyBooks(userId)).filter((b) => !b.isClosed && b.baseCurrency === "TWD");
  const writable: typeof books = [];
  for (const b of books) {
    const ctx = await loadContext(userId, b.id).catch(() => null);
    if (ctx?.canWrite) writable.push(b);
  }
  const previous = writable.find((b) => b.note?.includes(tripMarker(p.trip.id))) ?? null;
  return {
    trip: { title: p.trip.title, startDate: p.trip.startDate, endDate: p.trip.endDate },
    count: p.expenses.length,
    total: p.expenses.reduce((s, e) => s + e.twd, 0),
    suggestedName: `${p.trip.startDate.slice(0, 4)} ${p.trip.title}`.slice(0, 30),
    previousBookId: previous?.id ?? null,
    books: writable.map((b) => ({ id: b.id, name: b.name, type: b.type })),
  };
}

export type ImportTarget = { mode: "new" } | { mode: "existing"; bookId: string };

/**
 * 匯入。整批在同一個資料庫 transaction 裡：只要有一筆失敗，這次一筆都不會寫進去。
 * 「建立新帳本」時，如果這趟之前已經建過帳本，就直接匯進那本（不會出現兩本一樣的）。
 */
export async function importTravel(userId: string, ticket: string, target: ImportTarget) {
  const p = await fetchTravel(ticket);
  assert(p.expenses.length > 0, "TRAVEL_EMPTY", "這趟旅行還沒有可以匯出的記帳");

  let bookId: string;
  if (target.mode === "existing") {
    bookId = target.bookId;
  } else {
    const prev = (await listMyBooks(userId)).find((b) => !b.isClosed && b.note?.includes(tripMarker(p.trip.id)));
    if (prev) bookId = prev.id;
    else {
      const base = await baseContext(userId);
      const book = await createSecondaryBook(base, userId, {
        name: `${p.trip.startDate.slice(0, 4)} ${p.trip.title}`.slice(0, 30),
        type: "TRIP",
        baseCurrency: "TWD",
        startOn: p.trip.startDate,
        endOn: p.trip.endDate,
        note: `從旅行日記匯入（${tripMarker(p.trip.id)}）`,
      });
      bookId = book.id;
    }
  }

  const ctx = await loadContext(userId, bookId);
  assert(ctx.canWrite, "BOOK_READ_ONLY", "這本帳本已結案或你沒有編輯權限，請選別本");
  assert(ctx.book.baseCurrency === "TWD", "TRAVEL_CURRENCY", "只能匯入以新台幣記帳的帳本");
  const members = mapMembers(p, ctx);

  const [accounts, cats] = await Promise.all([
    prisma.account.findMany({ where: { bookId, deletedAt: null, isActive: true, ownerId: { not: null } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.category.findMany({ where: { bookId, kind: "EXPENSE", isArchived: false } }),
  ]);
  const account = (uid: string) => {
    const a = accounts.find((x) => x.ownerId === uid && x.type === "CASH") ?? accounts.find((x) => x.ownerId === uid);
    assert(a, "TRAVEL_ACCOUNT", "帳本裡找不到付款人的帳戶，請先建立一個錢包");
    return a.id;
  };
  const byName = new Map(cats.map((c) => [c.name, c.id]));
  const category = (name: string) => byName.get(name) ?? byName.get(CATEGORY_MAP[name] ?? "") ?? byName.get("旅行") ?? byName.get("其他") ?? null;
  const inputs = toInputs(p, members, account, category);

  const ids = inputs.map((i) => i.clientRequestId);
  const expId = (i: TransactionInput) => i.clientRequestId.split(":")[1];
  let done = new Set<string>();
  try {
    done = await prisma.$transaction(
      async (tx) => {
        await lockBook(tx, bookId);
        const existing = new Set(
          (await tx.transaction.findMany({ where: { bookId, clientRequestId: { in: ids } }, select: { clientRequestId: true } })).map((t) => t.clientRequestId),
        );
        const made = new Set<string>();
        for (const input of inputs) {
          if (existing.has(input.clientRequestId)) continue;
          const t = await createTransactionIn(tx, ctx, input);
          await tx.transaction.update({ where: { id: t.id }, data: { sourceType: "TRAVEL_DIARY", sourceId: p.trip.id } });
          made.add(expId(input));
        }
        return made;
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  } catch (e) {
    if (e instanceof DomainError) throw e;
    // 兩個人同時按匯入：後到的撞唯一鍵，前一個已經寫好了，這次當作全部略過
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) {
      console.error("travel-import: write failed", e instanceof Error ? e.name : "unknown");
      throw new DomainError("TRAVEL_WRITE", FAIL);
    }
  }
  await switchBook(userId, bookId);
  const all = new Set(inputs.map(expId));
  // created：這次新匯入的旅行消費筆數；skipped：之前已經匯入過、這次略過的筆數
  return { bookId, bookName: ctx.book.name, created: done.size, skipped: all.size - done.size };
}

/** 建新帳本要從「一本我能寫的帳本」複製成員與分類：優先目前帳本，其次原帳本。 */
async function baseContext(userId: string): Promise<BookContext> {
  const books = await listMyBooks(userId);
  for (const b of [...books.filter((x) => x.isActive), ...books.filter((x) => x.type === "MAIN"), ...books]) {
    const ctx = await loadContext(userId, b.id).catch(() => null);
    if (ctx?.canWrite) return ctx;
  }
  throw new DomainError("BOOK_NOT_FOUND", "請先在情侶帳本建立帳本");
}
