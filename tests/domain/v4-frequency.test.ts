import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  currentWeekStreak, EVERY_DAY, FREQUENCY_HINT, FREQUENCY_LABEL, isPerTime, isWeekly,
  longestWeekStreak, normalizeSchedule, weekCount, weeksOf,
} from "../../src/server/domain/streak";

/** V4：三種週期的純邏輯（每天最多一次／每週一次／做一次賺一次）。 */
describe("V4：任務週期", () => {
  it("1. 只有「每次」會被當成 per-time", () => {
    assert.equal(isPerTime("PER_TIME"), true);
    assert.equal(isPerTime("DAILY"), false);
    assert.equal(isPerTime("WEEKLY"), false);
    assert.equal(isPerTime("CUSTOM"), false);
  });

  it("2. 「每次」不排程：任何一天都能做，遮罩固定是每天", () => {
    assert.equal(normalizeSchedule("PER_TIME", 0), EVERY_DAY);
    assert.equal(normalizeSchedule("PER_TIME", 2), EVERY_DAY, "使用者選了星期幾也會被忽略");
    assert.equal(normalizeSchedule("DAILY", 0), EVERY_DAY);
  });

  it("3. 「每週」不綁星期幾：一週內任意一天都可以，所以遮罩也是每天", () => {
    assert.equal(isWeekly("WEEKLY"), true);
    assert.equal(isWeekly("DAILY"), false);
    assert.equal(normalizeSchedule("WEEKLY", 0), EVERY_DAY, "不用選星期幾也建得起來");
    assert.equal(normalizeSchedule("WEEKLY", 2), EVERY_DAY, "選了也會被忽略");
    assert.equal(normalizeSchedule("WEEKLY", 2 | 8), EVERY_DAY);
  });

  it("4. 「自訂」至少要挑一天", () => {
    assert.equal(normalizeSchedule("CUSTOM", 2 | 8), 10);
    assert.throws(() => normalizeSchedule("CUSTOM", 0));
  });

  it("5. 畫面上的說明是白話，不是程式用語", () => {
    for (const f of ["DAILY", "WEEKLY", "CUSTOM", "PER_TIME"] as const) {
      assert.ok(FREQUENCY_LABEL[f].length > 0);
      assert.ok(FREQUENCY_HINT[f].length > 0);
      assert.ok(!/daily|weekly|each|per_time/i.test(FREQUENCY_HINT[f]), `${f} 的說明不應該出現程式用語`);
    }
    assert.equal(FREQUENCY_HINT.DAILY, "每天最多一次");
    assert.equal(FREQUENCY_HINT.WEEKLY, "一週內完成一次即可");
    assert.equal(FREQUENCY_HINT.PER_TIME, "做一次賺一次，同一天可以重複完成");
  });

  // 2026-09-07 / 14 / 21 / 28 都是星期一
  it("6. 一週算一次：同一週做兩天也只算那一週完成", () => {
    assert.deepEqual([...weeksOf(["2026-09-07", "2026-09-09", "2026-09-13"])], ["2026-09-07"]);
    // 09-13 是星期日，仍然屬於 09-07 那一週
    assert.deepEqual([...weeksOf(["2026-09-13", "2026-09-14"])], ["2026-09-07", "2026-09-14"]);
  });

  it("7. 連續週數：這週還沒做不算中斷，中間漏一週就斷掉", () => {
    const weeks = weeksOf(["2026-09-07", "2026-09-14", "2026-09-21"]);
    assert.equal(currentWeekStreak(weeks, "2026-09-01", "2026-09-23").length, 3, "這週已完成");
    assert.equal(currentWeekStreak(weeks, "2026-09-01", "2026-09-29").length, 3, "下一週還沒做，不算中斷");
    assert.equal(currentWeekStreak(weeks, "2026-09-01", "2026-10-06").length, 0, "整整漏掉一週就斷了");
    assert.equal(longestWeekStreak(weeksOf(["2026-09-07", "2026-09-21", "2026-09-28"])), 2);
  });

  it("8. 本月的分母數的是「週」", () => {
    // 09-01（週二）~ 09-23（週三）橫跨 08-31、09-07、09-14、09-21 四個週一
    assert.equal(weekCount("2026-09-01", "2026-09-23", "2026-09-01"), 4);
    assert.equal(weekCount("2026-09-01", "2026-09-01", "2026-09-01"), 1);
  });
});
