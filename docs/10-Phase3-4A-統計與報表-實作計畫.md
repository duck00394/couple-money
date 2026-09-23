# Phase 3-4 A：統計與報表 `/stats` — 實作計畫（尚未實作）

## 0. 已確認的產品規則（來自你的指示）

1. 「我的支出」＝ **Split（實際負擔）**，不用 Payment
2. 「我的付款」＝ **Payment（實際掏錢）**，另外統計
3. 共同帳戶支付 **獨立呈現**，不硬分給任何一人
4. 收入／支出／轉帳／債務／基金 **沿用既有邏輯分開呈現**
5. **純讀取**：不新增 Transaction、不修改既有財務邏輯
6. **沿用既有常數／函式**，不建立第二套交易分類規則
7. 先做實用版本：不做 AI 分析、預測、複雜圖表

## 1. 可以直接重用的既有程式（不重寫）

| 既有資產 | 位置 | 在統計裡的角色 |
|---|---|---|
| `INCOME_EXPENSE_TYPES` | `domain/ledger.ts:41` | 唯一決定「什麼算收支」 |
| `DEBT_TYPES` / `affectsDebt()` | `domain/ledger.ts` / `domain/balance.ts` | 欠款區塊 |
| `totalsFromGroups()` / `SearchTotals` | `domain/search.ts` | **支出／退款／收入／淨支出／轉帳的唯一定義**，統計直接呼叫，不自己加總 |
| `buildTransactionWhere()` | `services/search.ts:12` | 日期區間 + 帳本範圍的唯一定義（`from`／`to` 已處理台灣時區與含頭含尾） |
| `EMPTY_FILTER` / `filterToQuery()` | `domain/search.ts` | 統計 → 記帳列表的鑽取連結 |
| `getBalances()` → `netPositions` / `suggestSettlements` | `services/ledger.ts:41` | 「目前欠款」區塊 |
| `fundBalances()` / `pendingByFund()` | `services/funds.ts` | 「基金」區塊（實際金額 vs 尚未入金） |
| `listCategories()` | `services/ledger.ts:358` | 分類名稱／icon |
| `monthRange()` / `toDateKey()` / `monthStartKey()` / `addDays()` | `lib/dates.ts` | 月份邊界一律走帳本時區 |
| `formatMoney()` | `lib/money.ts` | 顯示 |
| `Card` / `PageHeader` / `SectionTitle` / `ProgressBar` / `Empty` | `components/ui.tsx` | 版面，不做新的圖表元件庫 |
| `monthSummary()` | `services/ledger.ts:366` | **不刪除、不修改**；改由測試強制「統計的同月數字必須與它完全相等」 |

**關鍵原則**：統計層不寫任何 `type === "EXPENSE"` 的自訂分類邏輯，
一律經由 `buildTransactionWhere` + `totalsFromGroups`。這是規則 6 的具體落實方式。

## 2. ① 要新增／修改哪些檔案

### 新增

| 檔案 | 內容 |
|---|---|
| `src/server/domain/stats.ts` | **純函式**：`recentMonths()`、`monthKeyRange()`、`bucketByMonth()`、`categoryShares()`、`shareOf()`。無資料庫、可單元測試 |
| `src/server/services/stats.ts` | `monthStats(ctx, monthKey)`、`statsTrend(ctx, months)`、`statsOverview(ctx, monthKey)`。**只有 `findMany` / `groupBy`，沒有任何 `create` / `update` / `delete`** |
| `src/app/(app)/stats/page.tsx` | Server Component，`?m=YYYY-MM` |
| `src/components/StatsBars.tsx` | 純顯示元件：橫條佔比列（重用 `ProgressBar` 的樣式語彙，不引入圖表套件） |
| `tests/domain/phase3-stats.test.ts` | 純邏輯測試 |
| `tests/integration/phase3-stats.test.ts` | 真實 PostgreSQL 測試 |
| `tests/e2e/phase3-4.ts` | 兩支手機 E2E |

### 修改（都很小，且不碰財務邏輯）

| 檔案 | 改什麼 | 風險 |
|---|---|---|
| `src/components/BottomNav.tsx` | 「記帳」分頁的 `match` 加上 `/stats`（讓導覽列正確高亮） | 無（純導覽） |
| `src/app/(app)/more/page.tsx` | 「錢」區塊加一列「📊 統計與報表」 | 無 |
| `src/app/(app)/transactions/page.tsx` | 未篩選時的捷徑格加一個「📊 統計」 | 無（只加一個 `<Link>`） |
| `tests/e2e/couple-flow.ts` | `PHASES` 加入 `phase3-4 stats` | 測試 |
| `tests/e2e/ux-audit.ts` | `PAGES` 加入 `/stats` | 測試 |
| `README.md` | 進度勾選 | 文件 |

