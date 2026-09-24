import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freeAmount, percentText, progressOf, signedFundAmount, summarizeFund, summarizePending, type FundEntry } from "../../src/server/domain/fund";
import { currentStreak, isScheduled, longestStreak, maskLabel, prevScheduled, reachedMilestones, streakEndingAt } from "../../src/server/domain/streak";
import { addDays, dayOfWeek, diffDays, eachDay, monthStartKey, weekStart } from "../../src/lib/dates";
import { DomainError } from "../../src/server/domain/errors";

const $ = (n: number) => n * 100;

describe("基金計算", () => {
  it("實際基金金額只算有帳戶的實際紀錄；兩人投入、支出、獎金入金分開統計", () => {
    const e: FundEntry[] = [
      { type: "DEPOSIT", amount: signedFundAmount("DEPOSIT", $(10000)), userId: "me", accountId: "joint" },
      { type: "DEPOSIT", amount: signedFundAmount("DEPOSIT", $(8000)), userId: "you", accountId: "you-bank" },
      { type: "WITHDRAW", amount: signedFundAmount("WITHDRAW", $(1000)), userId: "me", accountId: "joint" },
      { type: "EXPENSE", amount: signedFundAmount("EXPENSE", $(1200)), userId: "you", accountId: "joint" },
      { type: "REWARD_DEPOSIT", amount: signedFundAmount("REWARD_DEPOSIT", $(80)), userId: null, accountId: "joint" },
      { type: "TASK_REWARD", amount: $(50), userId: "me", accountId: null }, // 舊版資料：不算實際金額
    ];
    const s = summarizeFund(e);
    assert.equal(s.balance, $(10000 + 8000 - 1000 - 1200 + 80));
    assert.equal(s.contributions.get("me"), $(9000));
    assert.equal(s.contributions.get("you"), $(8000));
    assert.equal(s.byAccount.get("joint"), $(10000 - 1000 - 1200 + 80));
    assert.equal(s.byAccount.get("you-bank"), $(8000));
    assert.equal([...s.byAccount.values()].reduce((a, b) => a + b, 0), s.balance, "實際金額 = 各帳戶指定額度加總");
    assert.equal(s.spent, $(1200));
    assert.equal(s.rewardDeposited, $(80));
  });
  it("尚未入金獎金 = 獎金 − 懲罰（可以為負），不算實際金額", () => {
    const p = summarizePending([{ userId: "me", amount: $(50) }, { userId: "you", amount: $(30) }], [{ userId: "me", amount: $(20) }]);
    assert.equal(p.net, $(60));
    assert.equal(p.rewardsByUser.get("me"), $(50));
    assert.equal(p.penaltiesByUser.get("me"), $(20));
    assert.equal(summarizePending([], [{ userId: null, amount: $(10) }]).net, -$(10));
  });
  it("可自由使用金額 = 餘額 − 已指定給基金", () => {
    assert.equal(freeAmount($(26450), $(16800)), $(9650));
    assert.equal(freeAmount($(1000), 0), $(1000));
    assert.equal(freeAmount($(1000), $(1000)), 0);
  });
  it("金額方向與驗證、進度百分比", () => {
    assert.equal(signedFundAmount("EXPENSE", 100), -100);
    assert.throws(() => signedFundAmount("DEPOSIT", 0), (e: unknown) => e instanceof DomainError);
    assert.equal(percentText($(18520), $(30000)), "61.7%");
    assert.equal(progressOf($(40000), $(30000)), 1);
    assert.equal(progressOf(5, null), null);
  });
});

describe("日期與連續打卡", () => {
  it("日期運算（跨月、跨年、閏年、週一開始）", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-03-01", -1), "2028-02-29");
    assert.equal(dayOfWeek("2026-09-17"), 4);
    assert.equal(diffDays("2026-10-01", "2026-09-17"), 14);
    assert.equal(weekStart("2026-09-17"), "2026-09-14");
    assert.equal(weekStart("2026-09-20"), "2026-09-14"); // 週日屬於前一週
    assert.equal(monthStartKey("2026-09-17"), "2026-09-01");
    assert.equal(eachDay("2026-09-29", "2026-10-02").length, 4);
  });

  it("每天任務：今天沒打卡不中斷、斷一天就重新計算、最長紀錄", () => {
    const start = "2026-09-01";
    const checked = new Set(["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-14", "2026-09-15", "2026-09-16"]);
    assert.deepEqual(currentStreak(checked, 127, start, "2026-09-17"), { length: 3, startDate: "2026-09-14" });
    checked.add("2026-09-17");
    assert.deepEqual(currentStreak(checked, 127, start, "2026-09-17"), { length: 4, startDate: "2026-09-14" });
    assert.equal(currentStreak(checked, 127, start, "2026-09-19").length, 0);
    assert.equal(longestStreak(checked, 127, start), 4);
  });

  it("自訂週一三五：非排定日不影響連續；每週一次", () => {
    const mask = (1 << 1) | (1 << 3) | (1 << 5);
    const start = "2026-09-01";
    assert.ok(isScheduled("2026-09-07", mask));
    assert.ok(!isScheduled("2026-09-08", mask));
    assert.equal(prevScheduled("2026-09-14", mask, start), "2026-09-11");
    const checked = new Set(["2026-09-07", "2026-09-09", "2026-09-11", "2026-09-14"]);
    assert.deepEqual(streakEndingAt(checked, mask, start, "2026-09-14"), { length: 4, startDate: "2026-09-07" });
    assert.equal(currentStreak(checked, mask, start, "2026-09-15").length, 4);
    assert.equal(maskLabel(mask), "每週一、三、五");
    const weekly = 1 << 6; // 每週六
    assert.equal(streakEndingAt(new Set(["2026-09-05", "2026-09-12"]), weekly, start, "2026-09-12").length, 2);
  });

  it("不算到開始日之前；里程碑只在剛好達成那天觸發", () => {
    const checked = new Set(["2026-09-14", "2026-09-15", "2026-09-16"]);
    assert.equal(streakEndingAt(checked, 127, "2026-09-15", "2026-09-16").length, 2);
    const ms = [{ days: 3 }, { days: 7 }, { days: 14 }, { days: 30 }];
    assert.deepEqual(reachedMilestones(ms, 3), [{ days: 3 }]);
    assert.deepEqual(reachedMilestones(ms, 4), []);
  });
});
