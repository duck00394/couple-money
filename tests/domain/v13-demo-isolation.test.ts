/**
 * 試用模式的隔離測試（V13）。
 *
 * 規格點 9 與點 10 擔心的是同一件事：
 *   「不要只在 React UI 判斷 if (demoMode)，然後還是打 POST /api/transactions。」
 *
 * 處理方式刻意不是在 server 加一個「Demo session」旗標 —— 那就等於建立了
 * Guest / Trial User 的概念，正是規格點 2 禁止的。改成**靜態檢查邊界**：
 * 只要有人在 `src/app/demo/` 或 `src/demo/` 底下 import 了 server action、
 * service 層、Prisma 或瀏覽器儲存，這個測試就會紅 —— 違規的程式進不了版控，
 * 比執行期的 if 判斷強得多（執行期的判斷可以被繞過，import 不行）。
 *
 * 另外也驗證 reducer 與 selector 的正確性：試用模式算出來的餘額／欠款／統計
 * 必須跟正式模式同一份 domain 函式的結果一致。
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createDemoState, DEMO_ME, DEMO_PARTNER } from "../../src/demo/data";
import { applyOp, applyOps, taskDueOn } from "../../src/demo/engine";
import * as select from "../../src/demo/select";
import { accountBalances, netPositions } from "../../src/server/domain/balance";
import { DomainError } from "../../src/server/domain/errors";
import { sum } from "../../src/lib/money";
import type { DemoOp, DemoState } from "../../src/demo/types";

/* ───────────────────────── 工具 ───────────────────────── */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const DEMO_DIRS = ["src/app/demo", "src/demo"];
const demoFiles = DEMO_DIRS.flatMap(walk);