**不修改**：`domain/ledger.ts`、`domain/balance.ts`、`domain/search.ts`、`services/ledger.ts`、
`services/search.ts`、`services/funds.ts`、`prisma/schema.prisma`。

## 3. ② 每個統計數值的計算來源

期間一律 = `buildTransactionWhere(bookId, { ...EMPTY_FILTER, from: "YYYY-MM-01", to: 當月最後一天 })`，
已自動含 `deletedAt: null` + `status: "POSTED"` + 帳本隔離。

### 收支總覽

| 數值 | 來源 | 說明 |
|---|---|---|
| 支出 | `groupBy(type)` → `totalsFromGroups().expense` | 與搜尋頁完全同一個函式 |
| 退款 | 同上 `.refund` | |
| **淨支出** | 同上 `.netExpense`（＝支出 − 退款） | 畫面主數字 |
| 收入 | 同上 `.income` | 只有 `INCOME` 型別 |
| 轉帳 | 同上 `.transferCount` / `.transferAmount` | 獨立呈現，標示「不算收支」 |
| 筆數 | 同上 `.count` | |

結算、期初餘額、餘額調整**不會**進入以上任何一個數字（`totalsFromGroups` 本來就不處理它們）。

### 誰掏錢（Payment 側）

`transactionPayment.groupBy({ by: ["userId"], where: { transaction: <期間 where>, transaction.type in [EXPENSE, REFUND] } })`

| 列 | 來源 |
|---|---|
| 我付的 | `Σ payment.amount`（`userId = 我`） |
| 另一半付的 | `Σ payment.amount`（`userId = 另一半`） |
| **共同帳戶付的** | `Σ payment.amount`（`userId = null`）— **獨立一列，不分攤給任何人** |

- 退款會讓對應帳戶的 `payment.amount` 為負，因此這一側**自然是「淨掏錢」**。
- 不變式（會寫成測試）：**我付 + 另一半付 + 共同付 = 淨支出**。

### 誰負擔（Split 側）

`transactionSplit.groupBy({ by: ["userId"], where: { transaction: <期間 where>, type in [EXPENSE, REFUND] } })`

| 列 | 來源 |
|---|---|
| 我負擔 | `Σ split.amount`（`userId = 我`） |
| 另一半負擔 | `Σ split.amount`（`userId = 另一半`） |

- 退款的 split 是負值，自動沖銷負擔。
- 這一側**沒有「共同」**——共同帳戶付的錢，負擔仍然分給兩個人（決策 C1 只說「不產生欠款」，不是「沒有負擔」）。畫面要用一句話說明，避免兩側數字對不起來時使用者困惑。
- 不變式（會寫成測試）：**我負擔 + 另一半負擔 = 淨支出**，且**我負擔 = 既有 `monthSummary().myShare`**。

### 收入誰收到

`transactionPayment.groupBy({ by: ["userId"] })`，`type = INCOME`，取負號（收入的 payment 是負值）。
分成我／另一半／共同帳戶三列。**收入的「受益者」（split 側）這一版不做**（見待決定 #2）。

### 分類佔比

`groupBy({ by: ["categoryId", "type"] })`，`type in [EXPENSE, REFUND]`
→ 純函式 `categoryShares()`：同一分類的 `EXPENSE − REFUND`（退款沿用原始消費的 `categoryId`，已確認 `createRefund` 會複製），
排序後計算佔淨支出的百分比。`categoryId = null` 顯示為「未分類」。
每一列可點擊 → `/transactions?category=<id>&from=…&to=…`（重用 `filterToQuery`）。

### 最近 6 個月趨勢

**一次查詢**取回 `{ occurredAt, type, amount }`（6 個月區間），
再用純函式 `bucketByMonth()` 以 `toDateKey()`（帳本時區）切月、每個月丟進 `totalsFromGroups()`。
→ 不寫 `date_trunc` 原生 SQL、不做 6 次查詢、時區與其他地方完全一致。

### 目前欠款（狀態，不是當月）

`getBalances(ctx).debts[0]` → 直接顯示「誰欠誰多少」，標題明寫**「目前」**。

### 基金（狀態，不是當月）

