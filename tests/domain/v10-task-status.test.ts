import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDoneToday, isPendingToday, type TaskTodayState } from "../../src/server/domain/task-status";

const card = (over: Partial<TaskTodayState> = {}): TaskTodayState => ({
  perTime: false,
  weekly: false,
  doneThisWeek: false,
  today: null,
  canCheckIn: true,
  ...over,
});

describe("V10：任務今天完成了沒（兩個清單互斥）", () => {
  it("1. 每日：還沒打卡 → 只在待做清單", () => {
    const c = card();
    assert.equal(isDoneToday(c), false);
    assert.equal(isPendingToday(c), true);
  });

  it("2. 每日：打完卡 → 只在佈告欄，不再出現在待做清單", () => {
    const c = card({ today: { status: "APPROVED" }, canCheckIn: false });
    assert.equal(isDoneToday(c), true);
    assert.equal(isPendingToday(c), false);
  });

  it("3. 每日：待確認也算完成（不要讓人重複打卡）", () => {
    const c = card({ today: { status: "PENDING" }, canCheckIn: false });
    assert.equal(isDoneToday(c), true);
    assert.equal(isPendingToday(c), false);
  });

  it("4. 被退回的打卡不算完成，要留在待做清單", () => {
    const c = card({ today: { status: "REJECTED" }, canCheckIn: true });
    assert.equal(isDoneToday(c), false);
    assert.equal(isPendingToday(c), true);
  });

  it("5. 每次任務：做過了也還可以再做，所以兩個清單都會有（刻意的）", () => {
    const c = card({ perTime: true, today: { status: "APPROVED" }, canCheckIn: true });
    assert.equal(isDoneToday(c), true, "佈告欄看得到成果");
    assert.equal(isPendingToday(c), true, "還留著「再一次」的入口");
  });

  it("6. 每週：這週完成過就算完成，今天沒打也一樣，而且不再出現在待做清單", () => {
    const done = card({ weekly: true, doneThisWeek: true, today: null, canCheckIn: false });
    assert.equal(isDoneToday(done), true);
    assert.equal(isPendingToday(done), false);

    const notYet = card({ weekly: true, doneThisWeek: false, today: null, canCheckIn: true });
    assert.equal(isDoneToday(notYet), false);
    assert.equal(isPendingToday(notYet), true);
  });

  it("7. 每週：今天有打卡但整週旗標是 false 時，以整週為準", () => {
    const c = card({ weekly: true, doneThisWeek: false, today: { status: "APPROVED" }, canCheckIn: true });
    assert.equal(isDoneToday(c), false, "每週看的是整週，不是今天那一筆");
    assert.equal(isPendingToday(c), true);
  });

  it("8. EACH：兩張卡各自判斷，一方完成不會影響另一方", () => {
    const mine = card({ today: { status: "APPROVED" }, canCheckIn: false });
    const partner = card({ today: null, canCheckIn: false }); // 對方那張卡永遠不能由我打卡
    assert.equal(isDoneToday(mine), true);
    assert.equal(isPendingToday(mine), false);
    assert.equal(isDoneToday(partner), false, "對方還沒做");
    assert.equal(isPendingToday(partner), true, "所以還要留在待做清單裡提醒");
  });

  it("9. 對方已完成的 EACH 卡只會出現在佈告欄", () => {
    const partnerDone = card({ today: { status: "APPROVED" }, canCheckIn: false });
    assert.equal(isDoneToday(partnerDone), true);
    assert.equal(isPendingToday(partnerDone), false);
  });

  it("10. 不變式：除了「每次」任務，兩個清單永遠互斥", () => {
    const combos: TaskTodayState[] = [];
    for (const weekly of [true, false]) {
      for (const doneThisWeek of [true, false]) {
        for (const status of [null, "APPROVED", "PENDING", "REJECTED"]) {
          for (const canCheckIn of [true, false]) {
            combos.push(card({ weekly, doneThisWeek, today: status ? { status } : null, canCheckIn }));
          }
        }
      }
    }
    for (const c of combos) {
      if (!isDoneToday(c)) continue;
      // 完成了就不該還留在待做清單 —— 除非它還能再打卡（每次任務）
      assert.equal(isPendingToday(c), c.canCheckIn, JSON.stringify(c));
    }
  });
});
