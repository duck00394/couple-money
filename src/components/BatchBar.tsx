"use client";

import { createContext, startTransition, useActionState, useContext, useMemo, useState, type ReactNode } from "react";
import { batchAction } from "@/app/actions/batch";
import { MAX_BATCH } from "@/server/domain/batch";
import { showToast } from "./Toast";
import { Button, cx, ErrorText, Select } from "./ui";

interface BatchCtx {
  on: boolean;
  selected: Set<string>;
  toggle: (id: string) => void;
  busy: boolean;
}
const Ctx = createContext<BatchCtx | null>(null);

/** 交易列表左側的選取框。只有在「選取模式」下才會出現。 */
export function BatchCheckbox({ id, label }: { id: string; label: string }) {
  const ctx = useContext(Ctx);
  if (!ctx?.on) return null;
  const checked = ctx.selected.has(id);
  return (
    <label className="flex shrink-0 items-center pl-3" data-testid="batch-checkbox">
      <input
        type="checkbox"
        className="h-5 w-5 rounded-md border-stone-300 accent-brand-500 transition"
        checked={checked}
        disabled={ctx.busy}
        onChange={() => ctx.toggle(id)}
        aria-label={`選取 ${label}`}
      />
    </label>
  );
}

/**
 * 批次操作：選取模式開關 + 底部操作列。
 * 只會對「畫面上明確勾選的 id」動作，不會把「目前搜尋結果全部」當成已選取。
 */
export function BatchProvider({
  categories,
  children,
}: {
  categories: Array<{ id: string; name: string; icon: string; kind: string }>;
  children: ReactNode;
}) {
  const [on, setOn] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"" | "CATEGORY" | "TAGS">("");
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState("");
  const [state, run, busy] = useActionState(async (prev: Awaited<ReturnType<typeof batchAction>>, fd: FormData) => {
    const r = await batchAction(prev, fd);
    if (r?.ok) {
      showToast(r.ok);
      setSelected(new Set());
      setMode("");
      setTags("");
      setOn(false);
    }
    return r;
  }, undefined);

  const value = useMemo<BatchCtx>(
    () => ({
      on,
      selected,
      busy,
      toggle: (id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
    }),
    [on, selected, busy],
  );

  const count = selected.size;
  const submit = (action: string, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("action", action);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    for (const id of selected) fd.append("ids", id);
    startTransition(() => run(fd));
  };

  return (
    <Ctx.Provider value={value}>
      <div className="mt-3 flex items-center justify-between px-1">
        <button
          className="text-xs font-medium text-stone-500 underline underline-offset-2"
          onClick={() => {
            setOn((v) => !v);
            setSelected(new Set());
            setMode("");
          }}
          data-testid="batch-toggle"
        >
          {on ? "取消選取" : "選取多筆"}
        </button>
        {on && <span className="text-xs text-stone-400">一次最多 {MAX_BATCH} 筆</span>}
      </div>

      {children}

      {on && count > 0 && (
        <div className="sticky-submit-bar rise" data-testid="batch-bar">
          <div className="mx-auto max-w-md px-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-stone-800" data-testid="batch-count">已選 {count} 筆</span>
              <button className="text-xs font-medium text-stone-500 underline underline-offset-2" onClick={() => setSelected(new Set())} disabled={busy}>清除</button>
            </div>

            {mode === "CATEGORY" && (
              <div className="mt-2 flex gap-2">
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="批次改成的分類" className="flex-1">
                  <option value="">不分類</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}（{c.kind === "EXPENSE" ? "支出" : "收入"}）</option>
                  ))}
                </Select>
                <Button
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`把選取的 ${count} 筆改成這個分類？金額與分帳都不會變。`)) submit("CATEGORY", { categoryId });
                  }}
                >
                  {busy ? "處理中…" : "套用"}
                </Button>
              </div>
            )}

            {mode === "TAGS" && (
              <div className="mt-2 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="用空白分隔，例如：#日本 #機票"
                  aria-label="要加上的標籤"
                />
                <Button
                  className="shrink-0"
                  disabled={busy || !tags.trim()}
                  onClick={() => {
                    if (confirm(`為選取的 ${count} 筆加上標籤？原本的標籤會保留。`)) submit("TAGS", { tags });
                  }}
                >
                  {busy ? "處理中…" : "加上"}
                </Button>
              </div>
            )}

            <div className="mt-2 grid grid-cols-3 gap-2">
              <Button
                variant="secondary"
                className={cx(mode === "CATEGORY" && "ring-2 ring-brand-500")}
                disabled={busy}
                onClick={() => setMode((m) => (m === "CATEGORY" ? "" : "CATEGORY"))}
              >
                改分類
              </Button>
              <Button
                variant="secondary"
                className={cx(mode === "TAGS" && "ring-2 ring-brand-500")}
                disabled={busy}
                onClick={() => setMode((m) => (m === "TAGS" ? "" : "TAGS"))}
              >
                加標籤
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                data-testid="batch-delete"
                onClick={() => {
                  if (confirm(`刪除選取的 ${count} 筆？有任何一筆不能刪，整批都不會刪除。`)) submit("DELETE");
                }}
              >
                {busy ? "處理中…" : "刪除"}
              </Button>
            </div>
            <ErrorText>{state?.error}</ErrorText>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