`fundBalances()` + `pendingByFund()` → 每個基金「實際金額」與「尚未入金的獎金」分開顯示，
沿用既有規則：**尚未入金的獎金不是真實現金**。

## 4. ③ API / Service 設計

不新增任何 Route Handler、不新增 Server Action（純讀取，Server Component 直接呼叫 service）。

```ts
// src/server/domain/stats.ts（純函式）
export function recentMonths(todayKey: string, n: number): string[];          // ["2026-04" … "2026-09"]
export function monthKeyRange(month: string): { from: string; to: string };   // 含月底／閏年
export function bucketByMonth(
  rows: Array<{ occurredAt: Date; type: string; amount: number }>,
  months: string[],
): Array<{ month: string; totals: SearchTotals }>;                            // 空月份補 0，不缺列
export function categoryShares(
  rows: Array<{ categoryId: string | null; type: string; amount: number }>,
): Array<{ categoryId: string | null; amount: number; share: number }>;

// src/server/services/stats.ts（只讀）
export interface MonthStats {
  month: string; label: string;
  totals: SearchTotals;
  paid:   { me: number; partner: number; joint: number };   // Payment 側
  borne:  { me: number; partner: number };                  // Split 側
  income: { me: number; partner: number; joint: number };
  categories: Array<{ id: string | null; name: string; icon: string; amount: number; share: number }>;
}
export async function monthStats(ctx: BookContext, month: string): Promise<MonthStats>;
export async function statsTrend(ctx: BookContext, months: string[]): Promise<Array<{ month: string; netExpense: number; income: number }>>;
export async function statsOverview(ctx: BookContext, month: string);  // 上面兩個 + debts + funds，供頁面一次取用
```

- 沒有 `assertCanWrite`（純讀）；帳本隔離由 `buildTransactionWhere(ctx.book.id, …)` 保證。
- 無效的 `?m=` 參數（格式錯、未來月份、超過 12 個月前）→ **回退到本月**，不丟錯（與 `parseFilter` 的寬容策略一致）。

## 5. ④ `/stats` 頁面需要哪些資訊

由上而下（手機單欄）：

1. **月份切換**：`‹ 8 月｜9 月｜›`，最多回溯 12 個月，不能選未來
2. **本月主數字**：淨支出（大）＋ 收入；底下小字「支出 $X − 退款 $Y」
3. **誰掏錢**：我／另一半／共同帳戶 三條橫條 + 金額（加總 = 淨支出）
4. **誰負擔**：我／另一半 兩條橫條 + 金額（加總 = 淨支出）＋ 一句說明兩側的差別
5. **分類佔比**：由大到小，橫條 + 金額 + 百分比，每列可點進已篩選的記帳列表
6. **最近 6 個月趨勢**：淨支出與收入的迷你長條（純 CSS，不引入圖表套件）
7. **轉帳**：筆數 + 金額，明確標示「不算收支」
8. **目前欠款**：誰欠誰多少（標示「目前」，不是當月）
9. **目前基金**：每個基金的實際金額 / 尚未入金（標示「目前」）
10. 本月沒有任何資料時：`Empty` 提示 + 「去記一筆」

不做：圓餅圖、年度報表、匯出、預測、與去年同期比較。

## 6. ⑤ 測試案例

### 純邏輯（`tests/domain/phase3-stats.test.ts`）

1. `recentMonths` 跨年（2026-01 往回 6 個月 → 2025-08…2026-01）
2. `monthKeyRange`：31 天月、30 天月、2 月、閏年 2 月
3. `bucketByMonth` 用**帳本時區**切月：`2026-02-28T16:00:00Z`（＝台灣 3/1 00:00）要落在 **3 月**
4. `bucketByMonth` 沒有交易的月份補 0（不是缺列）
5. `categoryShares`：退款從**同一分類**扣除
6. `categoryShares`：`categoryId = null` 獨立一列「未分類」
7. `categoryShares`：淨支出為 0 時不會除以 0、不會產生 `NaN`
8. `categoryShares`：百分比加總 ≈ 100%（含四捨五入誤差上限）

### 整合（`tests/integration/phase3-stats.test.ts`，真實 PostgreSQL）

**與既有邏輯對帳（最重要，防止第二套規則）**

1. 同一個月：`monthStats().borne.me` **完全等於** `monthSummary().myShare`
2. 同一個月：`monthStats().totals` **完全等於** `searchTransactions(同期間 filter).totals`

**規則 1／2／3**

