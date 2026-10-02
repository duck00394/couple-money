"use client";

/**
 * 試用模式的任務頁。
 *
 * 可以打卡、取消打卡、新增任務。獎勵是「打卡累積」—— 試用模式不做提領
 * （提領會產生轉帳交易與獎勵分類帳，那是正式模式才需要的完整流程）。
 */
import { useState } from "react";
import { DemoTaskRow } from "@/components/DemoTaskRow";
import { Button, Card, Empty, ErrorText, Field, Input, PageHeader, SectionTitle, Select, cx } from "@/components/ui";
import { formatMoney, parseAmount } from "@/lib/money";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export default function DemoTasksPage() {
  const { state, run, todayKey } = useDemo();
  const cards = select.taskCards(state, todayKey);
  const rewards = select.rewards(state, todayKey);

  const [name, setName] = useState("");
  const [reward, setReward] = useState("");
  const [assignee, setAssignee] = useState("JOINT");
  const [days, setDays] = useState<number[]>([]);
  const [error, setError] = useState<string>();

  const nameOf = (id: string) => state.users.find((u) => u.id === id)?.nickname ?? "";

  const submit = () => {
    const r = run({
      kind: "task.add",
      name,
      icon: "check-circle",
      assigneeId: assignee === "JOINT" ? null : assignee,
      rewardAmount: parseAmount(reward) ?? 0,
      weekdays: days,
    });
    setError(r?.error);
    if (!r?.error) {
      setName("");
      setReward("");
      setDays([]);
    }
  };

  const dueToday = cards.filter((c) => c.dueToday);
  const notToday = cards.filter((c) => !c.dueToday);

  return (
    <>
      <PageHeader title="任務" back="/demo" />
      <div className="px-4">
        {/* 兩個人的獎勵累積 */}
        <Card className="grid grid-cols-2 divide-x divide-line px-0 py-3 text-center" data-testid="demo-reward-summary">
          {state.users.map((u) => {
            const r = rewards.byUser.get(u.id);
            return (
              <div key={u.id} className="px-2">
                <p className="text-xs text-stone-500">{u.nickname}</p>
                <p className="amount mt-1 text-[17px] text-brand-700">+{formatMoney(r?.today ?? 0)}</p>
                <p className="mt-0.5 text-[11px] text-stone-400">累積 {formatMoney(r?.total ?? 0)}</p>
              </div>
            );
          })}
        </Card>

        <SectionTitle>今天要做</SectionTitle>
        <Card className="divide-y divide-line p-0" data-testid="demo-task-today">
          {dueToday.length === 0 ? (
            <Empty icon="sprout">今天沒有排定的任務</Empty>
          ) : (
            dueToday.map((c) => <DemoTaskRow key={`${c.id}:${c.subjectId}`} card={c} nickname={nameOf(c.subjectId)} />)
          )}
        </Card>

        {notToday.length > 0 && (
          <>
            <SectionTitle>其他日子</SectionTitle>
            <Card className="divide-y divide-line p-0">
              {notToday.map((c) => <DemoTaskRow key={`${c.id}:${c.subjectId}`} card={c} nickname={nameOf(c.subjectId)} />)}
            </Card>
          </>
        )}

        <SectionTitle>新增任務</SectionTitle>
        <Card className="space-y-3.5">
          <Field label="任務名稱">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：曬衣服" data-testid="demo-task-name" />
          </Field>
          <Field label="誰做">
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="JOINT">共同（兩個人各自要做）</option>
              {state.users.map((u) => <option key={u.id} value={u.id}>{u.nickname}</option>)}
            </Select>
          </Field>
          <Field label="完成一次的獎勵" hint="可以是 0">
            <Input inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value)} placeholder="0" />
          </Field>
          <Field label="哪幾天" hint="都不選 = 每天">
            <div className="flex gap-1.5">
              {WEEK.map((label, i) => {
                const on = days.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDays((d) => (on ? d.filter((x) => x !== i) : [...d, i].sort()))}
                    className={cx(
                      "h-9 flex-1 rounded-xl border-[1.5px] text-sm font-semibold transition-colors",
                      on ? "border-stone-800 bg-brand-500 text-white" : "border-line bg-white text-stone-500",
                    )}
                    aria-pressed={on}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button onClick={submit} disabled={!name.trim()} data-testid="demo-task-submit">新增任務</Button>
        </Card>
      </div>
    </>
  );
}
