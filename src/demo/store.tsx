"use client";

/**
 * 試用模式的狀態容器。
 *
 * **只存在記憶體裡。** 沒有 localStorage、沒有 sessionStorage、沒有 IndexedDB、
 * 沒有 fetch、沒有 server action —— 所以它在結構上不可能寫到資料庫。
 * 重新整理頁面就回到預設資料（「重置」也只是重跑一次 createDemoState）。
 *
 * 錯誤處理刻意跟正式模式對齊：操作失敗時回傳 `{ error: 訊息 }`，形狀與
 * server action 的 ActionState 一樣，所以表單的錯誤顯示不用改。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DomainError } from "@/server/domain/errors";
import type { ActionState } from "@/server/actions";
import { createDemoState } from "./data";
import { applyOps } from "./engine";
import * as select from "./select";
import type { DemoOp, DemoState } from "./types";

interface DemoApi {
  state: DemoState;
  /** 套用一個操作。成功回 `{ ok }`，失敗回 `{ error }`，永遠不丟例外。 */
  run: (op: DemoOp) => ActionState;
  /**
   * 一次套用多個操作，**全有或全無**。
   *
   * 一個使用者動作有時候會產生兩筆變更（例如記帳時同時勾了「加進購買紀錄」）。
   * 分兩次 `run` 的話第二次會讀到還沒更新的 state，第一筆就被蓋掉了；
   * 這個方法把它們當成一個不可分割的動作，語意上也更接近正式模式的
   * 「同一個 $transaction 裡做完」。
   */
  runAll: (ops: DemoOp[]) => ActionState;
  /** 回到預設資料。 */
  reset: () => void;
  /** 今天（YYYY-MM-DD）。固定在 Provider 建立時算一次，避免同一畫面前後不一致。 */
  todayKey: string;
}

const Ctx = createContext<DemoApi | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  // useState 的初始化函式只跑一次；不要寫成 useState(createDemoState()) —— 那樣每次 render 都會重建
  const [state, setState] = useState<DemoState>(() => createDemoState());
  const [todayKey] = useState(() => select.today());

  /**
   * 套用操作。
   *
   * 刻意**同步**算出新 state（而不是用 `setState(prev => …)` 的更新函式）：
   * 那個更新函式是在 render 階段才跑的，`run` 早就回傳了，錯誤訊息會慢一拍。
   * 這裡讀的是這一輪 render 的 `state` —— 事件處理函式裡拿到的就是最新已提交的值，
   * 所以是安全的；需要連續兩個變更的場合請用 `runAll`，不要連呼叫兩次 `run`。
   */
  const runAll = useCallback(
    (ops: DemoOp[]): ActionState => {
      try {
        setState(applyOps(state, ops));
        return { ok: "已儲存" };
      } catch (e) {
        // DomainError 是可預期的商業錯誤（金額不對、重複打卡⋯⋯），原訊息給使用者看
        return { error: e instanceof DomainError ? e.message : "發生錯誤，請再試一次" };
      }
    },
    [state],
  );

  const run = useCallback((op: DemoOp) => runAll([op]), [runAll]);

  const reset = useCallback(() => setState(createDemoState()), []);

  const api = useMemo(() => ({ state, run, runAll, reset, todayKey }), [state, run, runAll, reset, todayKey]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useDemo(): DemoApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useDemo 必須放在 <DemoProvider> 裡面");
  return api;
}

/* ───────────────────────── 表單小工具 ───────────────────────── */

/** 跟 `src/server/actions.ts` 的 `str` 同一個行為，讓 Demo 能讀同一份 FormData 契約。 */
export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}