3. 平分 $1,000、我付款：我付 $1,000／另一半 $0／共同 $0；負擔各 $500
4. 共同帳戶付 $500：付款側 → 共同 $500（不歸給任何人）；負擔側兩人各 $250
5. 不變式：我付 + 另一半付 + 共同付 = 淨支出
6. 不變式：我負擔 + 另一半負擔 = 淨支出

**規則 4（各類型分開）**

7. 轉帳：不進支出／收入／負擔／付款，只出現在「轉帳」區塊
8. 結算：完全不影響任何統計數字
9. 期初餘額：不算收支
10. 退款：淨支出、我的負擔、分類金額三者同時被沖銷；退款**不**算收入
11. 基金投入（`FundTransaction`，不是 Transaction）：不出現在統計
12. 尚未入金的任務獎金：不出現在統計
13. 獎金入金（`TRANSFER` + `sourceType=REWARD_DEPOSIT`）：算轉帳，不算收支
14. 基金支出：算一般支出（維持既有規則），分類正確
15. 固定支出產生的交易：算支出

**邊界與隔離**

16. 月份邊界：台灣時間 3/1 00:30 算 3 月、2/28 23:59 算 2 月
17. 已刪除交易不計入；`status != POSTED` 不計入
18. 跨帳本：B 帳本的交易不出現在 A 的統計；用 B 的 categoryId 查也查不到
19. 趨勢 6 個月：中間沒有交易的月份是 0
20. 無效 `?m=` 參數回退本月，不丟例外
21. 唯讀成員可以讀統計，且**不會寫入任何資料**（前後 `AuditLog` 筆數不變）

### E2E（`tests/e2e/phase3-4.ts`，兩支手機）

22. `/stats` 顯示本月淨支出與收入
23. 三個付款人分佈與兩人負擔分佈都看得到，數字與記帳列表一致
24. 分類列可點擊 → 跳到已套用 `category` + `from` + `to` 的記帳列表
25. 切換到上個月，數字改變
26. 另一半打開 `/stats` 看到同一份數字
27. 另一個帳本的資料不出現（含原始 HTML／RSC payload 不外洩，沿用 Phase 3-2／3-3 的寫法）
28. `ux-audit` 的 `PAGES` 加入 `/stats`：390×664 與 320×568 都不破版、導覽列在

## 7. ⑥ 是否會影響既有財務邏輯

**不會。** 具體保證：

- 新增的 service 只有 `findMany` / `groupBy`，**沒有任何寫入**
- 不新增 `TxType`、不新增 Transaction、不新增 schema、不新增 migration
- 不修改 `domain/ledger.ts`、`domain/balance.ts`、`domain/search.ts` 及任何寫入路徑
- 唯一修改的既有檔案是導覽列 `match`、`/more` 選單、記帳頁捷徑（三個都是純 `<Link>`）與測試檔
- 用「統計必須等於 `monthSummary`」「統計必須等於 `searchTransactions` 的 totals」兩條測試，**從機制上**擋掉第二套分類規則

## 8. ⑦ 需要你決定的產品規則

| # | 問題 | 我的建議 |
|---|---|---|
| 1 | 「我的付款」要不要被退款沖銷（退款進我的帳戶 → 我的付款減少）？ | **要**。這樣三方加總才會等於淨支出，帳才對得起來 |
| 2 | 收入要不要也做「誰受益」（Split 側）？ | **這一版不做**，只做「誰收到」。收入筆數少，兩套容易看混 |
| 3 | 分類佔比的分母用「淨支出」還是「支出（未扣退款）」？ | **淨支出**，與主數字一致 |
| 4 | 沒有分類的交易怎麼顯示？ | 獨立一列「未分類」，不隱藏 |
| 5 | 預設看哪個月？可以回溯多久？ | 預設**本月**，可回溯 **12 個月**，不能選未來 |
| 6 | 趨勢要幾個月？ | **6 個月**（手機一屏放得下） |
| 7 | 「目前欠款」「目前基金」是當下狀態、不是當月，要放進 `/stats` 嗎？ | **放**，但標題明寫「目前」，與當月數字分開區塊 |
| 8 | 基金支出要算進分類佔比嗎？ | **要**（它是真實支出，維持既有規則）。可在該列加小字註記 |
| 9 | 唯讀成員可以看統計嗎？ | **可以**（純讀取，不寫入） |
| 10 | `/stats` 放在底部導覽第幾個？ | **不動底部導覽的五個分頁**，從「更多」與記帳頁捷徑進入；導覽列只把 `/stats` 歸到「記帳」分頁高亮 |
