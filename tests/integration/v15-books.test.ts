import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as books from "../../src/server/services/books";
import * as ledger from "../../src/server/services/ledger";
import * as transfers from "../../src/server/services/transfers";
import * as purchases from "../../src/server/services/purchases";
import * as rates from "../../src/server/services/rates";
import { EMPTY_FILTER } from "../../src/server/domain/search";
import * as search from "../../src/server/services/search";

const D = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;

/**
 * V15：帳本系統（原帳本／旅遊帳本／歷史紀錄）。
 *
 * 規格點 27 的 Test 1～7 全部在這裡，外加點 28 的財務安全：
 * **帳本隔離是在 server/domain 層保證的，不是靠 UI filter。**
 */
describe("V15：帳本系統", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let tripId: string;

  /** 在指定帳本記一筆支出 */
  const spend = (ctx: books.BookContext, accountId: string, amount: number, title: string) =>
    ledger.createTransaction(ctx, {
      type: "EXPENSE", amount, accountId, categoryId: null, title, note: "", occurredOn: D(10),
      split: { method: "EQUAL", participants: ctx.members.map((m) => ({ userId: m.userId })) },
      clientRequestId: rid(),
    });

  /** 某本帳本第一個屬於這個人的帳戶 */
  const accountOf = async (ctx: books.BookContext, userId: string) =>
    (await ledger.listAccounts(ctx)).find((a) => a.ownerId === userId)!.id;

  before(async () => {
    await reset();
    c = await setupCouple();
  });
  after(() => prisma.$disconnect());

  /* ───────────────────────── 既有相容 ───────────────────────── */

  it("既有帳本自動是 MAIN，而且是 ACTIVE", async () => {
    assert.equal(c.ctxA.book.type, "MAIN");
    assert.equal(c.ctxA.book.status, "ACTIVE");
    assert.equal(c.ctxA.book.closedAt, null);
  });

  it("listMyBooks 一開始只有原帳本，而且就是目前使用中的", async () => {
    const list = await books.listMyBooks(c.aId);
    assert.equal(list.length, 1);
    assert.equal(list[0].type, "MAIN");
    assert.ok(list[0].isActive);
    assert.ok(!list[0].isClosed);
  });

  /* ───────────────────────── 建立旅遊帳本 ───────────────────────── */

  it("建立旅遊帳本：兩個人都自動是成員（不用重新邀請）", async () => {
    const trip = await books.createSecondaryBook(c.ctxA, c.aId, {
      name: "日本旅遊", type: "TRIP", baseCurrency: "JPY",
      startOn: "2026-10-15", endOn: "2026-10-22", note: "東京",
    });
    tripId = trip.id;
    assert.equal(trip.type, "TRIP");
    assert.equal(trip.baseCurrency, "JPY");

    const members = await prisma.bookMember.findMany({ where: { bookId: tripId } });
    assert.equal(members.length, 2, "另一半沒有被帶進旅遊帳本");
    assert.deepEqual(members.map((m) => m.userId).sort(), [c.aId, c.bId].sort());

    // 兩個人都看得到它
    assert.ok((await books.listMyBooks(c.bId)).some((x) => x.id === tripId));
  });

  it("旅遊帳本有自己的最小帳戶組，但**沒有複製原帳本的真實帳戶**", async () => {
    const ctxTrip = await books.loadContext(c.aId, tripId);
    const tripAccounts = await ledger.listAccounts(ctxTrip);
    const mainAccounts = await ledger.listAccounts(c.ctxA);
    // 每人一個錢包 + 共同
    assert.equal(tripAccounts.length, 3);
    assert.equal(tripAccounts.filter((a) => a.ownerId === null).length, 1);
    // 名稱不同 = 不是複製過去的
    const mainNames = new Set(mainAccounts.map((a) => a.name));
    assert.ok(tripAccounts.some((a) => !mainNames.has(a.name)), "帳戶看起來是複製的");
    // 帳戶 id 完全不重疊
    const mainIds = new Set(mainAccounts.map((a) => a.id));
    assert.ok(tripAccounts.every((a) => !mainIds.has(a.id)));
  });

  it("旅遊帳本的分類沿用原帳本的名稱（用起來像共用）", async () => {
    const ctxTrip = await books.loadContext(c.aId, tripId);
    const tripCats = await ledger.listCategories(ctxTrip);
    const mainCats = await ledger.listCategories(c.ctxA);
    assert.deepEqual(tripCats.map((x) => x.name).sort(), mainCats.map((x) => x.name).sort());
    // 但是各自獨立的列（Category 是 bookId scoped）
    assert.ok(tripCats.every((t) => !mainCats.some((m) => m.id === t.id)));
  });

  it("不能用這條路徑建立第二本 MAIN", async () => {
    await rejects(
      books.createSecondaryBook(c.ctxA, c.aId, { name: "假的原帳本", type: "MAIN" as "TRIP" }),
      "BOOK_TYPE",
    );
  });

  it("結束日期不能早於開始日期", async () => {
    await rejects(
      books.createSecondaryBook(c.ctxA, c.aId, { name: "怪日期", type: "TRIP", startOn: "2026-10-20", endOn: "2026-10-01" }),
      "BOOK_DATE",
    );
  });

  /* ───────────────────────── Test 1：資料完全隔離 ───────────────────────── */

  it("Test 1：兩本帳本的交易完全分開", async () => {
    const ctxTrip = await books.loadContext(c.aId, tripId);
    await rates.setRate(ctxTrip, { currency: "TWD", foreignUnits: 1, baseMinor: 100 }).catch(() => {});

    await spend(c.ctxA, c.accA, $(1000), "吉伊卡哇吊娃");
    await spend(ctxTrip, await accountOf(ctxTrip, c.aId), 500, "餐飲"); // JPY 本位幣，500 = ¥500

    const mainList = await ledger.listTransactions(c.ctxA);
    const tripList = await ledger.listTransactions(ctxTrip);
    assert.deepEqual(mainList.map((t) => t.title), ["吉伊卡哇吊娃"]);
    assert.deepEqual(tripList.map((t) => t.title), ["餐飲"]);
    assert.equal(mainList[0].amount, $(1000));
    assert.equal(tripList[0].amount, 500);
  });

  it("統計、餘額、欠款也完全分開", async () => {
    const ctxTrip = await books.loadContext(c.aId, tripId);
    const mainTotals = (await search.searchTransactions(c.ctxA, EMPTY_FILTER, { take: 100 })).totals;
    const tripTotals = (await search.searchTransactions(ctxTrip, EMPTY_FILTER, { take: 100 })).totals;
    assert.equal(mainTotals.netExpense, $(1000));
    assert.equal(tripTotals.netExpense, 500);

    const mainBal = await ledger.getBalances(c.ctxA);
    const tripBal = await ledger.getBalances(ctxTrip);
    assert.equal(mainBal.accounts.get(c.accA), -$(1000));
    assert.equal(tripBal.accounts.get(c.accA), undefined, "旅遊帳本看到了原帳本的帳戶");
    // 欠款各自零和、互不影響
    assert.equal([...mainBal.net.values()].reduce((a, b) => a + b, 0), 0);
    assert.equal([...tripBal.net.values()].reduce((a, b) => a + b, 0), 0);
    assert.equal(mainBal.debts[0]?.amount, $(500));
    assert.equal(tripBal.debts[0]?.amount, 250);
  });

  it("點 28：不能拿別本帳本的帳戶來記帳（server 端擋，不是 UI filter）", async () => {
    const ctxTrip = await books.loadContext(c.aId, tripId);
    // 用原帳本的 accountId 在旅遊帳本記帳 → 查不到這個帳戶
    await rejects(spend(ctxTrip, c.accA, $(100), "偷渡"), "TX_ACCOUNT");
  });

  it("點 28：不是成員就載不到那本帳本的 context", async () => {
    const outsider = await import("../../src/server/services/users").then((m) =>
      m.registerUser({ email: `out-${rid().slice(0, 6)}@example.com`, password: "password123", name: "路人" }),
    );
    await rejects(books.loadContext(outsider.id, tripId), "BOOK_FORBIDDEN");
    await rejects(books.switchBook(outsider.id, tripId), "BOOK_FORBIDDEN");
  });

  /* ───────────────────────── Test 2：切換後記到正確帳本 ───────────────────────── */

  it("Test 2：切換到旅遊帳本之後，記帳自動記進旅遊帳本", async () => {
    await books.switchBook(c.aId, tripId);
    const ctx = (await books.getBookContext(c.aId))!;
    assert.equal(ctx.book.id, tripId, "切換後 getBookContext 沒有回傳旅遊帳本");

    const tx = await spend(ctx, await accountOf(ctx, c.aId), 300, "快速記帳");
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    assert.equal(row.bookId, tripId);

    // 原帳本完全沒變
    assert.equal((await ledger.listTransactions(c.ctxA)).length, 1);
  });

  /* ───────────────────────── Test 3：購買紀錄固定在原帳本 ───────────────────────── */

  it("Test 3：目前在旅遊帳本時，購買紀錄仍然屬於原帳本，而且不會把帳本切走", async () => {
    // 目前是旅遊帳本
    let user = await prisma.user.findUniqueOrThrow({ where: { id: c.aId } });
    assert.equal(user.activeBookId, tripId);

    // 購買紀錄用的是原帳本
    const mainId = await books.mainBookId(c.aId);
    assert.equal(mainId, c.ctxA.book.id);
    const mainCtx = await books.loadContext(c.aId, mainId!);

    await purchases.seedStarter(mainCtx);
    // optionsForForm 一次給作品＋它自己的角色與商品分類
    const opts = await purchases.optionsForForm(mainCtx);
    assert.ok(opts.length > 0);
    const g = opts[0];
    await purchases.addManual(mainCtx, {
      groupId: g.id, categoryId: g.categories[0].id, tagId: g.tags[0].id, ownerId: null,
      title: "吉伊卡哇吊娃", amount: $(680), occurredOn: D(11), note: "",
    });

    // 資料真的在原帳本
    const entries = await prisma.purchaseEntry.findMany({ where: { title: "吉伊卡哇吊娃" } });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].bookId, mainId, "購買紀錄跑到旅遊帳本去了");

    // ★ 最重要：activeBookId 一個字都沒變
    user = await prisma.user.findUniqueOrThrow({ where: { id: c.aId } });
    assert.equal(user.activeBookId, tripId, "操作購買紀錄把目前帳本切走了（規格點 11）");
  });

  it("旅遊帳本的記帳表單不提供「同時加入購買紀錄」", async () => {
    const { loadTxFormOptions } = await import("../../src/server/txFormData");
    const tripCtx = await books.loadContext(c.aId, tripId);
    const mainCtx = await books.loadContext(c.aId, (await books.mainBookId(c.aId))!);
    assert.equal((await loadTxFormOptions(tripCtx)).purchaseGroups.length, 0, "旅遊帳本不該有購買紀錄選項");
    assert.ok((await loadTxFormOptions(mainCtx)).purchaseGroups.length > 0, "原帳本應該要有");
  });

  /* ───────────────────────── Test 4：結案後不能寫 ───────────────────────── */

  it("Test 4：結案之後任何財務寫入都被擋下來（server/domain 層）", async () => {
    const tripCtx = await books.loadContext(c.aId, tripId);
    await books.closeBook(tripCtx, c.aId);

    const closed = await books.loadContext(c.aId, tripId);
    assert.equal(closed.book.status, "CLOSED");
    assert.ok(closed.book.closedAt instanceof Date);
    assert.equal(closed.canWrite, false);

    const acc = (await ledger.listAccounts(closed)).find((a) => a.ownerId === c.aId)!.id;
    const acc2 = (await ledger.listAccounts(closed)).find((a) => a.ownerId === null)!.id;

    await rejects(spend(closed, acc, 500, "結案後還想記"), "BOOK_READ_ONLY");
    await rejects(
      transfers.createTransfer(closed, {
        fromAccountId: acc, toAccountId: acc2, amount: 100,
        occurredOn: D(12), occurredTime: null, note: "", clientRequestId: rid(),
      }),
      "BOOK_READ_ONLY",
    );
    await rejects(
      transfers.createRefund(closed, {
        originalId: (await ledger.listTransactions(closed))[0].id, amount: 100, accountId: acc,
        occurredOn: D(12), occurredTime: null, note: "", clientRequestId: rid(),
      }),
      "BOOK_READ_ONLY",
    );
    await rejects(
      ledger.settle(closed, {
        fromUserId: c.bId, toUserId: c.aId, amount: 100, fromAccountId: acc, toAccountId: acc,
        note: "", clientRequestId: rid(),
      }),
      "BOOK_READ_ONLY",
    );
    await rejects(ledger.createAccount(closed, { name: "新帳戶", type: "CASH", shared: false, openingBalance: 0 }), "BOOK_READ_ONLY");
  });

  it("結案後目前帳本自動切回原帳本（不會停在一本動不了的帳本上）", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.aId } });
    assert.equal(user.activeBookId, await books.mainBookId(c.aId));
  });

  it("Test 6：結案不刪資料，統計與交易都還在", async () => {
    const closed = await books.loadContext(c.aId, tripId);
    const list = await ledger.listTransactions(closed);
    assert.equal(list.length, 2, "結案後交易不見了");
    const totals = (await search.searchTransactions(closed, EMPTY_FILTER, { take: 100 })).totals;
    assert.equal(totals.netExpense, 800); // 500 + 300
    const bal = await ledger.getBalances(closed);
    assert.equal([...bal.net.values()].reduce((a, b) => a + b, 0), 0);
  });

  it("歷史帳本會被排到清單後面，而且標成已結案", async () => {
    const list = await books.listMyBooks(c.aId);
    assert.equal(list[0].type, "MAIN", "原帳本不是第一個");
    const trip = list.find((x) => x.id === tripId)!;
    assert.ok(trip.isClosed);
    assert.equal(list.at(-1)!.id, tripId, "已結案的沒有排到最後");
  });

  it("已結案的帳本仍然可以切換進去看（唯讀）", async () => {
    await books.switchBook(c.aId, tripId);
    const ctx = (await books.getBookContext(c.aId))!;
    assert.equal(ctx.book.id, tripId);
    assert.equal(ctx.canWrite, false, "切進已結案帳本竟然可以寫");
    await books.switchBook(c.aId, (await books.mainBookId(c.aId))!);
  });

  it("不能重複結案", async () => {
    const closed = await books.loadContext(c.aId, tripId);
    await rejects(books.closeBook(closed, c.aId), "BOOK_READ_ONLY");
  });

  /* ───────────────────────── Test 5：重新開啟 ───────────────────────── */

  it("Test 5：重新開啟之後可以記帳，而且自動切換過去", async () => {
    await books.reopenBook(c.aId, tripId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.aId } });
    assert.equal(user.activeBookId, tripId, "重新開啟沒有自動切換過去");

    const ctx = await books.loadContext(c.aId, tripId);
    assert.equal(ctx.book.status, "ACTIVE");
    assert.equal(ctx.book.closedAt, null);
    assert.ok(ctx.canWrite);

    const tx = await spend(ctx, await accountOf(ctx, c.aId), 200, "重新開啟後");
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).bookId, tripId);
  });

  it("沒結案的帳本不能「重新開啟」", async () => {
    await rejects(books.reopenBook(c.aId, tripId), "BOOK_NOT_CLOSED");
  });

  /* ───────────────────────── Test 7：原帳本不能結案 ───────────────────────── */

  it("Test 7：原帳本永遠不能結案", async () => {
    const mainId = (await books.mainBookId(c.aId))!;
    const mainCtx = await books.loadContext(c.aId, mainId);
    await rejects(books.closeBook(mainCtx, c.aId), "BOOK_MAIN_CLOSE");
    // 而且狀態完全沒被動到
    const after = await prisma.book.findUniqueOrThrow({ where: { id: mainId } });
    assert.equal(after.status, "ACTIVE");
    assert.equal(after.closedAt, null);
  });

  /* ───────────────────────── 多本帳本 ───────────────────────── */

  it("可以再建第三本，彼此一樣互不干擾", async () => {
    const mainCtx = await books.loadContext(c.aId, (await books.mainBookId(c.aId))!);
    const korea = await books.createSecondaryBook(mainCtx, c.aId, { name: "韓國旅遊", type: "TRIP", baseCurrency: "KRW" });
    const ctxK = await books.loadContext(c.aId, korea.id);
    await spend(ctxK, await accountOf(ctxK, c.aId), 10000, "韓式烤肉");

    assert.equal((await ledger.listTransactions(ctxK)).length, 1);
    assert.equal((await ledger.listTransactions(mainCtx)).length, 1);
    assert.equal((await ledger.listTransactions(await books.loadContext(c.aId, tripId))).length, 3);

    const list = await books.listMyBooks(c.aId);
    assert.equal(list.length, 3);
    assert.equal(list[0].type, "MAIN");
  });

  it("每本帳本有自己的本位幣與匯率設定", async () => {
    const list = await books.listMyBooks(c.aId);
    assert.equal(list.find((x) => x.name === "日本旅遊")!.baseCurrency, "JPY");
    assert.equal(list.find((x) => x.name === "韓國旅遊")!.baseCurrency, "KRW");
    assert.equal(list.find((x) => x.type === "MAIN")!.baseCurrency, "TWD");
  });

  it("沒有任何帳本被刪除（結案 ≠ 刪除）", async () => {
    const all = await prisma.book.findMany({ where: { deletedAt: null } });
    assert.equal(all.length, 3);
  });
});
