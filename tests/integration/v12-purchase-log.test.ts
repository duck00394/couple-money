import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import * as purchases from "../../src/server/services/purchases";
import * as users from "../../src/server/services/users";
import * as books from "../../src/server/services/books";
import { JOINT } from "../../src/server/domain/purchase";

const D = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;

/**
 * V12：購買紀錄。
 *
 * 規格要求的 19 項全部在這裡。最重要的一條貫穿全部：
 * 購買紀錄怎麼動，帳戶餘額、欠款、分帳、基金、預算、統計都不可以有任何變化。
 */
describe("V12：購買紀錄", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let chiikawa: string;
  let haikyu: string;

  /** 記一筆消費，回傳交易 */
  const expense = (title: string, amount: number, day = 10, merchant = "") =>
    ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount, accountId: c.accA, categoryId: null,
      title, note: "", occurredOn: D(day),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
      clientRequestId: rid(),
      ...(merchant ? {} : {}),
    });

  /** 這個帳本的預設商品分類（整本共用） */
  const anyCat = async () => (await prisma.purchaseCategory.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, isDefault: true } })).id;

  const tagsOf = async (groupId: string) =>
    prisma.purchaseTag.findMany({ where: { groupId }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] });

  const defaultTag = async (groupId: string) => (await tagsOf(groupId)).find((t) => t.isDefault)!;
  const tagNamed = async (groupId: string, name: string) => (await tagsOf(groupId)).find((t) => t.name === name)!;

  /** 全部財務推導值的快照，用來證明購買紀錄完全不影響它們 */
  const financeSnapshot = async () => {
    const b = await ledger.getBalances(c.ctxA);
    return JSON.stringify({
      accounts: [...b.accounts.entries()].sort(),
      net: [...b.net.entries()].sort(),
      debts: b.debts,
    });
  };

  before(async () => {
    await reset();
    c = await setupCouple();
    await ledger.createTransaction(c.ctxA, {
      type: "INCOME", amount: $(50000), accountId: c.accA, categoryId: null,
      title: "入帳", note: "", occurredOn: D(1),
      split: { method: "FULL", participants: [{ userId: c.aId }] }, clientRequestId: rid(),
    });
  });
  after(async () => {
    await prisma.$disconnect();
  });

  it("0. 建立作品時，同一個 transaction 內就產生預設角色", async () => {
    const g = await purchases.createGroup(c.ctxA, { name: "吉伊卡哇" });
    chiikawa = g.id;
    const tags = await tagsOf(chiikawa);
    assert.equal(tags.length, 1);
    assert.equal(tags[0].isDefault, true);
    assert.equal(tags[0].name, purchases.DEFAULT_TAG_NAME);

    const g2 = await purchases.createGroup(c.ctxA, { name: "排球少年" });
    haikyu = g2.id;
    assert.equal((await tagsOf(haikyu)).filter((t) => t.isDefault).length, 1);

    await purchases.createTag(c.ctxA, chiikawa, "小八");
    await purchases.createTag(c.ctxA, chiikawa, "兔兔");
    await purchases.createTag(c.ctxA, chiikawa, "吉伊");
    assert.equal((await tagsOf(chiikawa)).length, 4);
  });

  it("18. 不變式：同一個作品不可能有第二個預設角色（資料庫層擋住）", async () => {
    const extra = await tagNamed(chiikawa, "小八");
    await assert.rejects(
      prisma.purchaseTag.update({ where: { id: extra.id }, data: { isDefault: true } }),
      (e: unknown) => String(e).includes("PurchaseTag_one_default_per_group") || String(e).includes("Unique constraint"),
      "partial unique index 應該擋下第二個 default",
    );
    assert.equal((await tagsOf(chiikawa)).filter((t) => t.isDefault).length, 1);
  });

  it("1. owner = null 代表共同", async () => {
    const t = await expense("吉伊卡哇一番賞", $(250), 10);
    await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: chiikawa, categoryId: await anyCat(), tagId: (await defaultTag(chiikawa)).id, ownerId: null,
    });
    const e = await purchases.entryOfTransaction(c.ctxA, t.id);
    assert.equal(e!.ownerId, null);
    assert.equal(e!.amount, $(250));
  });

  it("2. owner = A", async () => {
    const t = await expense("小八吊飾", $(350), 11);
    await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: chiikawa, categoryId: await anyCat(), tagId: (await tagNamed(chiikawa, "小八")).id, ownerId: c.aId,
    });
    assert.equal((await purchases.entryOfTransaction(c.ctxA, t.id))!.ownerId, c.aId);
  });

  it("3. owner = B", async () => {
    const t = await expense("兔兔玩偶", $(540), 12);
    await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: chiikawa, categoryId: await anyCat(), tagId: (await tagNamed(chiikawa, "兔兔")).id, ownerId: c.bId,
    });
    assert.equal((await purchases.entryOfTransaction(c.ctxA, t.id))!.ownerId, c.bId);
  });

  it("4. 不允許 owner 指向別的帳本的成員", async () => {
    const outsider = await users.registerUser({ email: `out-${rid().slice(0, 6)}@example.com`, password: "password123", name: "路人" });
    await books.createBook(outsider.id, { name: "別人的帳本", nickname: "路人" });
    const t = await expense("別人的東西", $(100), 13);

    await rejects(
      purchases.addFromTransaction(c.ctxA, t.id, {
        groupId: chiikawa, categoryId: await anyCat(), tagId: (await defaultTag(chiikawa)).id, ownerId: outsider.id,
      }),
      "PURCHASE_OWNER",
    );
    await rejects(
      purchases.addManual(c.ctxA, {
        groupId: chiikawa, categoryId: await anyCat(), tagId: (await defaultTag(chiikawa)).id, ownerId: outsider.id,
        title: "手動的", amount: $(100), occurredOn: D(13),
      }),
      "PURCHASE_OWNER",
    );
    // 連隨便一個不存在的 id 也要擋
    await rejects(
      purchases.addManual(c.ctxA, {
        groupId: chiikawa, categoryId: await anyCat(), tagId: (await defaultTag(chiikawa)).id, ownerId: "not-a-real-user",
        title: "假的", amount: $(100), occurredOn: D(13),
      }),
      "PURCHASE_OWNER",
    );
    assert.equal(await prisma.purchaseEntry.count({ where: { ownerId: outsider.id } }), 0);
  });

  it("5+6. 歸屬 + 角色雙重篩選，件數與金額跟著變", async () => {
    // 再補幾筆，讓每個組合都有資料
    await purchases.addManual(c.ctxA, {
      groupId: chiikawa, categoryId: await anyCat(), tagId: (await tagNamed(chiikawa, "小八")).id, ownerId: c.aId,
      title: "ハチワレ 馬克杯", amount: $(420), occurredOn: D(5),
    });
    await purchases.addManual(c.ctxA, {
      groupId: chiikawa, categoryId: await anyCat(), tagId: (await tagNamed(chiikawa, "小八")).id, ownerId: null,
      title: "小八抱枕", amount: $(320), occurredOn: D(6),
    });

    const all = await purchases.getGroupDetail(c.ctxA, chiikawa);
    assert.equal(all.totals.count, 5, "全部：250 + 350 + 540 + 420 + 320");
    assert.equal(all.totals.amount, $(250 + 350 + 540 + 420 + 320));

    const joint = await purchases.getGroupDetail(c.ctxA, chiikawa, { owner: JOINT });
    assert.equal(joint.totals.count, 2, "共同：一番賞 + 小八抱枕");
    assert.equal(joint.totals.amount, $(250 + 320));

    const amy = await purchases.getGroupDetail(c.ctxA, chiikawa, { owner: c.aId });
    assert.equal(amy.totals.count, 2, "小艾：小八吊飾 + 馬克杯");
    assert.equal(amy.totals.amount, $(350 + 420));

    const ben = await purchases.getGroupDetail(c.ctxA, chiikawa, { owner: c.bId });
    assert.equal(ben.totals.count, 1);
    assert.equal(ben.totals.amount, $(540));

    // 兩個維度同時套用
    const hachi = await tagNamed(chiikawa, "小八");
    const amyHachi = await purchases.getGroupDetail(c.ctxA, chiikawa, { owner: c.aId, tagId: hachi.id });
    assert.equal(amyHachi.totals.count, 2, "小艾 + 小八");
    assert.equal(amyHachi.totals.amount, $(350 + 420));

    const jointHachi = await purchases.getGroupDetail(c.ctxA, chiikawa, { owner: JOINT, tagId: hachi.id });
    assert.equal(jointHachi.totals.count, 1, "共同 + 小八");
    assert.equal(jointHachi.totals.amount, $(320));

    // 三個歸屬加起來等於全部
    assert.equal(joint.totals.count + amy.totals.count + ben.totals.count, all.totals.count);
    assert.equal(joint.totals.amount + amy.totals.amount + ben.totals.amount, all.totals.amount);
  });

  it("7. 預設角色不可刪除，但可以改名", async () => {
    const def = await defaultTag(chiikawa);
    await rejects(purchases.deleteTag(c.ctxA, def.id), "PURCHASE_TAG_DEFAULT");
    assert.ok(await prisma.purchaseTag.findUnique({ where: { id: def.id } }));

    await purchases.renameTag(c.ctxA, def.id, "未分類");
    const after = await prisma.purchaseTag.findUniqueOrThrow({ where: { id: def.id } });
    assert.equal(after.name, "未分類");
    assert.equal(after.isDefault, true, "改名之後仍然是預設角色");
    // 改回來，後面的測試比較好讀
    await purchases.renameTag(c.ctxA, def.id, purchases.DEFAULT_TAG_NAME);
  });

  it("8+9. 刪除一般角色：紀錄轉到預設角色，ownerId 原封不動", async () => {
    const hachi = await tagNamed(chiikawa, "小八");
    const def = await defaultTag(chiikawa);
    const beforeEntries = await prisma.purchaseEntry.findMany({ where: { tagId: hachi.id }, orderBy: { createdAt: "asc" } });
    assert.equal(beforeEntries.length, 3);
    const beforeOwners = beforeEntries.map((e) => `${e.id}:${e.ownerId}`).sort();
    const totalBefore = (await purchases.getGroupDetail(c.ctxA, chiikawa)).totals;

    const r = await purchases.deleteTag(c.ctxA, hachi.id);
    assert.equal(r.movedCount, 3);

    assert.equal(await prisma.purchaseTag.count({ where: { id: hachi.id } }), 0, "角色真的被刪掉");
    const moved = await prisma.purchaseEntry.findMany({ where: { id: { in: beforeEntries.map((e) => e.id) } } });
    assert.equal(moved.length, 3, "購買紀錄一筆都沒少");
    assert.ok(moved.every((e) => e.tagId === def.id), "全部轉到預設角色");
    assert.deepEqual(moved.map((e) => `${e.id}:${e.ownerId}`).sort(), beforeOwners, "ownerId 一個字都沒變");

    const totalAfter = (await purchases.getGroupDetail(c.ctxA, chiikawa)).totals;
    assert.deepEqual(totalAfter, totalBefore, "件數與金額不受影響");
  });

  it("10. 來自記帳的紀錄：金額與日期直接引用交易，改交易就跟著變", async () => {
    const t = await expense("吉伊娃娃", $(680), 15);
    await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: chiikawa, categoryId: await anyCat(), tagId: (await tagNamed(chiikawa, "吉伊")).id, ownerId: null,
    });
    const e = await purchases.entryOfTransaction(c.ctxA, t.id);
    assert.equal(e!.amount, $(680));
    assert.equal(e!.fromTransaction, true);

    // PurchaseEntry 自己那三欄是空的：沒有第二份金額可以對不起來
    const raw = await prisma.purchaseEntry.findUniqueOrThrow({ where: { transactionId: t.id } });
    assert.equal(raw.amount, null);
    assert.equal(raw.title, null);
    assert.equal(raw.occurredAt, null);

    // 改交易金額 → 購買紀錄跟著變
    const full = await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } });
    await ledger.updateTransaction(c.ctxA, t.id, full.version, {
      type: "EXPENSE", amount: $(700), accountId: c.accA, categoryId: null,
      title: "吉伊娃娃", note: "", occurredOn: D(15),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
    });
    assert.equal((await purchases.entryOfTransaction(c.ctxA, t.id))!.amount, $(700));

    // 編輯購買紀錄時，金額與日期不會被蓋掉
    await purchases.updateEntry(c.ctxA, e!.id, {
      groupId: chiikawa, categoryId: await anyCat(), tagId: (await defaultTag(chiikawa)).id, ownerId: c.bId,
      title: "想亂改", amount: $(1), occurredOn: D(1),
    });
    const after = await purchases.entryOfTransaction(c.ctxA, t.id);
    assert.equal(after!.amount, $(700), "金額仍然來自交易");
    assert.equal(after!.title, "吉伊娃娃", "品項名稱仍然來自交易");
    assert.equal(after!.ownerId, c.bId, "但歸屬改得動");
  });

  it("11. 手動紀錄可以獨立編輯三個欄位", async () => {
    const m = await purchases.addManual(c.ctxA, {
      groupId: haikyu, categoryId: await anyCat(), tagId: (await defaultTag(haikyu)).id, ownerId: c.bId,
      title: "日向立牌", amount: $(450), occurredOn: D(20), note: "在日本買的",
    });
    await purchases.updateEntry(c.ctxA, m.id, {
      groupId: haikyu, categoryId: await anyCat(), tagId: (await defaultTag(haikyu)).id, ownerId: c.aId,
      title: "日向立牌（大）", amount: $(520), occurredOn: D(21), note: "改過了",
    });
    const e = await purchases.getEntry(c.ctxA, m.id);
    assert.equal(e!.title, "日向立牌（大）");
    assert.equal(e!.amount, $(520));
    assert.equal(e!.ownerId, c.aId);
    assert.equal(e!.fromTransaction, false);
    assert.equal(await prisma.transaction.count({ where: { title: "日向立牌（大）" } }), 0, "手動紀錄不產生交易");
  });

  it("12+13. 交易作廢後不計入，但購買紀錄仍然存在", async () => {
    const t = await expense("烏薩奇盲盒", $(180), 22);
    const e = await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: chiikawa, categoryId: await anyCat(), tagId: (await defaultTag(chiikawa)).id, ownerId: c.bId,
    });
    const withIt = await purchases.getGroupDetail(c.ctxA, chiikawa);

    await ledger.deleteTransaction(c.ctxA, t.id);

    const without = await purchases.getGroupDetail(c.ctxA, chiikawa);
    assert.equal(without.totals.count, withIt.totals.count - 1, "件數少一件");
    assert.equal(without.totals.amount, withIt.totals.amount - $(180), "金額少 180");
    assert.ok(await prisma.purchaseEntry.findUnique({ where: { id: e.id } }), "購買紀錄沒有被刪掉");
    assert.equal(without.voided.length, 1, "跑到「需要處理」那一區");
    assert.equal(without.voided[0].id, e.id);
    assert.ok(!without.entries.some((x) => x.id === e.id), "不出現在一般品項列表");
  });

  it("14+15. 轉成手動：資料完整複製，並重新計入統計", async () => {
    const voided = (await purchases.getGroupDetail(c.ctxA, chiikawa)).voided[0];
    const beforeTotals = (await purchases.getGroupDetail(c.ctxA, chiikawa)).totals;
    const txId = voided.transactionId!;
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: txId } });

    await purchases.convertToManual(c.ctxA, voided.id);

    const raw = await prisma.purchaseEntry.findUniqueOrThrow({ where: { id: voided.id } });
    assert.equal(raw.transactionId, null, "解除關聯");
    assert.equal(raw.title, tx.title, "品項名稱照抄");
    assert.equal(raw.amount, tx.amount, "金額照抄");
    assert.equal(raw.occurredAt?.getTime(), tx.occurredAt.getTime(), "日期照抄");
    assert.equal(raw.ownerId, c.bId, "歸屬保留");
    assert.equal(raw.groupId, chiikawa, "作品保留");
    assert.equal(raw.tagId, voided.tagId, "角色保留");

    const after = await purchases.getGroupDetail(c.ctxA, chiikawa);
    assert.equal(after.voided.length, 0, "不再是「需要處理」");
    assert.equal(after.totals.count, beforeTotals.count + 1, "重新計入件數");
    assert.equal(after.totals.amount, beforeTotals.amount + $(180), "重新計入金額");
    assert.ok(await prisma.transaction.findFirst({ where: { id: txId } }), "作廢的那筆記帳還在");

    // 已經是手動的不能再轉一次
    await rejects(purchases.convertToManual(c.ctxA, voided.id), "PURCHASE_NOT_FROM_TX");
  });

  it("16. 移除購買紀錄不會刪掉 Transaction", async () => {
    const t = await expense("要移除的", $(99), 23);
    const e = await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: chiikawa, categoryId: await anyCat(), tagId: (await defaultTag(chiikawa)).id, ownerId: null,
    });
    const snapshot = await financeSnapshot();

    await purchases.removeEntry(c.ctxA, e.id);

    assert.equal(await prisma.purchaseEntry.count({ where: { id: e.id } }), 0);
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } });
    assert.equal(tx.deletedAt, null, "記帳完好如初");
    assert.equal(tx.amount, $(99));
    assert.equal(await financeSnapshot(), snapshot, "移除購買紀錄不影響任何財務數字");
  });

  it("17. 交易還原之後統計自動恢復", async () => {
    const t = await expense("會還原的", $(260), 24);
    const e = await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: chiikawa, categoryId: await anyCat(), tagId: (await defaultTag(chiikawa)).id, ownerId: c.aId,
    });
    const before = (await purchases.getGroupDetail(c.ctxA, chiikawa)).totals;

    await ledger.deleteTransaction(c.ctxA, t.id);
    assert.equal((await purchases.getGroupDetail(c.ctxA, chiikawa)).totals.count, before.count - 1);

    // 還原（既有的 soft delete，直接把 deletedAt 清掉就是還原）
    await prisma.transaction.update({ where: { id: t.id }, data: { deletedAt: null, deletedById: null } });

    const after = await purchases.getGroupDetail(c.ctxA, chiikawa);
    assert.deepEqual(after.totals, before, "件數與金額回到原點");
    assert.equal(after.voided.length, 0);
    assert.ok(after.entries.some((x) => x.id === e.id));
  });

  it("19. 購買紀錄完全不影響任何財務數字", async () => {
    const snapshot = await financeSnapshot();
    const accountsBefore = (await ledger.listAccounts(c.ctxA)).map((a) => `${a.id}:${a.balance}`).sort();

    // 把能做的操作全部做一遍
    const g = await purchases.createGroup(c.ctxA, { name: "間諜家家酒" });
    await purchases.createTag(c.ctxA, g.id, "安妮亞");
    await purchases.addManual(c.ctxA, {
      groupId: g.id, categoryId: await anyCat(), tagId: (await tagNamed(g.id, "安妮亞")).id, ownerId: c.aId,
      title: "安妮亞娃娃", amount: $(1200), occurredOn: D(25),
    });
    const t = await expense("間諜家家酒公仔", $(600), 26);
    const e = await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: g.id, categoryId: await anyCat(), tagId: (await defaultTag(g.id)).id, ownerId: c.bId,
    });
    await purchases.updateEntry(c.ctxA, e.id, { groupId: g.id, categoryId: await anyCat(), tagId: (await tagNamed(g.id, "安妮亞")).id, ownerId: null });
    await purchases.deleteTag(c.ctxA, (await tagNamed(g.id, "安妮亞")).id);
    await purchases.removeEntry(c.ctxA, e.id);

    // 上面唯一會動到財務的是那筆 expense()，扣掉它之後一切照舊
    await ledger.deleteTransaction(c.ctxA, t.id);
    assert.equal(await financeSnapshot(), snapshot, "餘額、欠款、結算建議全部沒變");
    assert.deepEqual((await ledger.listAccounts(c.ctxA)).map((a) => `${a.id}:${a.balance}`).sort(), accountsBefore);

    // 購買紀錄不產生任何金流分錄
    const entries = await prisma.purchaseEntry.findMany({ where: { bookId: c.ctxA.book.id }, select: { transactionId: true } });
    const txIds = entries.map((x) => x.transactionId).filter((x): x is string => x !== null);
    const payments = await prisma.transactionPayment.count({ where: { transaction: { purchaseEntry: { isNot: null } }, NOT: { transactionId: { in: txIds } } } });
    assert.equal(payments, 0);
    assert.equal(await prisma.fundTransaction.count({ where: { bookId: c.ctxA.book.id, note: { contains: "購買" } } }), 0);
    assert.equal(await prisma.settlement.count({ where: { bookId: c.ctxA.book.id } }), 0);
    assert.equal(await prisma.budget.count({ where: { bookId: c.ctxA.book.id } }), 0);
  });

  it("20. 作品還有購買紀錄時不可以刪除", async () => {
    await rejects(purchases.deleteGroup(c.ctxA, chiikawa), "PURCHASE_GROUP_IN_USE");
    const empty = await purchases.createGroup(c.ctxA, { name: "還沒買過的作品" });
    await purchases.deleteGroup(c.ctxA, empty.id);
    assert.equal(await prisma.purchaseGroup.count({ where: { id: empty.id } }), 0);
  });

  it("21. 關鍵字：只判斷作品與角色，不判斷歸屬", async () => {
    await purchases.addKeyword(c.ctxA, { groupId: chiikawa, categoryId: await anyCat(), tagId: null, word: "吉伊卡哇" });
    await purchases.addKeyword(c.ctxA, { groupId: chiikawa, categoryId: await anyCat(), tagId: null, word: "Chiikawa" });
    const usagi = await purchases.createTag(c.ctxA, chiikawa, "烏薩奇");
    await purchases.addKeyword(c.ctxA, { groupId: chiikawa, categoryId: await anyCat(), tagId: usagi.id, word: "烏薩奇" });

    const def = await defaultTag(chiikawa);
    // 只命中作品 → 落到預設角色
    const a = await purchases.suggest(c.ctxA, { title: "吉伊卡哇一番賞" });
    assert.equal(a!.groupId, chiikawa);
    assert.equal(a!.tagId, def.id);
    assert.equal(a!.fallback, true);

    // 命中角色 → 用角色，而且角色優先於作品
    const b = await purchases.suggest(c.ctxA, { title: "吉伊卡哇 烏薩奇盲盒" });
    assert.equal(b!.tagId, usagi.id);
    assert.equal(b!.fallback, false);

    // 大小寫、全形都要對得到
    assert.ok(await purchases.suggest(c.ctxA, { title: "CHIIKAWA 資料夾" }));
    assert.ok(await purchases.suggest(c.ctxA, { merchant: "ｃｈｉｉｋａｗａ 專賣店" }));
    assert.equal(await purchases.suggest(c.ctxA, { title: "7-11" }), null);

    // 關鍵字只給建議，**絕對不會自己建立購買紀錄**
    const t = await ledger.createTransaction(c.ctxB, {
      type: "EXPENSE", amount: $(300), accountId: c.accB, categoryId: null,
      title: "吉伊卡哇吊飾", note: "", occurredOn: D(27),
      split: { method: "FULL", participants: [{ userId: c.bId }] }, clientRequestId: rid(),
    });
    const beforeCount = await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } });
    const hint = await purchases.suggestForTransaction(c.ctxB, t.id);
    assert.ok(hint, "有建議");
    assert.equal(hint!.groupId, chiikawa);
    assert.equal(
      await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } }),
      beforeCount,
      "關鍵字命中也不會建立任何購買紀錄 —— 要使用者按下去才算數",
    );
    assert.ok(!("ownerId" in hint!), "建議裡根本沒有歸屬這個欄位，不從付款人猜");
  });

  it("22. 關鍵字修改不回溯舊資料；試跑不改任何東西", async () => {
    const countBefore = await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } });
    await purchases.addKeyword(c.ctxA, { groupId: haikyu, categoryId: await anyCat(), tagId: null, word: "排球" });
    assert.equal(
      await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } }),
      countBefore,
      "新增關鍵字不會把舊交易變成購買紀錄",
    );

    const rows = await purchases.trialRun(c.ctxA);
    assert.ok(rows.length > 0);
    assert.ok(rows.some((r) => r.hit), "有命中的");
    assert.ok(rows.some((r) => !r.hit), "也要顯示沒命中的");
    assert.equal(
      await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } }),
      countBefore,
      "試跑不修改任何正式資料",
    );
  });

  it("23. 預設角色改名後，試跑與各處的落點名稱跟著變（不靠寫死的字串）", async () => {
    const def = await defaultTag(chiikawa);
    await purchases.renameTag(c.ctxA, def.id, "未分類");
    const rows = await purchases.trialRun(c.ctxA);
    const fallbackHit = rows.find((r) => r.hit && r.word === "吉伊卡哇");
    assert.ok(fallbackHit);
    assert.equal(fallbackHit!.tagName, "未分類", "試跑的落點讀的是 tag 目前的名字");

    const detail = await purchases.getGroupDetail(c.ctxA, chiikawa);
    assert.ok(detail.tags.some((t) => t.isDefault && t.name === "未分類"));
    // detect 仍然找得到落點（判斷看 isDefault，不看名字）
    const hit = await purchases.suggest(c.ctxA, { title: "吉伊卡哇一番賞" });
    assert.equal(hit!.tagId, def.id);
  });

  it("24. 同一筆交易不會被加入兩次", async () => {
    const t = await expense("只能加一次", $(150), 28);
    await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: chiikawa, categoryId: await anyCat(), tagId: (await defaultTag(chiikawa)).id, ownerId: null,
    });
    await rejects(
      purchases.addFromTransaction(c.ctxA, t.id, {
        groupId: chiikawa, categoryId: await anyCat(), tagId: (await defaultTag(chiikawa)).id, ownerId: null,
      }),
      "PURCHASE_TX_DUPLICATE",
    );
    const addable = await purchases.listAddableTransactions(c.ctxA);
    assert.ok(!addable.some((x) => x.id === t.id), "已加入的不出現在可挑清單裡");
    assert.equal(await purchases.suggestForTransaction(c.ctxA, t.id), null, "已經加入過的不再提示第二次");
  });

  it("25. 角色必須屬於指定的作品", async () => {
    await rejects(
      purchases.addManual(c.ctxA, {
        groupId: haikyu, categoryId: await anyCat(), tagId: (await defaultTag(chiikawa)).id, ownerId: null,
        title: "跨作品的角色", amount: $(100), occurredOn: D(28),
      }),
      "PURCHASE_TAG_NOT_FOUND",
    );
  });
});

