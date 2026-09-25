import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeAudit, EXCLUDED, groupLabel, isNotifiable, NOTIFIABLE, type AuditRow } from "../../src/server/domain/notification";
import { formatMoney } from "../../src/lib/money";

const $ = (n: number) => n * 100;
const base = (over: Partial<AuditRow>): AuditRow => ({
  id: "log1", action: "CREATE", entityType: "Transaction", entityId: "tx1",
  actorId: "ben", createdAt: new Date("2026-09-20T04:00:00Z"), before: null, after: null, ...over,
});
const show = (row: AuditRow, linked = {}) =>
  describeAudit(row, { actorName: "阿本", linked, money: formatMoney });

describe("Phase 3-4 H：最近動態（純邏輯）", () => {
  it("白名單以外的事件不會變成通知", () => {
    assert.equal(isNotifiable("Transaction", "CREATE"), true);
    for (const key of EXCLUDED) {
      const [entityType, action] = key.split(":");
      assert.equal(isNotifiable(entityType, action), false, `${key} 不該出現在動態`);
    }
    assert.equal(isNotifiable("Session", "CREATE"), false);
    assert.equal(isNotifiable("User", "UPDATE"), false);
    assert.equal(show(base({ action: "EXPORT" })), null, "匯出 CSV 不通知");
  });

  it("新增記帳：看得到類型、名稱與金額，並連到那筆記帳", () => {
    const v = show(base({ after: { type: "EXPENSE", amount: $(1000), title: "火鍋" } }), { alive: true });
    assert.equal(v!.text, "阿本 新增了一筆支出");
    assert.equal(v!.detail, "火鍋・$1,000");
    assert.equal(v!.href, "/transactions/tx1");
    assert.equal(v!.icon, "transaction");
  });

  it("修改記帳：金額有變就顯示變化", () => {
    const v = show(base({
      action: "UPDATE",
      before: { type: "EXPENSE", amount: $(1000), title: "火鍋" },
      after: { type: "EXPENSE", amount: $(800), title: "火鍋" },
    }), { alive: true });
    assert.equal(v!.text, "阿本 修改了一筆支出");
    assert.equal(v!.detail, "火鍋・$1,000・→ $800");
  });

  it("作廢記帳：仍然看得到做過這件事，但沒有連結（不能靠通知看已刪除的資料）", () => {
    const v = show(base({ action: "DELETE", before: { type: "EXPENSE", amount: $(500), title: "飲料" } }), { alive: false });
    assert.equal(v!.text, "阿本 作廢了一筆支出");
    assert.equal(v!.detail, "飲料・$500");
    assert.equal(v!.href, null, "已作廢就不給連結");
  });

  it("餘額調整：看得到帳戶與增減方向", () => {
    const up = show(base({ entityType: "Account", action: "ADJUST", entityId: "acc1", before: { balance: $(9000) }, after: { balance: $(9500), delta: $(500), transactionId: "tx9" } }), { name: "小艾銀行", transactionId: "tx9", transactionAlive: true });
    assert.equal(up!.text, "阿本 調整了帳戶餘額");
    assert.equal(up!.detail, "小艾銀行・+$500");
    assert.equal(up!.href, "/transactions/tx9");

    const down = show(base({ entityType: "Account", action: "ADJUST", entityId: "acc1", after: { delta: -$(200), transactionId: "tx9" } }), { name: "小艾銀行", transactionId: "tx9", transactionAlive: false });
    assert.equal(down!.detail, "小艾銀行・−$200");
    assert.equal(down!.href, "/accounts", "對應的調整已作廢就退回帳戶頁");
  });

  it("作廢餘額調整：顯示成「作廢了一筆餘額調整」", () => {
    const v = show(base({ action: "DELETE", before: { type: "ADJUSTMENT", amount: $(200), title: "餘額調整" } }), { alive: false });
    assert.equal(v!.text, "阿本 作廢了一筆餘額調整");
  });

  it("收據新增與刪除連到那筆記帳", () => {
    const add = show(base({ entityType: "Attachment", action: "CREATE", entityId: "att1", after: { transactionId: "tx5", fileName: "receipt.png", size: 1234 } }), { name: "火鍋", transactionId: "tx5", transactionAlive: true });
    assert.equal(add!.text, "阿本 加了一張收據");
    assert.equal(add!.detail, "火鍋");
    assert.equal(add!.href, "/transactions/tx5");
    const del = show(base({ entityType: "Attachment", action: "DELETE", entityId: "att1", before: { transactionId: "tx5", fileName: "receipt.png" } }), { transactionId: "tx5", transactionAlive: false });
    assert.equal(del!.text, "阿本 刪掉了一張收據");
    assert.equal(del!.href, null);
  });

  it("打卡、結算、基金、目標、固定支出都看得懂", () => {
    assert.equal(show(base({ entityType: "CheckIn", action: "CREATE", entityId: "ci1" }), { name: "每天運動", alive: true, transactionId: "task1" })!.text, "阿本 完成了打卡");
    assert.equal(show(base({ entityType: "CheckIn", action: "APPROVE", entityId: "ci1" }), { name: "每天運動", alive: true, transactionId: "task1" })!.href, "/tasks/task1");
    const settle = show(base({ entityType: "Settlement", action: "CREATE", entityId: "s1", after: { amount: $(300), fromUserId: "ben", toUserId: "amy", clientRequestId: "should-not-leak" } }));
    assert.equal(settle!.text, "阿本 結算了");
    assert.equal(settle!.detail, "$300");
    assert.equal(settle!.href, "/settle");
    assert.equal(show(base({ entityType: "Fund", action: "CREATE", entityId: "f1" }), { name: "日本旅遊", alive: true, transactionId: "f1" })!.href, "/funds/f1");
    assert.equal(show(base({ entityType: "Goal", action: "CREATE", entityId: "g1" }), { name: "買房頭期款", alive: true })!.detail, "買房頭期款");
    assert.equal(show(base({ entityType: "RecurringExpense", action: "PAUSE", entityId: "r1" }), { name: "房租", alive: true })!.text, "阿本 停用了固定支出");
  });

  it("只取白名單欄位，不會把 before／after 的內部資料吐出來", () => {
    const v = show(base({
      after: {
        type: "EXPENSE", amount: $(100), title: "測試",
        clientRequestId: "req-123", storageKey: "book/abc.png", passwordHash: "xxx",
        payments: [{ accountId: "acc1", amount: 10000 }], splits: [{ userId: "amy", amount: 5000 }],
      },
    }), { alive: true });
    const json = JSON.stringify(v);
    for (const secret of ["req-123", "storageKey", "passwordHash", "accountId", "splits", "payments"]) {
      assert.ok(!json.includes(secret), `不該外洩 ${secret}`);
    }
  });

  it("超長文字會被截斷，避免版面被撐破", () => {
    const v = show(base({ after: { type: "EXPENSE", amount: $(1), title: "超長名稱".repeat(30) } }), { alive: true });
    assert.ok(v!.detail.length < 80, v!.detail);
  });

  it("分組標題：今天／昨天／更早", () => {
    assert.equal(groupLabel("2026-09-20", "2026-09-20", "2026-09-19"), "今天");
    assert.equal(groupLabel("2026-09-19", "2026-09-20", "2026-09-19"), "昨天");
    assert.equal(groupLabel("2026-09-01", "2026-09-20", "2026-09-19"), "更早");
  });

  it("每個白名單事件都描述得出來，不會回 null", () => {
    for (const key of Object.keys(NOTIFIABLE)) {
      const [entityType, action] = key.split(":");
      const v = show(base({ entityType, action }));
      assert.ok(v, `${key} 應該要描述得出來`);
      assert.ok(v!.text.startsWith("阿本 "), `${key}: ${v!.text}`);
    }
  });
});
