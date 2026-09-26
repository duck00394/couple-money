import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDebtItems, type DebtSourceTx } from "../../src/server/domain/debt-items";
import { netPositions, maxSettleAmount } from "../../src/server/domain/balance";

const ME = "me";
const YOU = "you";
const $ = (n: number) => n * 100;

let seq = 0;
/** 小艾（ME）與阿本（YOU）的一筆消費：payer 付全額、兩人平分。 */
const shared = (payer: string, amount: number, day: number, title = "消費"): DebtSourceTx => ({
  id: `t${++seq}`,
  type: "EXPENSE",
  dateKey: `2026-09-${String(day).padStart(2, "0")}`,
  title,
  icon: "tag",
  amount,
  payments: [{ accountId: `acc-${payer}`, userId: payer, amount }],
  splits: [{ userId: ME, amount: amount / 2 }, { userId: YOU, amount: amount / 2 }],
});

/** 共同帳戶付的（userId = null）：依既有規則不產生個人欠款。 */
const jointPaid = (amount: number, day: number): DebtSourceTx => ({
  ...shared(ME, amount, day, "共同帳戶付"),
  payments: [{ accountId: "joint", userId: null, amount }],
});

/** 一筆結算：ME 還給 YOU。 */
const settlement = (amount: number, day: number): DebtSourceTx => ({
  id: `s${++seq}`,
  type: "SETTLEMENT",
  dateKey: `2026-09-${String(day).padStart(2, "0")}`,
  title: "結算",
  icon: "settle",
  amount,
  payments: [
    { accountId: "acc-me", userId: ME, amount },
    { accountId: "acc-you", userId: YOU, amount: -amount },
  ],
  splits: [],
});

/** 不變式：逐筆推導出來的總額，必須等於既有淨額引擎算出來的欠款。 */
function assertMatchesLedger(txs: DebtSourceTx[]) {
  const view = buildDebtItems(txs, ME);
  const net = netPositions(txs, [ME, YOU]);
  assert.equal(view.total, maxSettleAmount(net, ME, YOU), "逐筆加總必須等於 maxSettleAmount()");
  assert.equal(
    view.items.reduce((a, i) => a + i.remaining, 0),
    view.total,
    "每一筆的「尚未還款」加起來就是總額",
  );
  return view;
}