/**
 * V12-2：商品分類（第二層）與四層逐層收斂。
 *
 * 商品分類是「買的是什麼東西」（吊娃／扭蛋／一番賞），角色是「上面是誰」，
 * 兩者是不同維度。商品分類整個帳本共用，角色依作品分開管理。
 */
describe("V12-2：商品分類與四層導覽", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let chiikawa: string;
  let haikyu: string;

  const cat = async (name: string) =>
    (await prisma.purchaseCategory.findFirstOrThrow({ where: { bookId: c.ctxA.book.id, name } })).id;
  const tag = async (groupId: string, name: string) =>
    (await prisma.purchaseTag.findFirstOrThrow({ where: { groupId, name } })).id;
  const defTag = async (groupId: string) =>
    (await prisma.purchaseTag.findFirstOrThrow({ where: { groupId, isDefault: true } })).id;

  before(async () => {
    await reset();
    c = await setupCouple();
  });
  after(async () => {
    await prisma.$disconnect();
  });

  it("1. 一鍵建立預設：兩個作品、各自的角色、六種商品分類", async () => {
    const r = await purchases.seedStarter(c.ctxA);
    assert.equal(r.created, 2);

    const groups = await purchases.listGroups(c.ctxA);
    assert.deepEqual(groups.map((g) => g.name), ["吉伊卡哇", "排球少年"]);
    chiikawa = groups[0].id;
    haikyu = groups[1].id;

    const cats = await purchases.listCategories(c.ctxA);
    assert.deepEqual(cats.map((x) => x.name), ["吊娃", "S娃", "扭蛋", "景品", "一番賞", "其他"]);
    assert.equal(cats.filter((x) => x.isDefault).length, 1, "恰好一個預設商品分類");
    assert.equal(cats.find((x) => x.isDefault)!.name, "其他");

    // 角色依作品分開管理：吉伊卡哇的角色不會跑到排球少年底下
    const ct = await prisma.purchaseTag.findMany({ where: { groupId: chiikawa } });
    const ht = await prisma.purchaseTag.findMany({ where: { groupId: haikyu } });
    assert.deepEqual(ct.map((t) => t.name).sort(), ["全角色", "吉伊", "小八", "烏薩奇"].sort());
    assert.deepEqual(ht.map((t) => t.name).sort(), ["全角色", "日向", "影山", "月島", "西谷", "黑尾"].sort());
    assert.ok(!ht.some((t) => t.name === "小八"), "排球少年底下沒有小八");

    // 重複呼叫不會再建一次
    assert.equal((await purchases.seedStarter(c.ctxA)).created, 0);
    assert.equal((await purchases.listGroups(c.ctxA)).length, 2);
  });

  it("2. 每個作品都用得到同一組商品分類（商品分類是帳本層級）", async () => {
    const 吊娃 = await cat("吊娃");
    await purchases.addManual(c.ctxA, {
      groupId: chiikawa, categoryId: 吊娃, tagId: await tag(chiikawa, "小八"), ownerId: c.bId,
      title: "小八吊娃", amount: $(350), occurredOn: "2026-09-15",
    });
    await purchases.addManual(c.ctxA, {
      groupId: haikyu, categoryId: 吊娃, tagId: await tag(haikyu, "日向"), ownerId: c.aId,
      title: "日向吊娃", amount: $(400), occurredOn: "2026-09-16",
    });
    const a = await purchases.getGroupDetail(c.ctxA, chiikawa, { categoryId: 吊娃 });
    const b = await purchases.getGroupDetail(c.ctxA, haikyu, { categoryId: 吊娃 });
    assert.equal(a.totals.count, 1);
    assert.equal(b.totals.count, 1);
    assert.equal(a.totals.amount, $(350));
    assert.equal(b.totals.amount, $(400));
  });

  it("3. 四層逐層收斂：每一層的數字都算在上面幾層的範圍內", async () => {
    const 吊娃 = await cat("吊娃");
    const 一番賞 = await cat("一番賞");
    // 吉伊卡哇再補幾筆，湊出所有組合
    await purchases.addManual(c.ctxA, {
      groupId: chiikawa, categoryId: 一番賞, tagId: await defTag(chiikawa), ownerId: null,
      title: "吉伊卡哇一番賞", amount: $(250), occurredOn: "2026-09-10",
    });
    await purchases.addManual(c.ctxA, {
      groupId: chiikawa, categoryId: 吊娃, tagId: await tag(chiikawa, "吉伊"), ownerId: c.aId,
      title: "吉伊吊娃", amount: $(300), occurredOn: "2026-09-12",
    });
    await purchases.addManual(c.ctxA, {
      groupId: chiikawa, categoryId: 吊娃, tagId: await tag(chiikawa, "小八"), ownerId: c.bId,
      title: "小八吊娃二代", amount: $(380), occurredOn: "2026-09-18",
    });

    // 第一層：作品
    const all = await purchases.getGroupDetail(c.ctxA, chiikawa);
    assert.equal(all.totals.count, 4);
    assert.equal(all.totals.amount, $(350 + 250 + 300 + 380));

    // 第二層：商品分類的件數是這個作品底下的
    const 吊娃Row = all.categories.find((x) => x.id === 吊娃)!;
    assert.equal(吊娃Row.totals.count, 3, "吉伊卡哇的吊娃有 3 件（不含排球少年那件）");
    assert.equal(all.categories.find((x) => x.id === 一番賞)!.totals.count, 1);

    // 第三層：選定吊娃之後才算共同/A/B
    const lv3 = await purchases.getGroupDetail(c.ctxA, chiikawa, { categoryId: 吊娃 });
    assert.equal(lv3.totals.count, 3);
    const byOwner = Object.fromEntries(lv3.owners.map((o) => [o.name, o.totals.count]));
    assert.equal(byOwner["共同"], 0, "吊娃底下沒有共同的");
    assert.equal(byOwner[c.ctxA.me.nickname], 1);
    assert.equal(byOwner[c.ctxB.me.nickname], 2);

    // 第四層：選定吊娃 + 阿本之後才算角色
    const lv4 = await purchases.getGroupDetail(c.ctxA, chiikawa, { categoryId: 吊娃, owner: c.bId });
    assert.equal(lv4.totals.count, 2);
    assert.equal(lv4.totals.amount, $(350 + 380));
    const byTag = Object.fromEntries(lv4.tags.map((t) => [t.name, t.totals.count]));
    assert.equal(byTag["小八"], 2);
    assert.equal(byTag["吉伊"], 0, "吉伊那件是小艾的，不算在阿本底下");

    // 四層全部選定
    const leaf = await purchases.getGroupDetail(c.ctxA, chiikawa, {
      categoryId: 吊娃, owner: c.bId, tagId: await tag(chiikawa, "小八"),
    });
    assert.equal(leaf.totals.count, 2);
    assert.equal(leaf.entries.length, 2);

    // 每一層的「全部」都等於不加那一層的條件
    assert.equal(
      lv3.owners.reduce((a, o) => a + o.totals.count, 0),
      lv3.totals.count,
      "共同 + A + B 等於這個商品分類的全部",
    );
  });

  it("4. 刪除商品分類：購買紀錄移到預設分類，作品／歸屬／角色都不動", async () => {
    const 吊娃 = await cat("吊娃");
    const fallback = await cat("其他");
    const before = await prisma.purchaseEntry.findMany({ where: { categoryId: 吊娃 }, orderBy: { createdAt: "asc" } });
    assert.equal(before.length, 4, "兩個作品加起來 4 件");
    const snapshot = before.map((e) => `${e.id}:${e.groupId}:${e.tagId}:${e.ownerId}`).sort();

    const r = await purchases.deleteCategory(c.ctxA, 吊娃);
    assert.equal(r.movedCount, 4);

    const after = await prisma.purchaseEntry.findMany({ where: { id: { in: before.map((e) => e.id) } } });
    assert.equal(after.length, 4, "一筆都沒少");
    assert.ok(after.every((e) => e.categoryId === fallback), "全部移到預設分類");
    assert.deepEqual(
      after.map((e) => `${e.id}:${e.groupId}:${e.tagId}:${e.ownerId}`).sort(),
      snapshot,
      "作品、角色、歸屬一個字都沒變",
    );
  });

  it("5. 預設商品分類不可刪除，但可以改名", async () => {
    const fallback = await cat("其他");
    await rejects(purchases.deleteCategory(c.ctxA, fallback), "PURCHASE_CATEGORY_DEFAULT");
    await purchases.renameCategory(c.ctxA, fallback, "未分類");
    const row = await prisma.purchaseCategory.findUniqueOrThrow({ where: { id: fallback } });
    assert.equal(row.name, "未分類");
    assert.equal(row.isDefault, true, "改名之後仍然是預設分類");
  });

  it("6. 不變式：同一個帳本不可能有第二個預設商品分類（資料庫層擋住）", async () => {
    const other = await cat("扭蛋");
    await assert.rejects(
      prisma.purchaseCategory.update({ where: { id: other }, data: { isDefault: true } }),
      (e: unknown) => String(e).includes("PurchaseCategory_one_default_per_book") || String(e).includes("Unique constraint"),
    );
    assert.equal(
      await prisma.purchaseCategory.count({ where: { bookId: c.ctxA.book.id, isDefault: true } }),
      1,
    );
  });

  it("7. 新增商品分類：所有作品立刻都用得到，不會動到既有資料", async () => {
    const beforeEntries = await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } });
    const 徽章 = await purchases.createCategory(c.ctxA, "徽章");
    assert.equal(await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } }), beforeEntries, "既有紀錄不受影響");

    const a = await purchases.getGroupDetail(c.ctxA, chiikawa);
    const b = await purchases.getGroupDetail(c.ctxA, haikyu);
    assert.ok(a.categories.some((x) => x.id === 徽章.id), "吉伊卡哇用得到");
    assert.ok(b.categories.some((x) => x.id === 徽章.id), "排球少年也用得到");
    await rejects(purchases.createCategory(c.ctxA, "徽章"), "PURCHASE_CATEGORY_DUPLICATE");
  });

  it("8. 商品分類必須是同一個帳本的", async () => {
    const outsider = await users.registerUser({ email: `o2-${rid().slice(0, 6)}@example.com`, password: "password123", name: "路人" });
    await books.createBook(outsider.id, { name: "別人的帳本", nickname: "路人" });
    const otherCtx = (await books.getBookContext(outsider.id))!;
    await purchases.seedStarter(otherCtx);
    const theirCat = (await prisma.purchaseCategory.findFirstOrThrow({ where: { bookId: otherCtx.book.id } })).id;

    await rejects(
      purchases.addManual(c.ctxA, {
        groupId: chiikawa, categoryId: theirCat, tagId: await defTag(chiikawa), ownerId: null,
        title: "跨帳本的分類", amount: $(100), occurredOn: "2026-09-20",
      }),
      "PURCHASE_CATEGORY_NOT_FOUND",
    );
  });

  it("9. 兩個人看到同一份共同帳本資料", async () => {
    const a = await purchases.getGroupDetail(c.ctxA, chiikawa);
    const b = await purchases.getGroupDetail(c.ctxB, chiikawa);
    assert.deepEqual(a.totals, b.totals);
    assert.deepEqual(a.entries.map((e) => e.id).sort(), b.entries.map((e) => e.id).sort());
  });

  it("10. 關鍵字可以連商品分類一起建議，但仍然不會自己建立", async () => {
    const 一番賞 = await cat("一番賞");
    await purchases.addKeyword(c.ctxA, { groupId: chiikawa, tagId: null, word: "吉伊卡哇" });
    await purchases.addKeyword(c.ctxA, { groupId: chiikawa, tagId: null, categoryId: 一番賞, word: "一番賞" });
    await purchases.addKeyword(c.ctxA, { groupId: chiikawa, tagId: await tag(chiikawa, "小八"), word: "小八" });

    const before = await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } });

    // 「小八吊娃」→ 作品、角色都猜到
    const s1 = await purchases.suggest(c.ctxA, { title: "小八吊娃" });
    assert.equal(s1!.groupId, chiikawa);
    assert.equal(s1!.tagName, "小八");
    assert.equal(s1!.fallback, false);

    // 「吉伊卡哇一番賞」→ 作品與商品分類猜到，角色落在預設
    const s2 = await purchases.suggest(c.ctxA, { title: "吉伊卡哇一番賞" });
    assert.equal(s2!.groupId, chiikawa);
    assert.equal(s2!.categoryName, "一番賞", "商品分類也猜得到");
    assert.equal(s2!.fallback, true, "沒對到角色就落在預設角色");

    assert.equal(await purchases.suggest(c.ctxA, { title: "7-11" }), null);
    assert.equal(
      await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } }),
      before,
      "建議了這麼多次，一筆都沒有被自動建立",
    );
  });

  it("11. 關鍵字修改不回溯舊資料", async () => {
    const before = await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } });
    await purchases.addKeyword(c.ctxA, { groupId: haikyu, tagId: null, word: "排球" });
    assert.equal(await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } }), before);
    // 試跑也是唯讀
    await purchases.trialRun(c.ctxA);
    assert.equal(await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } }), before);
  });

  it("12. 購買紀錄完全不影響財務", async () => {
    const snap = async () => {
      const b = await ledger.getBalances(c.ctxA);
      return JSON.stringify({ accounts: [...b.accounts.entries()].sort(), net: [...b.net.entries()].sort(), debts: b.debts });
    };
    const before = await snap();
    await purchases.addManual(c.ctxA, {
      groupId: haikyu, categoryId: await cat("扭蛋"), tagId: await tag(haikyu, "影山"), ownerId: c.aId,
      title: "影山扭蛋", amount: $(200), occurredOn: "2026-09-22",
    });
    await purchases.createCategory(c.ctxA, "色紙");
    assert.equal(await snap(), before, "餘額、欠款、結算建議全部沒變");
    assert.equal(await prisma.transactionPayment.count({ where: { transaction: { purchaseEntry: { isNot: null } } } }), 0);
  });
});


