"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  addFromTransactionAction, addKeywordAction, addManualAction, convertToManualAction,
  createCategoryAction, createGroupAction, createTagAction, deleteCategoryAction, deleteGroupAction,
  deleteKeywordAction, deleteTagAction, removeEntryAction, renameCategoryAction, renameTagAction,
  seedStarterAction, updateEntryAction, updateGroupAction,
} from "@/app/actions/purchases";
import { formatMoney, toInputString } from "@/lib/money";
import { JOINT } from "@/server/domain/purchase";
import type { ActionState } from "@/server/actions";
import { ActionForm } from "./ActionForm";
import { ArtIcon } from "./ArtIcon";
import { Avatar, Button, Card, cx, DateInput, ErrorText, Field, Input } from "./ui";

export interface MemberOption {
  userId: string;
  nickname: string;
  avatarColor: string;
  avatarUrl: string | null;
}
export interface GroupOption {
  id: string;
  name: string;
  icon: string;
  tags: Array<{ id: string; name: string; isDefault: boolean }>;
}
/** 商品分類（吊娃／S娃／扭蛋／景品／一番賞／其他⋯⋯），整個帳本共用 */
export interface CategoryOption {
  id: string;
  name: string;
  isDefault: boolean;
}

/* ───────────────────────── 共用：歸屬與角色的 chip ───────────────────────── */

/**
 * 歸屬（共同／A／B）。
 *
 * 這是**購買歸屬**，不是付款人，也不是分帳比例：小艾刷卡買給阿本的公仔，
 * 付款人是小艾、歸屬是阿本。所以這裡永遠不會自動從交易帶值。
 */
export function OwnerChips({
  members, value, onChange, name = "ownerId",
}: {
  members: MemberOption[];
  value: string;
  onChange: (v: string) => void;
  name?: string;
}) {
  const opts = [{ userId: JOINT, nickname: "共同", avatarColor: "#f3e3be", avatarUrl: null }, ...members];
  return (
    <div className="flex flex-wrap gap-2" data-testid="owner-chips">
      <input type="hidden" name={name} value={value} />
      {opts.map((m) => (
        <button
          key={m.userId}
          type="button"
          aria-pressed={value === m.userId}
          onClick={() => onChange(m.userId)}
          className={cx(
            "press flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1.5 text-[13px] transition",
            value === m.userId
              ? "border-stone-800 bg-brand-500 font-semibold text-white shadow-xs"
              : "border-line bg-white text-stone-700",
          )}
        >
          <Avatar name={m.nickname} color={m.avatarColor} size={18} src={m.avatarUrl} />
          {m.nickname}
        </button>
      ))}
    </div>
  );
}

/** 角色 chip。預設角色排最前面、用虛線框標出來——它是落點，不是普通角色。 */
export function TagChips({
  tags, value, onChange, name = "tagId",
}: {
  tags: Array<{ id: string; name: string; isDefault: boolean }>;
  value: string;
  onChange: (v: string) => void;
  name?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="tag-chips-purchase">
      <input type="hidden" name={name} value={value} />
      {tags.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "press rounded-full px-3 py-1.5 text-[13px] transition",
            t.isDefault ? "border-[1.5px] border-dashed" : "border-[1.5px]",
            value === t.id
              ? "border-solid border-stone-800 bg-brand-500 font-semibold text-white shadow-xs"
              : t.isDefault
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-line bg-white text-stone-700",
          )}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}

