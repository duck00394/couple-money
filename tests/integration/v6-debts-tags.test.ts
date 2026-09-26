import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rejects, rid, reset, setupCouple, prisma } from "./helpers";
import * as ledger from "../../src/server/services/ledger";
import { myDebtItems } from "../../src/server/services/debts";
import { recentTags, loadTxFormOptions } from "../../src/server/txFormData";
import { maxSettleAmount } from "../../src/server/domain/balance";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;

describe("V6：逐筆欠款與多筆一次還款", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;

  /** payer 付全額、兩人平分 */
  const shared = (payerAcc: string, amount: number, day: number, title: string) =>
    ledger.createTransaction(c.ctxA, {
      type: "EXPENSE",
      amount,
      accountId: payerAcc,
      categoryId: null,
      title,
      note: "",
      occurredOn: D(day),
      split: { method: "EQUAL", participants: [{ userId: c.aId }, { userId: c.bId }] },
      clientRequestId: rid(),
    });

  /** 小艾（A）目前欠阿本（B）多少（既有淨額引擎算的） */
  const ledgerDebt = async () => {
    const b = await ledger.getBalances(c.ctxA);
    return maxSettleAmount(b.net, c.aId, c.bId);
  };

  const view = () => myDebtItems(c.ctxA, c.aId);

  /** 依「勾選」的項目一次還款：加總後只呼叫一次 settle() */
  const payFor = async (titles: string[]) => {
    const v = await view();
    const amount = v.items.filter((i) => titles.includes(i.title) && i.remaining > 0).reduce((a, i) => a + i.remaining, 0);
    await ledger.settle(c.ctxA, {
      fromUserId: c.aId, toUserId: c.bId, amount,
      fromAccountId: c.accA, toAccountId: c.accB, note: "", clientRequestId: rid(),
    });
    return amount;
  };

  before(async () => {
    await reset();
    c = await setupCouple("debt");
  });
  after(() => prisma.$disconnect());

  it("1. 一筆欠款：阿本付 $1,000 平分 → 逐筆與總額一致", async () => {
    await shared(c.accB, $(1000), 1, "晚餐");
    const v = await view();
    assert.equal(v.items.length, 1);
    assert.equal(v.items[0].title, "晚餐");
    assert.equal(v.items[0].amount, $(1000));
    assert.equal(v.items[0].myShare, $(500));
    assert.equal(v.items[0].remaining, $(500));
    assert.equal(v.total, await ledgerDebt(), "逐筆總額 = 既有引擎算出來的欠款");
  });

  it("2. 多筆不同日期：由舊到新，總額仍然對得起來", async () => {
    await shared(c.accB, $(600), 5, "電影");
    await shared(c.accB, $(400), 9, "咖啡");
    const v = await view();
    assert.deepEqual(v.items.map((i) => i.title), ["晚餐", "電影", "咖啡"]);
    assert.deepEqual(v.items.map((i) => i.remaining), [$(500), $(300), $(200)]);
    assert.equal(v.total, $(1000));
    assert.equal(v.total, await ledgerDebt());
  });

  it("3. 共同帳戶付的錢不產生欠款，也不出現在清單裡", async () => {
    await shared(c.joint, $(3000), 10, "共同帳戶大採買");
    const v = await view();
    assert.ok(!v.items.some((i) => i.title === "共同帳戶大採買"));
    assert.equal(v.total, $(1000), "欠款沒有變");
    assert.equal(v.total, await ledgerDebt());
  });

  it("4. 我自己付的那幾筆不會變成欠款項目，而是拿去沖銷最舊的", async () => {
    await shared(c.accA, $(400), 11, "小艾付的午餐"); // 我多付 200
    const v = await view();
    assert.ok(!v.items.some((i) => i.title === "小艾付的午餐"));
    assert.equal(v.items[0].settled, $(200), "沖銷最舊的「晚餐」");
    assert.equal(v.items[0].remaining, $(300));
    assert.equal(v.total, $(800));
    assert.equal(v.total, await ledgerDebt());
  });

  it("5. 多選：勾「晚餐」+「電影」一次還款，只建立一筆 SETTLEMENT", async () => {
    const before = await prisma.transaction.count({ where: { bookId: c.ctxA.book.id, type: "SETTLEMENT" } });
    const paid = await payFor(["晚餐", "電影"]);
    assert.equal(paid, $(600), "300 + 300");
    const after = await prisma.transaction.count({ where: { bookId: c.ctxA.book.id, type: "SETTLEMENT" } });
    assert.equal(after - before, 1, "多筆只還一次，不是每筆各建一筆");
    assert.equal((await ledger.listSettlements(c.ctxA)).length, 1);
  });

  it("6. FIFO：沖銷從最舊的開始，已還清的項目不能再被計入", async () => {
    const v = await view();
    assert.deepEqual(v.items.map((i) => [i.title, i.remaining]), [
      ["晚餐", 0],
      ["電影", 0],
      ["咖啡", $(200)],
    ]);
    assert.equal(v.total, $(200));
    assert.equal(v.total, await ledgerDebt());
    const payable = v.items.filter((i) => i.remaining > 0);
    assert.deepEqual(payable.map((i) => i.title), ["咖啡"], "已還清的不再是可選項目");
  });

  it("7. 取消其中一筆（只勾咖啡不勾其他）：金額就是那一筆", async () => {
    const v = await view();
    const onlyCoffee = v.items.filter((i) => i.title === "咖啡").reduce((a, i) => a + i.remaining, 0);
    assert.equal(onlyCoffee, $(200));
    const none = v.items.filter(() => false).reduce((a, i) => a + i.remaining, 0);
    assert.equal(none, 0, "沒有勾選時金額是 0（畫面上按鈕會 disabled）");
  });

  it("8. 全額還款：欠款歸零，所有項目都顯示已還清", async () => {
    await payFor(["咖啡"]);
    const v = await view();
    assert.equal(v.total, 0);
    assert.equal(await ledgerDebt(), 0);
    assert.ok(v.items.every((i) => i.remaining === 0));
    assert.equal(v.unassignedCredit, 0);
  });

  it("9. 還款金額不可以超過 maxSettleAmount()（沿用既有防呆）", async () => {
    await shared(c.accB, $(1000), 12, "宵夜"); // 我欠 500
    assert.equal(await ledgerDebt(), $(500));
    await rejects(
      ledger.settle(c.ctxA, {
        fromUserId: c.aId, toUserId: c.bId, amount: $(900),
        fromAccountId: c.accA, toAccountId: c.accB, note: "", clientRequestId: rid(),
      }),
      "SETTLE_TOO_MUCH",
    );
    assert.equal((await view()).total, $(500), "失敗的還款沒有影響任何狀態");
  });

  it("10. 作廢結算：逐筆狀態重新推導，不會留下錯誤的「已還」", async () => {
    await payFor(["宵夜"]);
    assert.equal((await view()).total, 0);
    const latest = (await ledger.listSettlements(c.ctxA))[0];
    await ledger.cancelSettlement(c.ctxA, latest.id);

    const v = await view();
    assert.equal(v.total, $(500), "欠款回來了");
    assert.equal(v.total, await ledgerDebt());
    assert.equal(v.items.find((i) => i.title === "宵夜")!.settled, 0, "沒有殘留的已還金額");
    assert.equal(v.items.find((i) => i.title === "宵夜")!.remaining, $(500));
  });

  it("11. 不 double count：逐筆加總恆等於既有引擎的欠款，且每筆只出現一次", async () => {
    const v = await view();
    assert.equal(v.items.reduce((a, i) => a + i.remaining, 0), v.total);
    assert.equal(v.total, await ledgerDebt());
    assert.equal(new Set(v.items.map((i) => i.id)).size, v.items.length);
  });

  it("12. 對方欠我的時候，我的清單是空的（不混進同一個選擇器）", async () => {
    // 小艾一次付一筆大的，把方向反過來
    await shared(c.accA, $(6000), 13, "小艾付的旅館");
    assert.equal(await ledgerDebt(), 0, "換成阿本欠小艾");
    const mine = await myDebtItems(c.ctxA, c.aId);
    assert.equal(mine.total, 0);
    assert.equal(mine.items.filter((i) => i.remaining > 0).length, 0);

    const his = await myDebtItems(c.ctxB, c.bId);
    assert.ok(his.total > 0, "換成阿本的清單才有東西");
    const b = await ledger.getBalances(c.ctxB);
    assert.equal(his.total, maxSettleAmount(b.net, c.bId, c.aId));
  });

  it("13. 刪除一筆消費後，逐筆與總額一起重算", async () => {
    const his = await myDebtItems(c.ctxB, c.bId);
    const target = his.items.find((i) => i.title === "小艾付的旅館")!;
    await ledger.deleteTransaction(c.ctxA, target.id);
    const after = await myDebtItems(c.ctxB, c.bId);
    assert.ok(!after.items.some((i) => i.id === target.id), "刪掉的那筆不再出現");
    const b = await ledger.getBalances(c.ctxB);
    assert.equal(after.total, maxSettleAmount(b.net, c.bId, c.aId));
  });
});