describe("V6：逐筆欠款（FIFO 推導）", () => {
  it("1. 一筆欠款：對方付 $1,000 平分 → 我欠 $500", () => {
    const v = assertMatchesLedger([shared(YOU, $(1000), 1, "晚餐")]);
    assert.equal(v.items.length, 1);
    assert.equal(v.items[0].amount, $(1000), "原始金額");
    assert.equal(v.items[0].myShare, $(500), "我應負擔");
    assert.equal(v.items[0].owed, $(500));
    assert.equal(v.items[0].settled, 0);
    assert.equal(v.items[0].remaining, $(500));
    assert.equal(v.total, $(500));
  });

  it("2. 多筆不同日期：由舊到新排列，總額正確", () => {
    const v = assertMatchesLedger([
      shared(YOU, $(1000), 1, "晚餐"),
      shared(YOU, $(600), 5, "電影"),
      shared(YOU, $(400), 9, "咖啡"),
    ]);
    assert.deepEqual(v.items.map((i) => i.title), ["晚餐", "電影", "咖啡"]);
    assert.deepEqual(v.items.map((i) => i.remaining), [$(500), $(300), $(200)]);
    assert.equal(v.total, $(1000));
  });

  it("3. 我自己付的那幾筆不會變成「我欠的項目」，而是拿去沖銷", () => {
    const v = assertMatchesLedger([
      shared(YOU, $(1000), 1, "對方付"), // 我欠 500
      shared(ME, $(400), 2, "我付"), //     我多付 200
    ]);
    assert.deepEqual(v.items.map((i) => i.title), ["對方付"], "只列出我欠的那一筆");
    assert.equal(v.items[0].settled, $(200));
    assert.equal(v.items[0].remaining, $(300));
    assert.equal(v.total, $(300));
  });

  it("4. 對方欠我的時候，清單是空的、總額是 0（不混進同一個選擇器）", () => {
    const txs = [shared(ME, $(1000), 1)];
    const v = buildDebtItems(txs, ME);
    assert.equal(v.total, 0);
    assert.equal(v.items.length, 0);
    const net = netPositions(txs, [ME, YOU]);
    assert.equal(maxSettleAmount(net, ME, YOU), 0, "我沒有欠款");
    assert.equal(maxSettleAmount(net, YOU, ME), $(500), "是對方欠我");
  });

  it("5. 共同帳戶付款不產生欠款，也不會出現在清單裡", () => {
    const v = assertMatchesLedger([jointPaid($(2000), 1), shared(YOU, $(1000), 2, "晚餐")]);
    assert.deepEqual(v.items.map((i) => i.title), ["晚餐"]);
    assert.equal(v.total, $(500));
  });

  it("6. 部分還款：FIFO 從最舊的開始沖銷", () => {
    const v = assertMatchesLedger([
      shared(YOU, $(1000), 1, "A"), // 欠 500
      shared(YOU, $(1000), 2, "B"), // 欠 500
      shared(YOU, $(1000), 3, "C"), // 欠 500
      settlement($(700), 4), //        還 700
    ]);
    assert.deepEqual(v.items.map((i) => [i.title, i.settled, i.remaining]), [
      ["A", $(500), 0],
      ["B", $(200), $(300)],
      ["C", 0, $(500)],
    ]);
    assert.equal(v.total, $(800));
    assert.equal(v.settled, $(700));
  });

  it("7. 已還清的項目 remaining = 0，不會再被算進可還金額", () => {
    const v = assertMatchesLedger([
      shared(YOU, $(1000), 1, "A"),
      shared(YOU, $(1000), 2, "B"),
      settlement($(500), 3),
    ]);
    const payable = v.items.filter((i) => i.remaining > 0);
    assert.deepEqual(payable.map((i) => i.title), ["B"]);
    assert.equal(payable.reduce((a, i) => a + i.remaining, 0), v.total);
  });

  it("8. 全額還款：欠款歸零，所有項目都是已還清", () => {
    const v = assertMatchesLedger([
      shared(YOU, $(1000), 1, "A"),
      shared(YOU, $(600), 2, "B"),
      settlement($(800), 3),
    ]);
    assert.equal(v.total, 0);
    assert.ok(v.items.every((i) => i.remaining === 0));
    assert.equal(v.unassignedCredit, 0);
  });

  it("9. 結算被作廢（從資料裡消失）→ 逐筆狀態自己恢復，不會留下錯誤的「已還」", () => {
    const base = [shared(YOU, $(1000), 1, "A"), shared(YOU, $(600), 2, "B")];
    const paid = assertMatchesLedger([...base, settlement($(800), 3)]);
    assert.equal(paid.total, 0);
    // 作廢 = 那筆 SETTLEMENT 不再出現在總帳裡
    const back = assertMatchesLedger(base);
    assert.equal(back.total, $(800));
    assert.deepEqual(back.items.map((i) => i.settled), [0, 0], "沒有殘留的已還金額");
    assert.deepEqual(back.items.map((i) => i.remaining), [$(500), $(300)]);
  });

  it("10. 退款會沖銷欠款（沿用同一條規則，不特別處理）", () => {
    const refund: DebtSourceTx = {
      id: "r1",
      type: "REFUND",
      dateKey: "2026-09-03",
      title: "退款",
      icon: "refund",
      amount: $(200),
      // 退款：錢回到對方帳戶（負的 payment），兩人各退一半
      payments: [{ accountId: "acc-you", userId: YOU, amount: -$(200) }],
      splits: [{ userId: ME, amount: -$(100) }, { userId: YOU, amount: -$(100) }],
    };
    const v = assertMatchesLedger([shared(YOU, $(1000), 1, "晚餐"), refund]);
    assert.equal(v.items[0].settled, $(100));
    assert.equal(v.total, $(400));
  });

  it("11. 沖銷額比欠款項目還多時，多的部分標成「未分配」，不亂猜", () => {
    // 先還了 $800，之後才出現 $500 的欠款
    const v = buildDebtItems([settlement($(800), 1), shared(YOU, $(1000), 2, "A")], ME);
    assert.equal(v.items[0].remaining, 0, "這筆被先前的沖銷額吃掉");
    assert.equal(v.total, 0);
    assert.equal(v.unassignedCredit, $(300), "多出來的 300 保守標成未分配");
  });

  it("12. 結算永遠不會變成「欠款項目」，即使是對方還錢給我", () => {
    // 對方還我錢（我是收款方）：這筆結算絕不能出現在「我欠的項目」裡
    const youPayMe: DebtSourceTx = {
      id: "s-you", type: "SETTLEMENT", dateKey: "2026-09-02", title: "阿本 還給 小艾", icon: "settle",
      amount: $(300),
      payments: [
        { accountId: "acc-you", userId: YOU, amount: $(300) },
        { accountId: "acc-me", userId: ME, amount: -$(300) },
      ],
      splits: [],
    };
    const v = assertMatchesLedger([shared(ME, $(600), 1, "我先付"), youPayMe, shared(YOU, $(1000), 5, "晚餐")]);
    assert.ok(!v.items.some((i) => i.title.includes("還給")), "結算不是欠款項目");
    assert.deepEqual(v.items.filter((i) => i.remaining > 0).map((i) => i.title), ["晚餐"]);
    assert.equal(v.total, $(500), "前面兩人已經互不相欠，這一輪只欠晚餐的一半");
  });

  it("13. 互不相欠之後翻頁：舊項目標成已還清，不再參與之後的沖銷", () => {
    const v = assertMatchesLedger([
      shared(YOU, $(1000), 1, "舊-A"), // 欠 500
      settlement($(500), 2), //           還清
      shared(YOU, $(600), 3, "新-B"), //  欠 300
    ]);
    assert.deepEqual(v.items.map((i) => [i.title, i.remaining]), [["舊-A", 0], ["新-B", $(300)]]);
    assert.equal(v.total, $(300));
    assert.equal(v.items.find((i) => i.title === "舊-A")!.settled, $(500), "舊的顯示已還清");
  });

  it("14. 已還清的項目最多只留最近幾筆，清單不會無限長", () => {
    const txs: DebtSourceTx[] = [];
    for (let i = 0; i < 25; i++) {
      txs.push(shared(YOU, $(100), 1, `舊-${i}`)); // 每筆欠 50
      txs.push(settlement($(50), 1)); //            馬上還清
    }
    txs.push(shared(YOU, $(1000), 2, "還沒還的"));
    const v = buildDebtItems(txs, ME, 10);
    assert.equal(v.items.filter((i) => i.remaining === 0).length, 10, "已還清的只留 10 筆");
    assert.deepEqual(v.items.filter((i) => i.remaining > 0).map((i) => i.title), ["還沒還的"]);
    assert.equal(v.total, $(500), "總額不受保留幾筆影響");
  });

  it("15. 不 double count：同一筆交易只會被算一次", () => {
    const txs = [shared(YOU, $(1000), 1, "A"), shared(YOU, $(1000), 2, "B")];
    const v = assertMatchesLedger(txs);
    assert.equal(v.items.length, 2);
    assert.equal(new Set(v.items.map((i) => i.id)).size, 2, "沒有重複的項目");
    assert.equal(v.total, $(1000), "不是 $2,000");
  });
});