/** 商品分類 chip。跟角色是兩回事：這是「買的是什麼東西」，角色是「上面是誰」。 */
export function CategoryChips({
  categories, value, onChange, name = "categoryId",
}: {
  categories: CategoryOption[];
  value: string;
  onChange: (v: string) => void;
  name?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="category-chips">
      <input type="hidden" name={name} value={value} />
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={value === c.id}
          onClick={() => onChange(c.id)}
          className={cx(
            "press rounded-full border-[1.5px] px-3 py-1.5 text-[13px] transition",
            value === c.id ? "border-stone-800 bg-brand-500 font-semibold text-white shadow-xs" : "border-line bg-white text-stone-700",
          )}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

/** 作品 chip。只有「沒有作品脈絡」的畫面才會出現。 */
function GroupChips({ groups, value, onChange }: { groups: GroupOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="group-chips">
      <input type="hidden" name="groupId" value={value} />
      {groups.map((g) => (
        <button
          key={g.id}
          type="button"
          aria-pressed={value === g.id}
          onClick={() => onChange(g.id)}
          className={cx(
            "press flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1.5 text-[13px] transition",
            value === g.id ? "border-stone-800 bg-brand-500 font-semibold text-white shadow-xs" : "border-line bg-white text-stone-700",
          )}
        >
          <ArtIcon name={g.icon} size={15} />
          {g.name}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── 作品管理 ───────────────────────── */

export function NewGroupForm() {
  const [state, action, pending] = useActionState(createGroupAction, undefined);
  return (
    <ActionForm action={action} className="space-y-3">
      <Field label="作品名稱" hint="例如：吉伊卡哇、排球少年">
        <Input name="name" required maxLength={20} placeholder="吉伊卡哇" />
      </Field>
      <p className="rounded-xl bg-brand-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
        建立時會自動附一個<b className="text-brand-700">預設角色</b>（一開始叫「全角色」），
        給一番賞、整套、跨角色或懶得細分的東西放。它可以改名，但不能刪除。
      </p>
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="text-sm text-brand-700">{state.ok}</p>}
      <Button className="w-full" disabled={pending} data-testid="create-group">
        {pending ? "建立中…" : "＋ 新增作品"}
      </Button>
    </ActionForm>
  );
}

export function GroupSettingsForm({ group }: { group: { id: string; name: string; icon: string; deletable: boolean; entryCount: number } }) {
  const [state, action, pending] = useActionState(updateGroupAction, undefined);
  const [del, delAction, delPending] = useActionState(deleteGroupAction, undefined);
  return (
    <div className="space-y-3">
      <ActionForm action={action} className="space-y-3">
        <input type="hidden" name="id" value={group.id} />
        <Field label="作品名稱">
          <Input name="name" required maxLength={20} defaultValue={group.name} />
        </Field>
        <ErrorText>{state?.error}</ErrorText>
        {state?.ok && <p className="text-sm text-brand-700">{state.ok}</p>}
        <Button variant="secondary" className="w-full" disabled={pending}>{pending ? "儲存中…" : "儲存"}</Button>
      </ActionForm>

      {group.deletable ? (
        <ActionForm action={delAction}>
          <input type="hidden" name="id" value={group.id} />
          <Button variant="danger" className="w-full" disabled={delPending} data-testid="delete-group">
            {delPending ? "刪除中…" : "刪除這個作品"}
          </Button>
          <ErrorText>{del?.error}</ErrorText>
        </ActionForm>
      ) : (
        <p className="rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600" data-testid="group-undeletable">
          底下還有 <b>{group.entryCount}</b> 筆購買紀錄，不能刪除這個作品。
          請先把它們移到別的作品或移除。
        </p>
      )}
    </div>
  );
}

/* ───────────────────────── 角色管理 ───────────────────────── */

export function TagRow({
  tag, groupId, canWrite,
}: {
  tag: { id: string; name: string; isDefault: boolean; count: number };
  groupId: string;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(renameTagAction, undefined);
  const [del, delAction, delPending] = useActionState(deleteTagAction, undefined);

  return (
    <div className={cx("px-4 py-3", tag.isDefault && "bg-brand-50")} data-testid="purchase-tag-row">
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-medium">
            <span className="truncate">{tag.name}</span>
            {tag.isDefault && (
              <span className="shrink-0 rounded-full border-[1.5px] border-stone-800 bg-brand-500 px-2 py-0.5 text-[11px] font-bold text-white" data-testid="default-tag-badge">
                預設
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">
            {tag.isDefault ? "沒對到角色時放這裡" : `${tag.count} 件`}
          </p>
        </div>
        {canWrite && (
          <>
            <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
              改名
            </button>
            {/* 預設角色不給刪除鈕：用畫面直接說明，不是等按了才跳錯誤 */}
            {!tag.isDefault && (
              <button type="button" onClick={() => setConfirming((v) => !v)} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-200" data-testid="delete-tag-open">
                刪除
              </button>
            )}
          </>
        )}
      </div>

      {editing && (
        <ActionForm action={action} className="mt-2.5 flex gap-2">
          <input type="hidden" name="id" value={tag.id} />
          <Input name="name" required maxLength={20} defaultValue={tag.name} aria-label={`${tag.name} 的新名稱`} className="h-10 text-sm" />
          <Button variant="secondary" className="h-10 shrink-0 px-4 text-sm" disabled={pending}>儲存</Button>
        </ActionForm>
      )}
      {editing && state?.error && <ErrorText>{state.error}</ErrorText>}

      {confirming && !tag.isDefault && (
        <div className="mt-2.5 rounded-xl border-[1.5px] border-red-600 bg-red-50 p-3" data-testid="delete-tag-confirm">
          <p className="text-sm font-semibold text-red-700">刪除「{tag.name}」？</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-600">
            底下的 <b>{tag.count} 筆購買紀錄會移到預設角色</b>，不會消失、也不會失去分類。
            之後想重新分類，一筆一筆改就好。
          </p>
          <div className="mt-2.5 grid grid-cols-[1fr_1.4fr] gap-2">
            <Button type="button" variant="soft" className="h-10 text-sm" onClick={() => setConfirming(false)}>不刪除</Button>
            <ActionForm action={delAction}>
              <input type="hidden" name="id" value={tag.id} />
              <input type="hidden" name="groupId" value={groupId} />
              <Button variant="danger" className="h-10 w-full text-sm" disabled={delPending} data-testid="delete-tag-confirm-btn">
                {delPending ? "刪除中…" : "刪除並移到預設"}
              </Button>
            </ActionForm>
          </div>
          <ErrorText>{del?.error}</ErrorText>
        </div>
      )}
      {!confirming && del?.ok && <p className="mt-2 text-xs font-semibold text-brand-700">{del.ok}</p>}
    </div>
  );
}

export function NewTagForm({ groupId }: { groupId: string }) {
  const [state, action, pending] = useActionState(createTagAction, undefined);
  return (
    <ActionForm action={action} className="flex gap-2 px-4 py-3">
      <input type="hidden" name="groupId" value={groupId} />
      <Input name="name" required maxLength={20} placeholder="新角色名稱" aria-label="新角色名稱" className="h-10 text-sm" />
      <Button variant="soft" className="h-10 shrink-0 px-4 text-sm" disabled={pending} data-testid="create-tag">
        {pending ? "新增中…" : "＋ 新增"}
      </Button>
      <ErrorText>{state?.error}</ErrorText>
    </ActionForm>
  );
}

/* ───────────────────────── 關鍵字 ───────────────────────── */

export function KeywordBox({
  groupId, tagId, words, canWrite,
}: {
  groupId: string;
  tagId: string | null;
  words: Array<{ id: string; word: string }>;
  canWrite: boolean;
}) {
  const [state, action, pending] = useActionState(addKeywordAction, undefined);
  const [, delAction] = useActionState(deleteKeywordAction, undefined);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {words.map((w) => (
          <span key={w.id} className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-stone-800 bg-brand-100 px-3 py-1 text-[13px] font-semibold shadow-xs">
            {w.word}
            {canWrite && (
              <ActionForm action={delAction} className="contents">
                <input type="hidden" name="id" value={w.id} />
                <button type="submit" aria-label={`移除關鍵字 ${w.word}`} className="text-stone-500">✕</button>
              </ActionForm>
            )}
          </span>
        ))}
        {words.length === 0 && <span className="text-xs text-stone-400">還沒有關鍵字</span>}
      </div>
      {canWrite && (
        <ActionForm action={action} className="mt-2.5 flex gap-2">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="tagId" value={tagId ?? ""} />
          <Input name="word" required maxLength={30} placeholder="新關鍵字" aria-label="新關鍵字" className="h-10 text-sm" />
          <Button variant="soft" className="h-10 shrink-0 px-4 text-sm" disabled={pending}>＋</Button>
        </ActionForm>
      )}
      <ErrorText>{state?.error}</ErrorText>
    </div>
  );
}

/* ───────────────────────── 新增購買紀錄 ───────────────────────── */

/**
 * 從既有交易加入。
 * 金額與日期沿用那筆記帳，所以這張表單只問作品、歸屬、角色。
 */
export function AddFromTransactionForm({
  transaction, groups, categories, members, fixedGroupId, returnTo, detected,
}: {
  transaction: { id: string; title: string; amount: number; occurredOn: string };
  groups: GroupOption[];
  categories: CategoryOption[];
  members: MemberOption[];
  /** 從作品頁進來時，作品由頁面脈絡決定，不再問 */
  fixedGroupId?: string;
  returnTo?: string;
  /** 關鍵字猜到的作品、商品分類與角色（這三個只是建議，歸屬永遠不猜） */
  detected?: { groupId: string; categoryId: string | null; tagId: string; word: string } | null;
}) {
  const [state, action, pending] = useActionState(addFromTransactionAction, undefined);
  const [groupId, setGroupId] = useState(fixedGroupId ?? detected?.groupId ?? groups[0]?.id ?? "");
  const group = groups.find((g) => g.id === groupId);
  const [tagId, setTagId] = useState(detected?.tagId ?? group?.tags.find((t) => t.isDefault)?.id ?? "");
  const [categoryId, setCategoryId] = useState(detected?.categoryId ?? categories[0]?.id ?? "");
  const [ownerId, setOwnerId] = useState(JOINT);

  const pickGroup = (id: string) => {
    setGroupId(id);
    setTagId(groups.find((g) => g.id === id)?.tags.find((t) => t.isDefault)?.id ?? "");
  };

  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="transactionId" value={transaction.id} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      {fixedGroupId && <input type="hidden" name="groupId" value={fixedGroupId} />}

      <Card quiet className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{transaction.title}</p>
          <p className="mt-0.5 text-xs text-stone-500">{transaction.occurredOn.replaceAll("-", "/")}</p>
        </div>
        <span className="amount text-[15px]">{formatMoney(transaction.amount)}</span>
      </Card>
      <p className="-mt-2 px-1 text-xs leading-relaxed text-stone-500">
        金額與日期沿用這筆記帳，不用重新輸入。
      </p>

      {!fixedGroupId && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-stone-600">作品</p>
          <GroupChips groups={groups} value={groupId} onChange={pickGroup} />
        </div>
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium text-stone-600">商品分類</p>
        <CategoryChips categories={categories} value={categoryId} onChange={setCategoryId} />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-stone-600">這東西是誰的</p>
        <OwnerChips members={members} value={ownerId} onChange={setOwnerId} />
        <p className="mt-1.5 text-xs text-stone-500">跟誰付錢無關，不會動到這筆記帳的分帳。</p>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-stone-600">角色</p>
        <TagChips tags={group?.tags ?? []} value={tagId} onChange={setTagId} />
        {detected && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-brand-700">
            <ArtIcon name="sparkles" size={14} />
            含「{detected.word}」，已先幫你選好，可以改
          </p>
        )}
      </div>

      <Field label="備註（選填）">
        <Input name="note" maxLength={200} placeholder="在哪買的、有什麼特別的" />
      </Field>

      <ErrorText>{state?.error}</ErrorText>
      <Button className="w-full" disabled={pending || !tagId || !categoryId} data-testid="add-purchase-submit">
        {pending ? "加入中…" : "加入購買紀錄"}
      </Button>
    </ActionForm>
  );
}

/**
 * 獨立的歷史購買。**不建立 Transaction**，所以不影響任何財務數字。
 */
export function AddManualForm({
  groups, categories, members, fixedGroupId, today,
}: {
  groups: GroupOption[];
  categories: CategoryOption[];
  members: MemberOption[];
  fixedGroupId?: string;
  today: string;
}) {
  const [state, action, pending] = useActionState(addManualAction, undefined);
  const [groupId, setGroupId] = useState(fixedGroupId ?? groups[0]?.id ?? "");
  const group = groups.find((g) => g.id === groupId);
  const [tagId, setTagId] = useState(group?.tags.find((t) => t.isDefault)?.id ?? "");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [ownerId, setOwnerId] = useState(JOINT);

  const pickGroup = (id: string) => {
    setGroupId(id);
    setTagId(groups.find((g) => g.id === id)?.tags.find((t) => t.isDefault)?.id ?? "");
  };

  return (
    <ActionForm action={action} className="space-y-4">
      {fixedGroupId && <input type="hidden" name="groupId" value={fixedGroupId} />}

      <p className="rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
        <b className="text-stone-700">這一筆不會產生記帳</b><br />
        不影響帳戶餘額、欠款、分帳、基金、預算與統計。它只是購買歷史。
      </p>

      {!fixedGroupId && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-stone-600">作品</p>
          <GroupChips groups={groups} value={groupId} onChange={pickGroup} />
        </div>
      )}

      <Field label="購買日期"><DateInput name="occurredOn" defaultValue={today} /></Field>
      <Field label="品項名稱"><Input name="title" required maxLength={50} placeholder="小八吊飾" /></Field>
      <Field label="金額"><Input name="amount" inputMode="decimal" required placeholder="350" /></Field>

      <div>
        <p className="mb-1.5 text-sm font-medium text-stone-600">商品分類</p>
        <CategoryChips categories={categories} value={categoryId} onChange={setCategoryId} />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-stone-600">這東西是誰的</p>
        <OwnerChips members={members} value={ownerId} onChange={setOwnerId} />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-stone-600">角色</p>
        <TagChips tags={group?.tags ?? []} value={tagId} onChange={setTagId} />
      </div>

      <Field label="備註（選填）"><Input name="note" maxLength={200} placeholder="在哪買的、有什麼特別的" /></Field>

      <ErrorText>{state?.error}</ErrorText>
      <Button className="w-full" disabled={pending || !tagId || !categoryId} data-testid="add-manual-submit">
        {pending ? "新增中…" : "新增購買紀錄"}
      </Button>
    </ActionForm>
  );
}

/* ───────────────────────── 編輯 ───────────────────────── */

export function EditEntryForm({
  entry, groups, categories, members, returnTo,
}: {
  entry: {
    id: string; groupId: string; categoryId: string; tagId: string; ownerId: string | null; note: string | null;
    title: string; amount: number; occurredOn: string; fromTransaction: boolean; transactionId: string | null;
    createdByName: string; updatedByName: string; createdAt: string; updatedAt: string;
  };
  groups: GroupOption[];
  categories: CategoryOption[];
  members: MemberOption[];
  returnTo?: string;
}) {
  const [state, action, pending] = useActionState(updateEntryAction, undefined);
  const [del, delAction, delPending] = useActionState(removeEntryAction, undefined);
  const [confirming, setConfirming] = useState(false);
  const [groupId, setGroupId] = useState(entry.groupId);
  const group = groups.find((g) => g.id === groupId);
  const [tagId, setTagId] = useState(entry.tagId);
  const [categoryId, setCategoryId] = useState(entry.categoryId);
  const [ownerId, setOwnerId] = useState(entry.ownerId ?? JOINT);

  const pickGroup = (id: string) => {
    setGroupId(id);
    // 換作品時角色一定要跟著換，不然會存到別的作品的角色
    setTagId(groups.find((g) => g.id === id)?.tags.find((t) => t.isDefault)?.id ?? "");
  };

  return (
    <div className="space-y-4">
      <ActionForm action={action} className="space-y-4">
        <input type="hidden" name="id" value={entry.id} />
        {!entry.fromTransaction && <input type="hidden" name="manual" value="1" />}

        {entry.fromTransaction ? (
          <>
            <p className="rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600" data-testid="from-tx-note">
              <b className="text-stone-700">金額與日期來自原始記帳</b><br />
              這裡是灰色的、不能改。如需修改，請回原記帳。購買紀錄不會、也不該蓋掉財務資料。
            </p>
            <div className="space-y-2">
              {([["品項名稱", entry.title], ["購買日期", entry.occurredOn.replaceAll("-", "/")], ["金額", formatMoney(entry.amount)]] as const).map(
                ([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-stone-300 bg-stone-100 px-3.5 py-2.5">
                    <span className="text-sm font-medium text-stone-600">{label}</span>
                    <span className="flex items-center gap-2">
                      <span className="tnum text-sm text-stone-800">{value}</span>
                      <span className="text-[11px] font-bold text-stone-500">唯讀</span>
                    </span>
                  </div>
                ),
              )}
            </div>
            {entry.transactionId && (
              <Link
                href={`/transactions/${entry.transactionId}`}
                className="press flex h-11 w-full items-center justify-center rounded-xl border-[1.5px] border-stone-800 bg-kraft text-sm font-semibold text-stone-800 shadow-xs"
              >
                回去改那筆記帳 ›
              </Link>
            )}
          </>
        ) : (
          <>
            <Field label="購買日期"><DateInput name="occurredOn" defaultValue={entry.occurredOn} /></Field>
            <Field label="品項名稱"><Input name="title" required maxLength={50} defaultValue={entry.title} /></Field>
            <Field label="金額"><Input name="amount" inputMode="decimal" required defaultValue={toInputString(entry.amount)} /></Field>
          </>
        )}

        <div>
          <p className="mb-1.5 text-sm font-medium text-stone-600">作品</p>
          <GroupChips groups={groups} value={groupId} onChange={pickGroup} />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-stone-600">商品分類</p>
          <CategoryChips categories={categories} value={categoryId} onChange={setCategoryId} />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-stone-600">這東西是誰的</p>
          <OwnerChips members={members} value={ownerId} onChange={setOwnerId} />
          <p className="mt-1.5 text-xs text-stone-500">跟誰付錢無關，改這裡不會動到任何記帳。</p>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-stone-600">角色</p>
          <TagChips tags={group?.tags ?? []} value={tagId} onChange={setTagId} />
        </div>

        <Field label="備註（選填）"><Input name="note" maxLength={200} defaultValue={entry.note ?? ""} /></Field>

        <ErrorText>{state?.error}</ErrorText>
        {state?.ok && <p className="text-sm text-brand-700">{state.ok}</p>}
        <Button className="w-full" disabled={pending || !tagId || !categoryId}>{pending ? "儲存中…" : "儲存"}</Button>
      </ActionForm>

      <Card quiet className="space-y-1 p-3 text-xs text-stone-500">
        <div className="flex justify-between"><span>建立</span><span>{entry.createdByName} ・ {entry.createdAt}</span></div>
        <div className="flex justify-between"><span>最後修改</span><span>{entry.updatedByName} ・ {entry.updatedAt}</span></div>
      </Card>

      {confirming ? (
        <div className="rounded-2xl border-[1.5px] border-red-600 bg-red-50 p-3.5" data-testid="remove-entry-confirm">
          <p className="text-sm font-semibold text-red-700">移除這筆購買紀錄？</p>
          {entry.fromTransaction && (
            <p className="mt-1.5 rounded-xl bg-white px-3 py-2 text-xs leading-relaxed text-stone-600">
              <b className="text-stone-800">✓ 記帳會留著</b><br />
              那筆消費不會被刪掉，餘額、欠款、分帳、統計全部不動。只是以後不再算進購買紀錄。
            </p>
          )}
          <div className="mt-2.5 grid grid-cols-[1fr_1.4fr] gap-2">
            <Button type="button" variant="soft" className="h-11 text-sm" onClick={() => setConfirming(false)}>不移除</Button>
            <ActionForm action={delAction}>
              <input type="hidden" name="id" value={entry.id} />
              {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
              <Button variant="danger" className="h-11 w-full text-sm" disabled={delPending} data-testid="remove-entry-confirm-btn">
                {delPending ? "移除中…" : "移除購買紀錄"}
              </Button>
            </ActionForm>
          </div>
          <ErrorText>{del?.error}</ErrorText>
        </div>
      ) : (
        <Button type="button" variant="danger" className="w-full" onClick={() => setConfirming(true)} data-testid="remove-entry-open">
          移除此購買紀錄
        </Button>
      )}
    </div>
  );
}

/** 原始記帳已作廢的那一筆：可以移除，也可以轉成手動紀錄留著。 */
export function VoidedEntryActions({ entry }: { entry: { id: string; title: string; amount: number } }) {
  const [conv, convAction, convPending] = useActionState(convertToManualAction, undefined);
  const [del, delAction, delPending] = useActionState(removeEntryAction, undefined);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <ActionForm action={convAction}>
          <input type="hidden" name="id" value={entry.id} />
          <Button variant="soft" className="h-10 w-full text-sm" disabled={convPending} data-testid="convert-to-manual">
            {convPending ? "轉換中…" : "轉成手動紀錄"}
          </Button>
        </ActionForm>
        <ActionForm action={delAction}>
          <input type="hidden" name="id" value={entry.id} />
          <Button variant="danger" className="h-10 w-full text-sm" disabled={delPending}>
            {delPending ? "移除中…" : "移除"}
          </Button>
        </ActionForm>
      </div>
      <ErrorText>{conv?.error ?? del?.error}</ErrorText>
    </div>
  );
}


/* ───────────────────────── 商品分類管理 ───────────────────────── */

export function CategoryRow({ category, canWrite }: { category: { id: string; name: string; isDefault: boolean; count: number }; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(renameCategoryAction, undefined);
  const [del, delAction, delPending] = useActionState(deleteCategoryAction, undefined);

  return (
    <div className={cx("px-4 py-3", category.isDefault && "bg-brand-50")} data-testid="purchase-category-row">
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-medium">
            <span className="truncate">{category.name}</span>
            {category.isDefault && (
              <span className="shrink-0 rounded-full border-[1.5px] border-stone-800 bg-brand-500 px-2 py-0.5 text-[11px] font-bold text-white" data-testid="default-category-badge">
                預設
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">
            {category.isDefault ? `刪除其他分類時放這裡 ・ ${category.count} 件` : `${category.count} 件`}
          </p>
        </div>
        {canWrite && (
          <>
            <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">改名</button>
            {/* 預設分類不給刪除鈕 */}
            {!category.isDefault && (
              <button type="button" onClick={() => setConfirming((v) => !v)} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-200" data-testid="delete-category-open">刪除</button>
            )}
          </>
        )}
      </div>

      {editing && (
        <ActionForm action={action} className="mt-2.5 flex gap-2">
          <input type="hidden" name="id" value={category.id} />
          <Input name="name" required maxLength={20} defaultValue={category.name} aria-label={`${category.name} 的新名稱`} className="h-10 text-sm" />
          <Button variant="secondary" className="h-10 shrink-0 px-4 text-sm" disabled={pending}>儲存</Button>
        </ActionForm>
      )}
      {editing && state?.error && <ErrorText>{state.error}</ErrorText>}

      {confirming && !category.isDefault && (
        <div className="mt-2.5 rounded-xl border-[1.5px] border-red-600 bg-red-50 p-3" data-testid="delete-category-confirm">
          <p className="text-sm font-semibold text-red-700">刪除「{category.name}」？</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-600">
            底下的 <b>{category.count} 筆購買紀錄會移到預設分類</b>，不會消失、作品與角色也不會變。
          </p>
          <div className="mt-2.5 grid grid-cols-[1fr_1.4fr] gap-2">
            <Button type="button" variant="soft" className="h-10 text-sm" onClick={() => setConfirming(false)}>不刪除</Button>
            <ActionForm action={delAction}>
              <input type="hidden" name="id" value={category.id} />
              <Button variant="danger" className="h-10 w-full text-sm" disabled={delPending} data-testid="delete-category-confirm-btn">
                {delPending ? "刪除中…" : "刪除並移到預設"}
              </Button>
            </ActionForm>
          </div>
          <ErrorText>{del?.error}</ErrorText>
        </div>
      )}
    </div>
  );
}

export function NewCategoryForm() {
  const [state, action, pending] = useActionState(createCategoryAction, undefined);
  return (
    <ActionForm action={action} className="flex gap-2 px-4 py-3">
      <Input name="name" required maxLength={20} placeholder="新商品分類（例如：徽章）" aria-label="新商品分類" className="h-10 text-sm" />
      <Button variant="soft" className="h-10 shrink-0 px-4 text-sm" disabled={pending} data-testid="create-category">
        {pending ? "新增中…" : "＋ 新增"}
      </Button>
      <ErrorText>{state?.error}</ErrorText>
    </ActionForm>
  );
}

/** 空狀態的一鍵建立：吉伊卡哇、排球少年與它們的角色，外加六種商品分類。 */
export function SeedStarterButton() {
  const [state, action, pending] = useActionState<ActionState>(seedStarterAction, undefined);
  return (
    <ActionForm action={action}>
      <Button variant="soft" className="w-full" disabled={pending} data-testid="seed-starter">
        {pending ? "建立中…" : "建立預設分類（吉伊卡哇、排球少年）"}
      </Button>
      <ErrorText>{state?.error}</ErrorText>
    </ActionForm>
  );
}

/**
 * 記帳之後的「要不要加入購買紀錄」詢問列。
 *
 * 關鍵字只負責提示，**按下「加入」才會真的建立**。按「不要」就只是把這個提示關掉，
 * 不寫任何資料；同一筆交易之後要補登，還是可以從交易明細頁手動加入。
 */
export function SuggestBar({
  suggestion, dismissTo,
}: {
  suggestion: { transactionId: string; groupName: string; categoryName: string | null; tagName: string; word: string };
  dismissTo: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <Card className="mb-3 border-brand-500" data-testid="purchase-suggest">
      <div className="flex items-start gap-2.5">
        <ArtIcon name="sparkles" size={18} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">偵測到「{suggestion.word}」，要加入購買紀錄嗎？</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-600">
            建議放到 {suggestion.groupName}
            {suggestion.categoryName ? ` ・ ${suggestion.categoryName}` : ""} ・ {suggestion.tagName}。
            加入時還可以改，歸屬要自己選。
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_1.4fr] gap-2">
        <Button type="button" variant="soft" className="h-10 text-sm" onClick={() => setDismissed(true)} data-testid="suggest-no">
          不要
        </Button>
        <Link
          href={`/purchases/new?tx=${suggestion.transactionId}&from=${encodeURIComponent(dismissTo)}`}
          className="press flex h-10 items-center justify-center rounded-xl border-[1.5px] border-stone-800 bg-brand-500 text-sm font-semibold text-white shadow-md"
          data-testid="suggest-yes"
        >
          加入
        </Link>
      </div>
    </Card>
  );
}