/**
 * V12-3：商品分類是後來才加的那一層，所以要處理「舊帳本升級上來」的狀態。
 *
 * 真實案例：在加入商品分類之前就建好作品、但還沒記過任何一筆的帳本，
 * 沒被 migration 的回填掃到（那版只看 PurchaseEntry），結果新增表單的
 * 「商品分類」整區空白、送出鈕永遠是灰的，畫面上沒有任何出路。
 */
describe("V12-3：沒有商品分類的舊帳本不會卡死", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;

  before(async () => {
    await reset();
    c = await setupCouple();
  });
  after(async () => {
    await prisma.$disconnect();
  });

  it("1. 有作品但一個商品分類都沒有時，讀取會就地把六種預設補出來", async () => {
    const g = await purchases.createGroup(c.ctxA, { name: "吉伊卡哇" });
    // 重現舊帳本：作品在、分類被清空
    await prisma.purchaseCategory.deleteMany({ where: { bookId: c.ctxA.book.id } });
    assert.equal(await prisma.purchaseCategory.count({ where: { bookId: c.ctxA.book.id } }), 0);

    const cats = await purchases.listCategories(c.ctxA);
    assert.deepEqual(cats.map((x) => x.name), ["吊娃", "S娃", "扭蛋", "景品", "一番賞", "其他"]);
    assert.equal(cats.filter((x) => x.isDefault).length, 1, "恰好一個預設");

    // 表單拿得到東西，所以送出鈕不會是灰的
    const opts = await purchases.optionsForForm(c.ctxA);
    assert.ok(opts.categories.length > 0, "新增表單的商品分類不是空的");
    assert.ok(opts.groups.some((x) => x.id === g.id));
  });

  it("2. 補出來之後是冪等的：再讀幾次都還是六種，不會長出兩套", async () => {
    await purchases.listCategories(c.ctxA);
    await purchases.listCategories(c.ctxA);
    const rows = await prisma.purchaseCategory.findMany({ where: { bookId: c.ctxA.book.id } });
    assert.equal(rows.length, 6);
    assert.equal(rows.filter((r) => r.isDefault).length, 1);
  });

  it("3. 補出來的分類真的能用：新增一筆購買紀錄會成功", async () => {
    const g = (await purchases.listGroups(c.ctxA))[0];
    const cat = (await purchases.listCategories(c.ctxA))[0];
    const tag = await prisma.purchaseTag.findFirstOrThrow({ where: { groupId: g.id, isDefault: true } });
    const e = await purchases.addManual(c.ctxA, {
      groupId: g.id, categoryId: cat.id, tagId: tag.id, ownerId: c.aId,
      title: "兔兔吉伊", amount: $(350), occurredOn: "2026-09-25",
    });
    assert.ok(e.id);
    const detail = await purchases.getGroupDetail(c.ctxA, g.id, { categoryId: cat.id });
    assert.equal(detail.totals.count, 1);
  });

  it("4. 使用者自己改過分類的帳本不會被覆蓋", async () => {
    // 只刪沒人在用的（在用的刪不掉，外鍵擋著 —— 那也正是我們要的）
    const inUse = (await prisma.purchaseEntry.findMany({
      where: { bookId: c.ctxA.book.id }, select: { categoryId: true },
    })).map((e) => e.categoryId);
    await prisma.purchaseCategory.deleteMany({
      where: { bookId: c.ctxA.book.id, isDefault: false, id: { notIn: inUse } },
    });
    const left = await purchases.listCategories(c.ctxA);
    assert.ok(left.length > 0 && left.length < 6, `應該只剩少數幾個，實際 ${left.length} 個`);

    await purchases.renameCategory(c.ctxA, left[0].id, "我自己的分類");
    const after = await purchases.listCategories(c.ctxA);
    assert.equal(after.length, left.length, "不是空的就不會被補，數量維持原狀");
    assert.ok(after.some((x) => x.name === "我自己的分類"), "改過的名字留著");
    assert.ok(!after.some((x) => x.name === "扭蛋"), "被刪掉的沒有被補回來");
  });
});
