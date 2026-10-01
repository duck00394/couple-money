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
      groupId: chiikawa, tagId: (await defaultTag(chiikawa)).id, ownerId: null,
    });
    const e = await purchases.entryOfTransaction(c.ctxA, t.id);
    assert.equal(e!.ownerId, null);
    assert.equal(e!.amount, $(250));
  });

  it("2. owner = A", async () => {
    const t = await expense("小八吊飾", $(350), 11);
    await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: chiikawa, tagId: (await tagNamed(chiikawa, "小八")).id, ownerId: c.aId,
    });
    assert.equal((await purchases.entryOfTransaction(c.ctxA, t.id))!.ownerId, c.aId);
  });

  it("3. owner = B", async () => {
    const t = await expense("兔兔玩偶", $(540), 12);
    await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: chiikawa, tagId: (await tagNamed(chiikawa, "兔兔")).id, ownerId: c.bId,
    });
    assert.equal((await purchases.entryOfTransaction(c.ctxA, t.id))!.ownerId, c.bId);
  });

  it("4. 不允許 owner 指向別的帳本的成員", async () => {
    const outsider = await users.registerUser({ email: `out-${rid().slice(0, 6)}@example.com`, password: "password123", name: "路人" });
    await books.createBook(outsider.id, { name: "別人的帳本", nickname: "路人" });
    const t = await expense("別人的東西", $(100), 13);

    await rejects(
      purchases.addFromTransaction(c.ctxA, t.id, {
        groupId: chiikawa, tagId: (await defaultTag(chiikawa)).id, ownerId: outsider.id,
      }),
      "PURCHASE_OWNER",
    );
    await rejects(
      purchases.addManual(c.ctxA, {
        groupId: chiikawa, tagId: (await defaultTag(chiikawa)).id, ownerId: outsider.id,
        title: "手動的", amount: $(100), occurredOn: D(13),
      }),
      "PURCHASE_OWNER",
    );
    // 連隨便一個不存在的 id 也要擋
    await rejects(
      purchases.addManual(c.ctxA, {
        groupId: chiikawa, tagId: (await defaultTag(chiikawa)).id, ownerId: "not-a-real-user",
        title: "假的", amount: $(100), occurredOn: D(13),
      }),
      "PURCHASE_OWNER",
    );
    assert.equal(await prisma.purchaseEntry.count({ where: { ownerId: outsider.id } }), 0);
  });

  it("5+6. 歸屬 + 角色雙重篩選，件數與金額跟著變", async () => {
    // 再補幾筆，讓每個組合都有資料
    await purchases.addManual(c.ctxA, {
      groupId: chiikawa, tagId: (await tagNamed(chiikawa, "小八")).id, ownerId: c.aId,
      title: "ハチワレ 馬克杯", amount: $(420), occurredOn: D(5),
    });
    await purchases.addManual(c.ctxA, {
      groupId: chiikawa, tagId: (await tagNamed(chiikawa, "小八")).id, ownerId: null,
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
      groupId: chiikawa, tagId: (await tagNamed(chiikawa, "吉伊")).id, ownerId: null,
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
      groupId: chiikawa, tagId: (await defaultTag(chiikawa)).id, ownerId: c.bId,
      title: "想亂改", amount: $(1), occurredOn: D(1),
    });
    const after = await purchases.entryOfTransaction(c.ctxA, t.id);
    assert.equal(after!.amount, $(700), "金額仍然來自交易");
    assert.equal(after!.title, "吉伊娃娃", "品項名稱仍然來自交易");
    assert.equal(after!.ownerId, c.bId, "但歸屬改得動");
  });

  it("11. 手動紀錄可以獨立編輯三個欄位", async () => {
    const m = await purchases.addManual(c.ctxA, {
      groupId: haikyu, tagId: (await defaultTag(haikyu)).id, ownerId: c.bId,
      title: "日向立牌", amount: $(450), occurredOn: D(20), note: "在日本買的",
    });
    await purchases.updateEntry(c.ctxA, m.id, {
      groupId: haikyu, tagId: (await defaultTag(haikyu)).id, ownerId: c.aId,
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
      groupId: chiikawa, tagId: (await defaultTag(chiikawa)).id, ownerId: c.bId,
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
      groupId: chiikawa, tagId: (await defaultTag(chiikawa)).id, ownerId: null,
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
      groupId: chiikawa, tagId: (await defaultTag(chiikawa)).id, ownerId: c.aId,
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
      groupId: g.id, tagId: (await tagNamed(g.id, "安妮亞")).id, ownerId: c.aId,
      title: "安妮亞娃娃", amount: $(1200), occurredOn: D(25),
    });
    const t = await expense("間諜家家酒公仔", $(600), 26);
    const e = await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: g.id, tagId: (await defaultTag(g.id)).id, ownerId: c.bId,
    });
    await purchases.updateEntry(c.ctxA, e.id, { groupId: g.id, tagId: (await tagNamed(g.id, "安妮亞")).id, ownerId: null });
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
    await purchases.addKeyword(c.ctxA, { groupId: chiikawa, tagId: null, word: "吉伊卡哇" });
    await purchases.addKeyword(c.ctxA, { groupId: chiikawa, tagId: null, word: "Chiikawa" });
    const usagi = await purchases.createTag(c.ctxA, chiikawa, "烏薩奇");
    await purchases.addKeyword(c.ctxA, { groupId: chiikawa, tagId: usagi.id, word: "烏薩奇" });

    const def = await defaultTag(chiikawa);
    // 只命中作品 → 落到預設角色
    const a = await purchases.detect(c.ctxA, { title: "吉伊卡哇一番賞" });
    assert.equal(a!.groupId, chiikawa);
    assert.equal(a!.tagId, def.id);
    assert.equal(a!.fallback, true);

    // 命中角色 → 用角色，而且角色優先於作品
    const b = await purchases.detect(c.ctxA, { title: "吉伊卡哇 烏薩奇盲盒" });
    assert.equal(b!.tagId, usagi.id);
    assert.equal(b!.fallback, false);

    // 大小寫、全形都要對得到
    assert.ok(await purchases.detect(c.ctxA, { title: "CHIIKAWA 資料夾" }));
    assert.ok(await purchases.detect(c.ctxA, { merchant: "ｃｈｉｉｋａｗａ 專賣店" }));
    assert.equal(await purchases.detect(c.ctxA, { title: "7-11" }), null);

    // 自動加入時歸屬一律共同，不從付款人猜
    const t = await ledger.createTransaction(c.ctxB, {
      type: "EXPENSE", amount: $(300), accountId: c.accB, categoryId: null,
      title: "吉伊卡哇吊飾", note: "", occurredOn: D(27),
      split: { method: "FULL", participants: [{ userId: c.bId }] }, clientRequestId: rid(),
    });
    const auto = await purchases.autoAttach(c.ctxB, t.id);
    assert.ok(auto);
    assert.equal(auto!.ownerId, null, "付款人是阿本，但歸屬仍然是共同");
  });

  it("22. 關鍵字修改不回溯舊資料；試跑不改任何東西", async () => {
    const countBefore = await prisma.purchaseEntry.count({ where: { bookId: c.ctxA.book.id } });
    await purchases.addKeyword(c.ctxA, { groupId: haikyu, tagId: null, word: "排球" });
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
    const hit = await purchases.detect(c.ctxA, { title: "吉伊卡哇一番賞" });
    assert.equal(hit!.tagId, def.id);
  });

  it("24. 同一筆交易不會被加入兩次", async () => {
    const t = await expense("只能加一次", $(150), 28);
    await purchases.addFromTransaction(c.ctxA, t.id, {
      groupId: chiikawa, tagId: (await defaultTag(chiikawa)).id, ownerId: null,
    });
    await rejects(
      purchases.addFromTransaction(c.ctxA, t.id, {
        groupId: chiikawa, tagId: (await defaultTag(chiikawa)).id, ownerId: null,
      }),
      "PURCHASE_TX_DUPLICATE",
    );
    const addable = await purchases.listAddableTransactions(c.ctxA);
    assert.ok(!addable.some((x) => x.id === t.id), "已加入的不出現在可挑清單裡");
    assert.equal(await purchases.autoAttach(c.ctxA, t.id), null, "自動判斷也不會重複加");
  });

  it("25. 角色必須屬於指定的作品", async () => {
    await rejects(
      purchases.addManual(c.ctxA, {
        groupId: haikyu, tagId: (await defaultTag(chiikawa)).id, ownerId: null,
        title: "跨作品的角色", amount: $(100), occurredOn: D(28),
      }),
      "PURCHASE_TAG_NOT_FOUND",
    );
  });
});
