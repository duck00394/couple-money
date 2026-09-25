import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../../src/server/domain/errors";
import {
  clampDay, computeNextDueDate, daysInMonth, dueState, isDue, nextOccurrenceAfter,
  occurrenceOnOrAfter, scheduleLabel, validateSchedule, type RecurringSchedule,
} from "../../src/server/domain/recurring";

const weekly = (dayOfWeek: number): RecurringSchedule => ({ frequency: "WEEKLY", dayOfWeek });
const monthly = (dayOfMonth: number): RecurringSchedule => ({ frequency: "MONTHLY", dayOfMonth });
const yearly = (month: number, dayOfMonth: number): RecurringSchedule => ({ frequency: "YEARLY", month, dayOfMonth });
const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : "NOT_DOMAIN_ERROR";
  }
  return null;
};

describe("Phase 3-3 固定支出週期", () => {
  it("每週：找出當天或之後最近的星期幾", () => {
    // 2026-09-18 是週五
    assert.equal(occurrenceOnOrAfter(weekly(5), "2026-09-18"), "2026-09-18", "當天就是週五");
    assert.equal(occurrenceOnOrAfter(weekly(1), "2026-09-18"), "2026-09-21", "下週一");
    assert.equal(occurrenceOnOrAfter(weekly(0), "2026-09-18"), "2026-09-20", "週日");
    assert.equal(nextOccurrenceAfter(weekly(5), "2026-09-18"), "2026-09-25", "每 7 天");
  });

  it("每月：當月還沒到就是這個月，過了就是下個月（含跨年）", () => {
    assert.equal(occurrenceOnOrAfter(monthly(1), "2026-09-01"), "2026-09-01");
    assert.equal(occurrenceOnOrAfter(monthly(1), "2026-09-02"), "2026-10-01");
    assert.equal(occurrenceOnOrAfter(monthly(15), "2026-09-18"), "2026-10-15");
    assert.equal(nextOccurrenceAfter(monthly(1), "2026-12-01"), "2027-01-01", "跨年");
  });

  it("每年：指定月份 + 日期", () => {
    assert.equal(occurrenceOnOrAfter(yearly(1, 15), "2026-09-18"), "2027-01-15");
    assert.equal(occurrenceOnOrAfter(yearly(12, 25), "2026-09-18"), "2026-12-25");
    assert.equal(nextOccurrenceAfter(yearly(1, 15), "2026-01-15"), "2027-01-15");
  });

  it("月底不存在的日期 → 該月最後一天（含閏年）", () => {
    assert.equal(daysInMonth(2026, 2), 28);
    assert.equal(daysInMonth(2028, 2), 29, "2028 是閏年");
    assert.equal(clampDay(2026, 2, 31), "2026-02-28");
    assert.equal(clampDay(2028, 2, 31), "2028-02-29");
    assert.equal(clampDay(2026, 4, 31), "2026-04-30");
    assert.equal(occurrenceOnOrAfter(monthly(31), "2026-02-01"), "2026-02-28");
    assert.equal(nextOccurrenceAfter(monthly(31), "2026-01-31"), "2026-02-28");
    assert.equal(nextOccurrenceAfter(monthly(31), "2026-02-28"), "2026-03-31", "下個月又回到 31 日");
    assert.equal(occurrenceOnOrAfter(yearly(2, 30), "2026-01-01"), "2026-02-28");
  });

  it("下一次應付日：建立與重新啟用都從今天算起（不補歷史）", () => {
    // 開始日期在過去，今天是 9/18 → 下一次是 10/1，不會補 9/1
    assert.equal(computeNextDueDate(monthly(1), { startDate: "2026-01-01", today: "2026-09-18" }), "2026-10-01");
    // 開始日期在未來 → 從開始日期算
    assert.equal(computeNextDueDate(monthly(1), { startDate: "2026-11-05", today: "2026-09-18" }), "2026-12-01");
    // 今天剛好是應付日 → 就是今天
    assert.equal(computeNextDueDate(monthly(18), { startDate: "2026-01-01", today: "2026-09-18" }), "2026-09-18");
    // 產生之後：從應付日的隔天算，逾期時會排到下一期（可以逐期補產生）
    assert.equal(computeNextDueDate(monthly(1), { startDate: "2026-01-01", today: "2026-09-18", after: "2026-07-01" }), "2026-08-01");
    // 超過結束日期 → 已結束
    assert.equal(computeNextDueDate(monthly(1), { startDate: "2026-01-01", endDate: "2026-09-30", today: "2026-09-18", after: "2026-09-01" }), null);
  });

  it("到期狀態：逾期／今天／即將到期／已結束", () => {
    assert.equal(dueState("2026-09-15", "2026-09-18"), "OVERDUE");
    assert.equal(dueState("2026-09-18", "2026-09-18"), "TODAY");
    assert.equal(dueState("2026-10-01", "2026-09-18"), "UPCOMING");
    assert.equal(dueState(null, "2026-09-18"), "ENDED");
    assert.equal(isDue("2026-09-15", "2026-09-18"), true);
    assert.equal(isDue("2026-09-18", "2026-09-18"), true);
    assert.equal(isDue("2026-09-19", "2026-09-18"), false, "還沒到期不能產生");
    assert.equal(isDue(null, "2026-09-18"), false);
  });

  it("週期設定驗證與文字描述", () => {
    assert.equal(code(() => validateSchedule({ frequency: "WEEKLY", dayOfWeek: 7 })), "RECURRING_DAY_OF_WEEK");
    assert.equal(code(() => validateSchedule({ frequency: "MONTHLY", dayOfMonth: 0 })), "RECURRING_DAY_OF_MONTH");
    assert.equal(code(() => validateSchedule({ frequency: "MONTHLY", dayOfMonth: 32 })), "RECURRING_DAY_OF_MONTH");
    assert.equal(code(() => validateSchedule({ frequency: "YEARLY", dayOfMonth: 15, month: 13 })), "RECURRING_MONTH");
    assert.equal(code(() => validateSchedule({ frequency: "DAILY" as never })), "RECURRING_FREQUENCY");
    assert.doesNotThrow(() => validateSchedule(monthly(31)));
    assert.equal(scheduleLabel(weekly(3)), "每週三");
    assert.equal(scheduleLabel(monthly(1)), "每月 1 日");
    assert.ok(scheduleLabel(monthly(31)).includes("最後一天"));
    assert.equal(scheduleLabel(yearly(1, 15)), "每年 1 月 15 日");
  });

  it("日期計算不受時區影響（台灣 9/18 不會變成 9/17）", () => {
    for (const day of ["2026-01-01", "2026-03-01", "2026-09-18", "2026-12-31"]) {
      assert.equal(occurrenceOnOrAfter(monthly(Number(day.slice(8))), day), day);
    }
  });
});