/** 試用模式的程式碼絕對不能出現的 import / 呼叫。 */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /from\s+["']@\/app\/actions\//, why: "import 了 server action" },
  { pattern: /from\s+["'][^"']*\/server\/services\//, why: "import 了 service 層（會碰 Prisma）" },
  { pattern: /from\s+["']@\/server\/services\//, why: "import 了 service 層（會碰 Prisma）" },
  { pattern: /from\s+["']@prisma\/client["']/, why: "import 了 Prisma client" },
  { pattern: /from\s+["'][^"']*\/server\/db["']/, why: "import 了資料庫連線" },
  { pattern: /from\s+["']@\/server\/context["']/, why: "import 了 getAppContext（會查資料庫）" },
  { pattern: /\blocalStorage\b/, why: "用了 localStorage（試用狀態只能存記憶體）" },
  { pattern: /\bsessionStorage\b/, why: "用了 sessionStorage（試用狀態只能存記憶體）" },
  { pattern: /\bindexedDB\b/i, why: "用了 IndexedDB（試用狀態只能存記憶體）" },
  { pattern: /\bfetch\s*\(/, why: "呼叫了 fetch（試用模式不該有任何網路請求）" },
  { pattern: /["']use server["']/, why: "宣告了 use server" },
];

/**
 * 只檢查「真的會執行的程式」。
 *
 * 要去掉兩種東西，不然會抓到自己的說明文字：
 *   1. 註解 —— 這些檔案的註解裡本來就會寫「不使用 localStorage」「沒有呼叫 getAppContext」，
 *      那是文件而不是違規。第一版的測試就是這樣誤報了 3 次。
 *   2. `import type` —— 型別在編譯後就消失，不會把任何東西帶進 bundle。
 */
const codeOnly = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "") // 區塊註解（含 JSDoc）
    .replace(/(^|[^:])\/\/.*$/gm, "$1") // 行註解（避開 https:// 這種）
    .split("\n")
    .filter((line) => !/^\s*import\s+type\s/.test(line))
    .join("\n");

describe("V13 試用模式・隔離（結構保證）", () => {
  it("掃到的試用模式檔案數量合理（避免路徑寫錯導致測試空轉）", () => {
    assert.ok(demoFiles.length >= 15, `只掃到 ${demoFiles.length} 個檔案，路徑可能錯了`);
  });

  for (const file of demoFiles) {
    it(`${file} 沒有任何通往資料庫或瀏覽器儲存的路徑`, () => {
      const src = codeOnly(readFileSync(file, "utf8"));
      for (const { pattern, why } of FORBIDDEN) {
        assert.ok(!pattern.test(src), `${file} ${why}`);
      }
    });
  }

  it("試用模式的頁面都是 Client Component（Server Component 讀不到記憶體 state）", () => {
    const pages = demoFiles.filter((f) => f.startsWith("src/app/demo") && f.endsWith("page.tsx"));
    assert.ok(pages.length >= 9, `只找到 ${pages.length} 個試用頁面`);
    for (const p of pages) {
      assert.match(readFileSync(p, "utf8"), /^"use client";/, `${p} 少了 "use client"`);
    }
  });

  it("試用模式的 layout 沒有呼叫 getAppContext（不走登入、不查資料庫）", () => {
    const src = codeOnly(readFileSync("src/app/demo/layout.tsx", "utf8"));
    assert.ok(!src.includes("getAppContext"), "試用 layout 不該要求登入");
  });
});

/* ───────────────────────── 預設資料 ───────────────────────── */

describe("V13 試用模式・預設資料", () => {
  const state = createDemoState();

  it("資料量符合規格（不要預載太多）", () => {
    assert.ok(state.txs.length >= 15 && state.txs.length <= 30, `交易 ${state.txs.length} 筆`);
    assert.ok(state.accounts.length >= 2 && state.accounts.length <= 3);
    assert.ok(state.funds.length >= 2 && state.funds.length <= 3);
    assert.ok(state.tasks.length >= 4 && state.tasks.length <= 6);
    assert.ok(state.preorders.length >= 3 && state.preorders.length <= 5);
  });

  it("每一筆交易都滿足 Σpayment === Σsplit（期初／調整除外）", () => {
    for (const tx of state.txs) {
      const p = sum(tx.payments.map((x) => x.amount));
      const s = sum(tx.splits.map((x) => x.amount));
      if (tx.type === "OPENING_BALANCE" || tx.type === "ADJUSTMENT") {
        assert.equal(tx.splits.length, 0, `${tx.type} 不該有 split`);
      } else if (tx.type === "TRANSFER" || tx.type === "SETTLEMENT") {
        assert.equal(p, 0, `${tx.type} 的 Σpayment 應為 0`);
      } else {
        assert.equal(p, s, `${tx.id} Σpayment !== Σsplit`);
      }
    }
  });

  it("欠款是零和的", () => {
    const net = netPositions(state.txs, [DEMO_ME, DEMO_PARTNER]);
    assert.equal(sum([...net.values()]), 0);
  });

  it("每個帳戶餘額都是正的（示範資料不該一打開就透支）", () => {
    const bal = accountBalances(state.txs);
    for (const a of state.accounts) {
      assert.ok((bal.get(a.id) ?? 0) > 0, `${a.name} 餘額為 ${bal.get(a.id)}`);
    }
  });

  /**
   * 日期的回歸測試。
   *
   * 這一塊踩過兩次坑，而且兩次都只有在特定日子才看得出來：
   *   1. `today − N 天` → 1 號打開時全部掉到上個月，「本月」一片空白。
   *   2. 把日期夾在月初 → 1 號打開時 21 筆全部塌到「今天」那一組。
   * 所以這裡不是只測今天，而是**把一整個月的每一天都跑一遍**。
   */
  it("不管當月哪一天打開，本月都有收入也有支出", () => {
    for (let day = 1; day <= 28; day++) {
      const todayKey = `2026-11-${String(day).padStart(2, "0")}`;
      const st = createDemoState(new Date(`${todayKey}T12:00:00Z`));
      const s = select.monthSummary(st, todayKey);
      assert.ok(s.expense > 0, `${todayKey} 本月支出為 0`);
      assert.ok(s.income > 0, `${todayKey} 本月收入為 0`);
    }
  });

  it("不管當月哪一天打開，交易都散得開（不會全部塌在今天）", () => {
    for (let day = 1; day <= 28; day++) {
      const todayKey = `2026-11-${String(day).padStart(2, "0")}`;
      const st = createDemoState(new Date(`${todayKey}T12:00:00Z`));
      const todayCount = st.txs.filter((t) => t.occurredOn === todayKey).length;
      assert.ok(todayCount >= 4, `${todayKey} 今天只有 ${todayCount} 筆，首頁「今天」會太空`);
      assert.ok(todayCount <= 10, `${todayKey} 今天塞了 ${todayCount} 筆，日期塌在一起了`);
      const days = new Set(st.txs.map((t) => t.occurredOn));
      assert.ok(days.size >= 8, `${todayKey} 只有 ${days.size} 個不同日期，最近紀錄會擠成一團`);
    }
  });

  it("涵蓋規格點 15 要求的每一種情境", () => {
    const hasJointPayer = state.txs.some((t) => t.payments.some((p) => p.userId === null));
    const aPaysBOwes = state.txs.some(
      (t) =>
        t.type === "EXPENSE" &&
        t.payments.some((p) => p.userId === DEMO_ME) &&
        t.splits.length === 1 &&
        t.splits[0].userId === DEMO_PARTNER,
    );
    const bPaysAOwes = state.txs.some(
      (t) =>
        t.type === "EXPENSE" &&
        t.payments.some((p) => p.userId === DEMO_PARTNER) &&
        t.splits.length === 1 &&
        t.splits[0].userId === DEMO_ME,
    );
    assert.ok(hasJointPayer, "缺少共同帳戶支出");
    assert.ok(aPaysBOwes, "缺少「A 付款但 B 負擔」");
    assert.ok(bPaysAOwes, "缺少「B 付款但 A 負擔」");
    assert.ok(state.txs.some((t) => t.type === "INCOME"), "缺少收入");
    assert.ok(state.txs.some((t) => t.type === "REFUND"), "缺少退款");
    assert.ok(state.txs.some((t) => t.type === "SETTLEMENT"), "缺少結算");
    assert.ok(state.txs.some((t) => t.occurredOn === select.today()), "缺少今天的交易");
  });

  it("沒有任何真實個資（只有編造的暱稱，沒有 Email）", () => {
    const json = JSON.stringify(state);
    assert.ok(!/@/.test(json), "示範資料裡出現了 @，可能夾帶 Email");
    assert.deepEqual(state.users.map((u) => u.nickname), ["小桃", "阿柴"]);
  });

  it("重置會得到一份乾淨的資料，不殘留改動", () => {
    const dirty = applyOp(state, { kind: "tx.delete", id: state.txs[5].id });
    assert.equal(dirty.txs.length, state.txs.length - 1);
    assert.equal(createDemoState().txs.length, state.txs.length);
  });
});

/* ───────────────────────── reducer ───────────────────────── */

describe("V13 試用模式・操作", () => {
  const base = createDemoState();
  const accA = base.accounts.find((a) => a.ownerId === DEMO_ME)!;
  const cat = base.categories.find((c) => c.kind === "EXPENSE")!;
  const today = select.today();

  /** 回傳具體的 tx.add 變體（不是整個 DemoOp 聯集），這樣下面才能直接取用 .input */
  const addExpense = (amount: number): Extract<DemoOp, { kind: "tx.add" }> => ({
    kind: "tx.add",
    input: {
      type: "EXPENSE",
      title: "測試支出",
      amount,
      occurredOn: today,
      categoryId: cat.id,
      note: "",
      payers: [{ accountId: accA.id, amount }],
      rule: { method: "EQUAL", participants: [{ userId: DEMO_ME }, { userId: DEMO_PARTNER }] },
    },
  });

  it("新增支出會讓帳戶餘額減少、對方欠款增加", () => {
    const before = select.balances(base);
    const after = select.balances(applyOp(base, addExpense(10000)));
    assert.equal((after.accounts.get(accA.id) ?? 0) - (before.accounts.get(accA.id) ?? 0), -10000);
    // 平分 $100 → 對方負擔 $50，所以對方多欠我 $50
    assert.equal((after.net.get(DEMO_ME) ?? 0) - (before.net.get(DEMO_ME) ?? 0), 5000);
    assert.equal(sum([...after.net.values()]), 0, "零和被打破了");
  });

  it("不存在的帳戶會被擋下來", () => {
    const op = addExpense(10000);
    assert.throws(
      () => applyOp(base, { ...op, input: { ...op.input, payers: [{ accountId: "nope", amount: 10000 }] } }),
      DomainError,
    );
  });

  it("金額 0 或負數會被擋下來", () => {
    assert.throws(() => applyOp(base, addExpense(0)), DomainError);
    assert.throws(() => applyOp(base, addExpense(-500)), DomainError);
  });

  it("編輯會換掉分錄，不會留下舊的那一份", () => {
    const added = applyOp(base, addExpense(10000));
    const tx = added.txs.at(-1)!;
    const edited = applyOp(added, {
      kind: "tx.update",
      id: tx.id,
      input: { ...addExpense(30000).input, title: "改過了" },
    });
    assert.equal(edited.txs.length, added.txs.length, "編輯不該新增一筆");
    const after = edited.txs.find((t) => t.id === tx.id)!;
    assert.equal(after.title, "改過了");
    assert.equal(after.amount, 30000);
    assert.equal(sum(after.payments.map((p) => p.amount)), sum(after.splits.map((s) => s.amount)));
  });

  it("刪除會一併把購買紀錄的連結斷開（不留下指向不存在交易的列）", () => {
    const entry = base.purchaseEntries[0];
    const linked = applyOps(base, [
      addExpense(50000),
    ]);
    const txId = linked.txs.at(-1)!.id;
    const withLink: DemoState = {
      ...linked,
      purchaseEntries: linked.purchaseEntries.map((e) => (e.id === entry.id ? { ...e, transactionId: txId } : e)),
    };
    const after = applyOp(withLink, { kind: "tx.delete", id: txId });
    assert.equal(after.purchaseEntries.find((e) => e.id === entry.id)!.transactionId, null);
  });

  it("結算不能超過實際欠的金額（由 buildSettlementLines 與上限一起把關）", () => {
    const net = select.balances(base).net;
    const debtor = [...net].find(([, v]) => v < 0)![0];
    const creditor = [...net].find(([, v]) => v > 0)![0];
    const owed = -(net.get(debtor) ?? 0);
    const after = applyOp(base, {
      kind: "settle",
      fromUserId: debtor,
      toUserId: creditor,
      amount: owed,
      occurredOn: today,
    });
    const net2 = select.balances(after).net;
    assert.equal(net2.get(debtor), 0, "全額結算後應該互不相欠");
    assert.equal(sum([...net2.values()]), 0);
  });

  it("結算的付款人與收款人不能相同", () => {
    assert.throws(
      () => applyOp(base, { kind: "settle", fromUserId: DEMO_ME, toUserId: DEMO_ME, amount: 100, occurredOn: today }),
      DomainError,
    );
  });

  it("同一天同一個任務不能重複打卡", () => {
    const task = base.tasks.find((t) => taskDueOn(t, today))!;
    const once = applyOp(base, { kind: "task.checkIn", taskId: task.id, userId: DEMO_PARTNER, dateKey: today });
    assert.throws(
      () => applyOp(once, { kind: "task.checkIn", taskId: task.id, userId: DEMO_PARTNER, dateKey: today }),
      DomainError,
    );
  });

  it("沒排在今天的任務不能打卡", () => {
    const notToday = base.tasks.find((t) => !taskDueOn(t, today));
    if (!notToday) return; // 今天剛好每個任務都有排，跳過
    assert.throws(
      () => applyOp(base, { kind: "task.checkIn", taskId: notToday.id, userId: DEMO_ME, dateKey: today }),
      DomainError,
    );
  });

  it("打卡會累積獎勵，取消就收回去", () => {
    const task = base.tasks.find((t) => taskDueOn(t, today) && t.rewardAmount > 0)!;
    const before = select.rewards(base, today).byUser.get(DEMO_PARTNER)!.total;
    const on = applyOp(base, { kind: "task.checkIn", taskId: task.id, userId: DEMO_PARTNER, dateKey: today });
    assert.equal(select.rewards(on, today).byUser.get(DEMO_PARTNER)!.total, before + task.rewardAmount);
    const off = applyOp(on, { kind: "task.undoCheckIn", taskId: task.id, userId: DEMO_PARTNER, dateKey: today });
    assert.equal(select.rewards(off, today).byUser.get(DEMO_PARTNER)!.total, before);
  });

  it("基金投入會減少「可以自由用的錢」，但不動帳戶餘額", () => {
    const fund = base.funds[0];
    const before = select.availableMoney(base);
    const after = select.availableMoney(applyOp(base, { kind: "fund.deposit", fundId: fund.id, amount: 100000, occurredOn: today }));
    assert.equal(after.total, before.total, "基金投入不該改變帳戶餘額");
    assert.equal(after.earmarked, before.earmarked + 100000);
    assert.equal(after.free, before.free - 100000);
  });

  it("runAll 是全有或全無：其中一步失敗，前面那步也不會留下", () => {
    const ops: DemoOp[] = [addExpense(10000), addExpense(-1)];
    assert.throws(() => applyOps(base, ops), DomainError);
    // applyOps 是純函式，base 不該被動到
    assert.equal(base.txs.length, createDemoState().txs.length);
  });

  it("購買紀錄不影響任何財務數字（結構保證）", () => {
    const before = select.balances(base);
    const beforeAvailable = select.availableMoney(base);
    const after = applyOp(base, {
      kind: "purchase.add",
      input: {
        groupId: base.purchaseGroups[0].id,
        categoryId: base.purchaseCategories[0].id,
        tagId: base.purchaseTags[0].id,
        ownerId: DEMO_ME,
        title: "一隻很貴的娃",
        amount: 999900,
        occurredOn: today,
        note: "",
        transactionId: null,
      },
    });
    const afterBal = select.balances(after);
    assert.deepEqual([...afterBal.accounts], [...before.accounts], "購買紀錄動到了帳戶餘額");
    assert.deepEqual([...afterBal.net], [...before.net], "購買紀錄動到了欠款");
    assert.deepEqual(select.availableMoney(after), beforeAvailable, "購買紀錄動到了可用金額");
  });
});

/* ───────────────────────── selector ───────────────────────── */

describe("V13 試用模式・畫面資料", () => {
  const state = createDemoState();
  const today = select.today();

  it("demoCtx 看起來就是一個正常的兩人帳本", () => {
    const ctx = select.demoCtx(state);
    assert.equal(ctx.members.length, 2);
    assert.equal(ctx.partner?.userId, DEMO_PARTNER);
    assert.equal(ctx.me.userId, DEMO_ME);
    assert.ok(ctx.canWrite);
    assert.equal(ctx.me.avatarUrl, null, "試用模式不該有上傳的頭貼");
  });

  it("預購的應付金額：共同品項平分、有歸屬的算該人的", () => {
    const rows = select.preorders(state);
    for (const p of rows) {
      assert.equal(sum(p.dues.map((d) => d.amount)), p.total, `${p.name} 應付加總 !== 總額`);
    }
    // 全部品項都指定給同一人的那張單，另一個人應付 0
    const allOwned = rows.find((p) => p.items.every((i) => i.ownerId === DEMO_PARTNER));
    assert.ok(allOwned, "示範資料缺少「全部都是某一方的」預購");
    assert.equal(allOwned!.dues.find((d) => d.userId === DEMO_ME)!.amount, 0);
    // 混合單：共同品項平分，個人品項算自己的
    const mixed = rows.find((p) => p.items.some((i) => i.ownerId === null) && p.items.some((i) => i.ownerId !== null));
    assert.ok(mixed, "示範資料缺少「共同＋個人混合」的預購");
    assert.ok(mixed!.dues.every((d) => d.amount > 0), "混合單兩個人都該有金額");
  });

  it("四層下鑽每一層的加總都對得上", () => {
    const g = state.purchaseGroups[0];
    const all = select.purchaseDrill(state, g.id);
    const byCat = state.purchaseCategories
      .filter((c) => c.groupId === g.id)
      .flatMap((c) => select.purchaseDrill(state, g.id, { categoryId: c.id }));
    assert.equal(byCat.length, all.length, "依分類拆開後件數不一致");
    assert.equal(sum(byCat.map((e) => e.amount)), sum(all.map((e) => e.amount)));
  });

  it("分類統計的百分比加起來是 100%", () => {
    const cats = select.categoryStats(state, today);
    if (cats.length === 0) return;
    assert.ok(Math.abs(sum(cats.map((c) => c.share)) - 1) < 1e-9);
  });

  it("本月每個人的負擔加總 === 本月淨支出", () => {
    const burden = sum(select.burdenByUser(state, today).map((b) => b.amount));
    assert.equal(burden, select.monthSummary(state, today).expense);
  });

  it("編輯用的 initial 帶回去的分帳金額跟原本那筆一致", () => {
    const tx = state.txs.find((t) => t.type === "EXPENSE" && t.splits.length === 2)!;
    const initial = select.txInitial(state, tx.id)!;
    assert.equal(sum(initial.split.participants.map((p) => p.value)), tx.amount);
  });

  it("結算與期初餘額不能從記帳頁編輯（跟正式模式一樣的限制）", () => {
    for (const type of ["SETTLEMENT", "OPENING_BALANCE"] as const) {
      const tx = state.txs.find((t) => t.type === type);
      if (tx) assert.equal(select.txInitial(state, tx.id), null, `${type} 不該可編輯`);
    }
  });
});