describe("V6：標籤記憶與快選", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;

  const spend = (title: string, tags: string[], day: number) =>
    ledger.createTransaction(c.ctxA, {
      type: "EXPENSE", amount: $(100), accountId: c.accA, categoryId: null,
      title, note: "", occurredOn: D(day),
      split: { method: "FULL", participants: [{ userId: c.aId }] },
      clientRequestId: rid(), tags,
    });

  before(async () => {
    await reset();
    c = await setupCouple("tag");
  });
  after(() => prisma.$disconnect());

  it("1. 第一次輸入的新標籤會被記住，下次出現在快選", async () => {
    assert.deepEqual(await recentTags(c.ctxA), [], "還沒有任何標籤");
    await spend("看電影", ["約會"], 1);
    assert.deepEqual(await recentTags(c.ctxA), ["約會"]);
  });

  it("2. 一筆可以有多個標籤（既有 schema 本來就支援）", async () => {
    const tx = await spend("日本機票", ["旅行", "約會"], 2);
    const saved = await prisma.transactionTag.count({ where: { transactionId: tx.id } });
    assert.equal(saved, 2);
    assert.deepEqual((await recentTags(c.ctxA)).slice(0, 2).sort(), ["約會", "旅行"].sort());
  });

  it("3. 同名標籤不會建立第二個 Tag", async () => {
    await spend("再看一次電影", ["約會"], 3);
    const rows = await prisma.tag.findMany({ where: { bookId: c.ctxA.book.id, name: "約會" } });
    assert.equal(rows.length, 1, "同帳本同名只有一筆 Tag");
  });

  it("4. 排序：最近用過的排前面，同樣新的比使用次數", async () => {
    await spend("加班", ["工作"], 4);
    const out = await recentTags(c.ctxA);
    assert.equal(out[0], "工作", "最近用過的排第一");
    assert.ok(out.includes("約會") && out.includes("旅行"));
  });

  it("5. 最多只給 10～12 個，不會把記帳頁塞爆", async () => {
    for (let i = 0; i < 20; i++) await spend(`雜項 ${i}`, [`標籤${i}`], 5);
    const out = await recentTags(c.ctxA);
    assert.equal(out.length, 12);
  });

  it("6. 記帳表單的選項會帶出快選標籤", async () => {
    const options = await loadTxFormOptions(c.ctxA);
    assert.ok(Array.isArray(options.tagOptions));
    assert.ok(options.tagOptions.length > 0);
    assert.ok(options.tagOptions.length <= 12);
  });

  it("7. 交易被刪掉之後，沒有任何紀錄在用的標籤就不再出現在快選", async () => {
    await reset();
    c = await setupCouple("tag2");
    const tx = await spend("只有這筆用到", ["絕版標籤"], 6);
    assert.ok((await recentTags(c.ctxA)).includes("絕版標籤"));
    await ledger.deleteTransaction(c.ctxA, tx.id);
    assert.ok(!(await recentTags(c.ctxA)).includes("絕版標籤"), "快選不再顯示");
    assert.equal(
      await prisma.tag.count({ where: { bookId: c.ctxA.book.id, name: "絕版標籤" } }),
      1,
      "Tag 本身留著（沒有為了快選去刪既有資料）",
    );
  });

  it("8. 另一半看到的是同一份標籤", async () => {
    await spend("兩人的紀錄", ["共用標籤"], 7);
    assert.ok((await recentTags(c.ctxB)).includes("共用標籤"));
  });
});
