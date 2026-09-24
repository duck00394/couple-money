# Phase 3-4 進度 checkpoint（2026-09-21，A／C／E／G／H／D／B／F 完成）

## 1. 已完成的功能

- **A 統計與報表 `/stats`** — 完成並已 commit。
  月份切換（可回溯 12 個月、不能選未來、參數亂填回本月）、淨支出＋收入、
  誰掏錢（我／另一半／共同帳戶獨立一列，Payment 側）、誰負擔（我／另一半，Split 側）、
  分類佔比（可點進「該分類＋該月份」的記帳列表）、最近 6 個月趨勢、
  轉帳（標示不算收支）、目前欠款、目前基金（實際金額與尚未入金分開）。
- **C 餘額調整（`TxType.ADJUSTMENT`）** — 完成並已 commit。
  帳戶頁每個「我的／共同」帳戶都有「調整餘額」：填**實際正確的餘額**（信用卡填實際未繳金額，可填負數），
  系統算出差額並建立一筆 `ADJUSTMENT` 交易。不修改任何歷史紀錄、不算收支、不產生欠款、不會有 split。
  可在記帳列表與搜尋（類型「餘額調整」）找到，詳細頁可「作廢這筆調整」（soft delete，作廢後導回 `/accounts`）。
  **沒有新增 schema、migration 或 TxType**（`ADJUSTMENT` 與 `buildBalanceLines` 本來就存在）。
- **E 記帳收據照片** — 完成並已 commit。
  記帳詳細頁有「收據照片」區塊：每筆最多 **3 張**（JPG／PNG／WebP，≤4MB，上傳前在瀏覽器壓到 ≤1280px JPEG），
  縮圖 80×80、點一下全螢幕放大、可單張刪除。唯讀成員看得到但不能增刪。
  沿用既有 `Attachment`（`ownerType = "TRANSACTION"`、`ownerId = 交易 id`），**沒有新增 schema 或 migration**。
  收據不進任何財務計算；記帳列表完全不載入圖片。
- **G CSV 匯出與備份** — 完成並已 commit。
  記帳頁「⤓ 匯出 CSV」（全部）與篩選後的「把這 N 筆匯出成 CSV」，走 `GET /api/export/transactions`
  （**沿用與記帳頁完全相同的網址參數與 `parseFilter()`**，不接受任何 bookId／accountId 之類的外部 id）。
  27 個欄位、UTF-8 BOM + CRLF、金額是純數字兩位小數、支出為負、公式注入會被加上單引號。
  備份另外用 `scripts/backup.sh`（`pg_dump` custom format + 照片 tar），**CSV 明確不是備份**。
- **H 最近動態（通知牆）** — 完成並已 commit。
  `/activity`：把既有 `AuditLog` 整理成「另一半最近做了什麼」，今天／昨天／更早分組，最近 30 天、最多 50 筆。
  **沒有新增 schema、沒有 Notification 資料表、沒有背景排程、沒有推播／Email／LINE、沒有已讀狀態**
  （因此也刻意沒有未讀紅點）。入口在「更多」與首頁底部連結列。
- **D 分類管理** — 完成並已 commit。
  `/categories`：新增、改名、換圖示、停用／重新啟用；**只有完全沒用過的分類可以真的刪除**。
  沿用既有 `Category.isArchived`，**沒有新增 schema 或 migration**。
  停用＝「新紀錄不能再選」，舊紀錄完全不動；編輯舊紀錄時原本的停用分類會標成「（已停用）」留在選單裡。
  記帳與固定支出都套同一條規則。分類操作也會出現在最近動態。
- **B 每月預算** — 完成並已 commit。**這是 Phase 3-4 唯一新增資料表的功能**
  （`Budget` + migration `20260919182621_phase3_4_budgets`，純 CREATE TABLE，沒有動到任何既有資料表）。
  `/budgets?m=YYYY-MM`：每個分類一個月一筆預算，顯示預算／已支出／剩餘／使用率，
  區分「還好／快超過（≥80%）／已超支」；可改金額、停用／啟用、刪除；首頁有一行摘要。
  **「已支出」直接取自 `monthStats()` 的分類統計**，沒有第二套口徑。超支只提醒，不擋記帳。
- **F 批次操作** — 完成並已 commit。**沒有新增 schema 或 migration**。
  記帳列表（含搜尋結果）按「選取多筆」→ 每列出現勾選框 → 底部操作列可「改分類／加標籤／刪除」。
  一次最多 **50 筆**（`MAX_BATCH`，伺服器端擋，不是只靠畫面）；只對**明確勾到的 id** 動作，
  絕不把「目前搜尋結果全部」視為已選。**批次刪除逐筆走既有的 `deleteTransactionIn()`**（不是 `deleteMany()`），
  整批在同一個 `lockBook` + 同一個 DB transaction 內，**任何一筆失敗全部回滾**。
  批次修改只動**非金額欄位**（分類、標籤）；金額、日期、帳戶、付款人、Payment、Split、Fund、Debt、交易型別一律不支援。

- **V1 UI/UX 美化（韓系奶油風）** — 完成並已 commit。**純 UI 層**：
  沒有動到 schema、migration、domain／service、交易與統計計算、權限、AuditLog 或任何 API 行為。
  做法是在 `globals.css` 的 `@theme` 直接覆寫 Tailwind 色階（`stone-*`／`brand-*`／
  `emerald-*`／`red-*`／`amber-*`／`orange-*`／`sky-*`），一次把全站換成低飽和暖色系，
  再整理 `src/components/ui.tsx` 這組共用元件。設計說明見 `docs/12-UI-Design-System.md`。

## 2. 正在做的功能

**沒有。** A、C、E、G、H、D、B、F 與 V1 UI 改版都已完成，尚未開始下一項。

## 3. 已完成到哪一步

A、C、E、G、H、D、B、F 全部做完：程式、測試（Logic／Integration／E2E／UX audit）、build、commit、README 與設計文件更新。工作區乾淨。

## 4. 下一個具體要做什麼

**沒有進行中的工作。必須等使用者指示才能開始任何新東西。**

`docs/09-Phase3-4候選功能.md` 裡還沒做的候選（依風險由低到高）：

- **I 專案／訪客成員**、**K 成員生命週期**：會動到「帳本只有兩個人」的根本假設，**不建議輕易開始**
- **J 願望清單／獎勵商店**：等於再做一次基金支出

另外，H 之後若要做**未讀紅點**，就需要新增 schema（見第 9 節）。

## 5. 已修改／新增的檔案

### F 批次操作（commit：見第 10 節最新一筆）

新增：

- `src/server/domain/batch.ts` — 純函式：`MAX_BATCH = 50`、`BATCH_ACTIONS`（只有 `DELETE`／`CATEGORY`／`TAGS`）、
  `normalizeSelection()`（去空白、去重、id 格式驗證、筆數上限）、`assertBatchAction()`
- `src/server/services/batch.ts` — `batchDeleteTransactions()` / `batchSetCategory()` / `batchAddTags()`
- `src/app/actions/batch.ts` — `batchAction`（只收 `form.getAll("ids")`，**不接受 client 傳 bookId**）
- `src/components/BatchBar.tsx` — `BatchProvider`（選取模式、選取集合、底部操作列）與 `BatchCheckbox`
- `tests/domain/phase3-batch.test.ts`（5 項）、`tests/integration/phase3-batch.test.ts`（18 項）、`tests/e2e/phase3-4f.ts`（11 項）

修改：

- `src/server/services/ledger.ts` — 把 `deleteTransaction()` 的內容原封不動抽成 `deleteTransactionIn(tx, ctx, id)`，
  `deleteTransaction()` 變成 `lockBook` + 呼叫它的薄包裝（與既有 `createTransactionIn` 同一個模式）；
  `setTags()` 改為 export。**刪除的規則一個字都沒改。**
- `src/app/(app)/transactions/page.tsx` — 清單包進 `<BatchProvider>`，每列左側放 `<BatchCheckbox>`（`TxRow` 本身沒動）
- `tests/e2e/couple-flow.ts`、`README.md`

### B 每月預算（commit 196daf6）

新增：

- `prisma/schema.prisma` 的 `Budget` model + `prisma/migrations/20260919182621_phase3_4_budgets/`
- `src/server/domain/budget.ts` — 純函式：`budgetProgress()`（剩餘／使用率／狀態／超支）、
  `assertBudgetAmount()`、`summarizeBudgets()`、`NEAR_RATIO`
- `src/server/services/budgets.ts` — `budgetOverview()` / `budgetSummary()` / CRUD / `budgetsForCategory()`
- `src/app/actions/budgets.ts`、`src/components/BudgetForms.tsx`、`src/app/(app)/budgets/page.tsx`
- `tests/domain/phase3-budget.test.ts`（9 項）、`tests/integration/phase3-budget.test.ts`（19 項）、`tests/e2e/phase3-4b.ts`（13 項）

修改：

- `src/server/services/categories.ts` — 分類刪除與 `deletable` 多算一項「有沒有預算在用」
  （`Budget.categoryId` 的外鍵是 RESTRICT，先給清楚的中文訊息而不是 Prisma 例外）
- `src/components/CategoryForms.tsx` — 顯示「N 個月有預算」
- `src/server/domain/notification.ts`、`src/server/services/notifications.ts` — 動態加入 5 個 Budget 事件
- `src/app/(app)/page.tsx` — 首頁一行預算摘要（只有有預算時才出現）
- `src/app/(app)/more/page.tsx`、`src/components/BottomNav.tsx`、`tests/e2e/couple-flow.ts`、`tests/e2e/ux-audit.ts`、`README.md`

### D 分類管理（commit e9ccd50）

新增：

- `src/server/domain/category.ts` — 純函式：`normalizeCategoryName()`、`categoryNameKey()`（忽略大小寫與空白）、
  `assertCategoryName()`、`assertCategoryKind()`、`normalizeCategoryIcon()`、`CATEGORY_ICONS`
- `src/server/services/categories.ts` — `listCategoriesForManage()`（含使用次數，三個查詢）、
  `createCategory()` / `updateCategory()` / `setCategoryArchived()` / `deleteCategory()`
- `src/app/actions/categories.ts`、`src/components/CategoryForms.tsx`、`src/app/(app)/categories/page.tsx`
- `tests/domain/phase3-category.test.ts`（5 項）、`tests/integration/phase3-category.test.ts`（19 項）、`tests/e2e/phase3-4d.ts`（13 項）

修改：

- `src/server/services/ledger.ts` — `validateInput()` 新增選用的 `keepCategoryId`（新紀錄不得用停用分類，
  編輯舊紀錄可保留原分類）；`listCategories()` 新增選用的 `keepId`。**沒有動到任何金額、分錄或稽核語意**
- `src/server/services/recurring.ts` — `validate()` 同一條規則
- `src/server/txFormData.ts` — `loadTxFormOptions(ctx, { keepCategoryId })`，停用分類顯示「（已停用）」
- `src/app/(app)/transactions/[id]/page.tsx`、`src/app/(app)/recurring/[id]/page.tsx` — 編輯頁帶入原分類
- `src/server/domain/notification.ts`、`src/server/services/notifications.ts` — 動態加入 5 個 Category 事件
- `src/app/(app)/more/page.tsx`、`src/components/BottomNav.tsx`、`tests/e2e/couple-flow.ts`、`tests/e2e/ux-audit.ts`、`README.md`

### H 最近動態（commit 0bbc4a4）

新增：

- `src/server/domain/notification.ts` — 純函式：`NOTIFIABLE` 白名單、`EXCLUDED`（附「為什麼不顯示」的說明）、
  `isNotifiable()`、`describeAudit()`（**只取白名單欄位**）、`groupLabel()`
- `src/server/services/notifications.ts` — `listActivity()`（一次 AuditLog 查詢 + 每種關聯型別各一次批次查詢，無 N+1）
- `src/app/(app)/activity/page.tsx`
- `tests/domain/phase3-notification.test.ts`（12 項）、`tests/integration/phase3-notification.test.ts`（15 項）、`tests/e2e/phase3-4h.ts`（9 項）

修改（全是導覽或測試註冊）：

- `src/app/(app)/more/page.tsx`（「一起」區塊加一列）、`src/app/(app)/page.tsx`（首頁底部連結列）
- `src/components/BottomNav.tsx`（`/activity` 歸到「更多」分頁高亮）
- `tests/e2e/couple-flow.ts`、`tests/e2e/ux-audit.ts`（逐頁檢查 14 → 15 頁）、`README.md`

### G CSV 匯出與備份（commit 80c0a8b）

新增：

- `src/server/domain/csv.ts` — 純函式：`csvCell()`（RFC 4180 + 公式注入防護）、`toCsv()`（BOM + CRLF）、
  `csvAmount()`（純數字兩位小數、保留負號）、`csvFileName()`、`contentDisposition()`（中文走 RFC 5987）
- `src/server/services/export.ts` — `exportTransactionsCsv()` / `recordExport()` / `EXPORT_LIMIT`
- `src/app/api/export/transactions/route.ts` — `GET`，未登入 401
- `scripts/backup.sh` — `pg_dump --format=custom` + 照片 tar + 還原說明（已實測跑過）
- `tests/domain/phase3-csv.test.ts`（8 項）、`tests/integration/phase3-export.test.ts`（17 項）、`tests/e2e/phase3-4g.ts`（10 項）

修改：

- `src/app/(app)/transactions/page.tsx` — 兩個匯出入口（**用 `<a download>` 不是 `<Link>`，避免 Next 預抓觸發匯出**）
- `tests/e2e/couple-flow.ts`、`tests/e2e/ux-audit.ts`（搜尋結果頁多檢查匯出鍵沒被蓋住）、`README.md`

### E 記帳收據照片（commit af2c4f0）

新增：

- `src/server/domain/receipt.ts` — 純函式：`sniffImage()`（檔頭）、`assertImage()`、`MAX_UPLOAD_BYTES`、`MAX_RECEIPTS`、`IMAGE_TYPES`
- `src/server/services/receipts.ts` — `listReceipts` / `addReceipt` / `removeReceipt` / `detachReceipts`
- `src/app/actions/receipts.ts`、`src/components/ReceiptBox.tsx`、`src/components/imageCompress.ts`
- `tests/domain/phase3-receipt.test.ts`（6 項）、`tests/integration/phase3-receipt.test.ts`（16 項）、`tests/e2e/phase3-4e.ts`（11 項）

修改：

- `src/server/services/attachments.ts` — 抽出 `prepareUpload()` / `writeUpload()`（`saveUpload()` 行為不變，
  新增選用的 `ownerId` / `client` 參數）；`readAttachment()` 對 `TRANSACTION` 附件**多查一次所屬記帳是否還在**
- `src/server/services/ledger.ts` — `deleteTransaction()` 與 `cancelAdjustment()` 各加一行 `detachReceipts()`
  （只收回附件，**沒有動到任何金額、分錄或稽核語意**）
- `src/components/CheckInWidgets.tsx` — `compressImage()` 移到 `imageCompress.ts` 共用（行為不變）
- `src/app/(app)/transactions/[id]/page.tsx` — 兩種詳細頁都放上 `ReceiptBox`
- `tests/e2e/couple-flow.ts`、`README.md`

### C 餘額調整（commit fea024b）

新增：

- `tests/domain/phase3-adjustment.test.ts`（9 項）
- `tests/integration/phase3-adjustment.test.ts`（20 項）
- `tests/e2e/phase3-4c.ts`（7 項）

修改：

- `src/server/services/ledger.ts` — 新增 `adjustAccountBalance()` 與 `cancelAdjustment()`（**只新增函式，沒有改動任何既有函式**），並 import `accountFreeAmount`
- `src/server/domain/search.ts` — `SEARCH_KINDS` 與 label 加入 `ADJUSTMENT`（FilterSheet 會自動出現這個選項）
- `src/lib/money.ts` — 新增 `parseSignedAmount()`（餘額可以是負的）；**`parseAmount()` 行為完全不變**
- `src/app/actions/accounts.ts` — `adjustBalanceAction` / `cancelAdjustmentAction`（作廢後 `redirect("/accounts")`）
- `src/components/AccountForms.tsx` — `AdjustBalanceForm` / `CancelAdjustmentButton`
- `src/app/(app)/accounts/page.tsx` — 每個可編輯帳戶下方加「調整餘額」
- `src/app/(app)/transactions/[id]/page.tsx` — `ADJUSTMENT` 顯示「作廢這筆調整」；`OPENING_BALANCE` 顯示「請到帳戶頁用調整餘額補一筆」
- `tests/e2e/couple-flow.ts`、`tests/e2e/ux-audit.ts`、`README.md`、`docs/08-餘額調整設計分析.md`

### A 統計與報表（commit dc93a42）

新增：

- `src/server/domain/stats.ts` — 純函式：`recentMonths` / `shiftMonth` / `monthOf` / `monthKeyRange` / `monthLabel` / `clampMonth` / `bucketByMonth` / `categoryShares`
- `src/server/services/stats.ts` — `monthStats` / `statsTrend` / `statsOverview`（只有 `findMany` 與 `groupBy`，零寫入）
- `src/app/(app)/stats/page.tsx`
- `src/components/StatsBars.tsx` — `BarRow` / `MiniTrend`（純 CSS，無圖表套件）
- `tests/domain/phase3-stats.test.ts`（10 項）
- `tests/integration/phase3-stats.test.ts`（19 項）
- `tests/e2e/phase3-4.ts`（9 項）
- `docs/10-Phase3-4A-統計與報表-實作計畫.md`

修改（全部是導覽或測試註冊，沒有財務邏輯）：

- `src/components/BottomNav.tsx`（`/stats` 歸到「記帳」分頁高亮）
- `src/app/(app)/more/page.tsx`（加一列「📊 統計與報表」）
- `src/app/(app)/transactions/page.tsx`（捷徑加一個 `<Link>`）
- `tests/e2e/couple-flow.ts`（`PHASES` 註冊 `phase3-4 stats`）
- `tests/e2e/ux-audit.ts`（`PAGES` 加入 `/stats`，逐頁檢查 13 → 14 頁）
- `README.md`（Phase 3 進度）

## 6. 已完成的測試與結果

| 測試 | 結果 |
|---|---|
| Logic `npm test` | **114 / 114 pass**（B 後 109，F 再 +5） |
| Integration（PostgreSQL） | **233 / 233 pass**（B 後 215，F 再 +18） |
| E2E 全流程（Phase 1→…→3-4B→3-4F） | **全部通過** |
| UX audit（390×664、320×568，**17 頁**） | **通過** |
| `npx prisma migrate status` | 5 migrations，Database schema is up to date（**F 沒有新增 migration**） |
| `npx tsc --noEmit` | 0 error |
| `npx eslint .` | 0 problem |
| `npm run build` | ✓ Compiled successfully，`/stats` 已註冊 |

E2E 實跑數字（可當對帳範例）：淨支出 18,620、收入 40,000、掏錢 17,820 / 300 / 共同 500、負擔 9,200 / 9,420。

## 7. 尚未跑的測試

**沒有。** 上述全部都在 `dc93a42` 之後跑過且通過。
`scripts/data-integrity-check.ts`（唯讀掃描）在 A／C／E 之後**沒有重跑**。
C 只新增 `ADJUSTMENT` 交易（payment 一筆、無 split），E 只新增 `Attachment` 列，
兩者都不在該腳本的不變式檢查範圍內。

## 8. 已知問題

**沒有未解的問題。** 兩點需要知道的事實：

- 實作過程中失敗過的兩項都是**我自己寫的測試資料錯誤**，已修正，不是產品缺陷：
  預設分類叫「**居家**」不是「居住」；獎金入金的來源帳戶需要有可自由使用的錢（已在 fixture 幫阿本開一個有期初餘額的銀行帳戶）。
- `tests/integration/audit.test.ts` 的「同時結算」曾經 flaky（假設全額那筆一定先搶到鎖），已於 `55b157b` 改成依實際成功的那筆驗證剩餘欠款，連跑 4 次穩定。
- C 實作過程修掉的兩個真問題（已修正並重跑通過）：
  1. `parseAmount()` 不收負數 → 負餘額帳戶無法調整。新增 `parseSignedAmount()` 專供餘額調整使用，未更動 `parseAmount()`。
  2. 作廢後立刻導頁會中斷 server action → 改成 action 內 `redirect("/accounts")`（與既有的刪除交易同一套做法）。
- E 實作過程沒有遇到失敗；整合測試 16 項、E2E 11 項都是第一次就全過。
- G 修掉一個真問題：`Content-Disposition` 直接放中文檔名會讓 `Response` 丟 `TypeError`（HTTP 標頭只能 Latin-1）→
  改成 ASCII 備援檔名 + RFC 5987 的 `filename*`，並加了一條「標頭只能有 ≤255 的字元」的單元測試。
  另外 4 個整合測試失敗都是我自己的期望寫錯（`火鍋` 有兩列：消費與退款同名，要用交易 id 取；
  /stats 的 `borne`／`paid` 只算支出與退款，不含收入）。
- H 沒有遇到產品問題；3 個整合測試失敗都是我自己的 fixture 寫錯（結算方向要看實際欠款、
  固定支出的應付日要對得上、有懲罰金額的任務一定要指定基金），2 個 E2E 失敗是等待與斷言寫法
  （換頁骨架要 `loaded()`、支出詳細頁的名稱在 input 的 value 裡不在 innerText）。
- D 沒有遇到產品問題：純邏輯 5 項、整合 19 項第一次就全過；E2E 只有一個選擇器要加 `exact: true`
  （頁面標題「分類」與區塊標題「支出分類／收入分類」都符合）。
- B 沒有遇到產品問題：整合測試只有一個是我自己的算式寫錯（退款測試把基準點取在消費之後），
  E2E 兩個是選擇器／解析寫法（`selectOption` 不吃 RegExp、統計列的文字含百分比要先抓第一個金額）。
- F 沒有遇到產品問題。整合測試 5 個失敗全是我自己的測試碼寫錯：
  `settle()` 回傳的是 Settlement（要用 `s.transactionId`）、`getBalances()` 的 `accounts` 不是 Map、
  `BATCH_CATEGORY` 的筆數要取「執行前後差 1」而不是絕對值、
  **退款紀錄會沿用原始消費的標題**（`findFirst({ title: "要退的" })` 會抓到退款那筆，要加 `type: "EXPENSE"`），
  以及第 8 項只是被第 7 項的失敗連帶影響。
  E2E 兩個也都是測試碼：`couple-flow.ts` 已經統一自動按掉 `confirm()`（不可以再註冊第二個 dialog handler），
  以及 E2E 帳本裡的餘額調整最後會被作廢，所以「不能批次刪除」改用一定存在的**期初餘額**來驗。

## 9. 需要產品決策的事項

**A、C、E、G、H、D、B、F 都沒有未決事項。**

F 自行決定的四件事：
1. **批次刪除不走 `DeleteRequest`**（docs/09 標為待決）。現有 `DeleteRequest` 只支援 `GOAL` / `FUND`，
   擴充到交易等於新增功能；單筆刪除本來就不需要另一半同意，批次保持一致，而且會出現在最近動態。
   未來若要改成需要同意，是在 `DeleteRequest` 上加 `TRANSACTION` 型別，不需要動批次本身。
2. **一次最多 50 筆**（`MAX_BATCH`）。兩人日常使用足夠，50 筆逐筆走完整規則在整合測試裡約 1 秒。
3. 批次只支援**改分類／加標籤／刪除**三種（docs/09 的原始設計），且**加標籤是疊加**不是覆蓋。
   可以批次改分類／加標籤的型別與單筆編輯一致，只有 `EXPENSE` 與 `INCOME`。
4. AuditLog 維持既有語意：每一筆該有的 `DELETE` / `UPDATE` 照寫，**另外**多一筆
   `BATCH_DELETE` / `BATCH_CATEGORY` / `BATCH_TAGS` 摘要（`entityId = bookId`），沒有壓成一筆，也沒有第二套稽核。

H 自行決定的三件事：
1. **不做未讀紅點**。現有 schema 沒有任何地方可以表示「誰看過哪一則」，硬做就得新增
   `NotificationRead`（或在 `BookMember` 加 `activitySeenAt`）+ migration。使用者明講「沒有永久已讀狀態就不要做假紅點」，
   所以第一版只做「最近動態」。**未來若要紅點：最小做法是 `BookMember.activitySeenAt DateTime?` 一個欄位 + 一次 migration**，
   打開頁面時更新它，未讀數 = 比它新且 actor 不是自己的白名單 AuditLog 筆數。
2. 刻意排除四類事件（理由寫在 `domain/notification.ts` 的 `EXCLUDED`）：
   `Transaction:EXPORT`（匯出是自己的事）、`RecurringExpense:GENERATE`／`SKIP`（與 `Transaction:CREATE` 重複）、
   `Task:PENALTY`（系統自動產生，actor 是「剛好打開 App 的人」，顯示出來會誤導）、`Book:CREATE`。
3. 已作廢的實體一律不給連結，只保留「做過這件事」的事實。

D 自行決定的四件事：
1. **停用分類不需要另一半同意**（與記帳、帳戶停用一致；停用完全可逆，而且會出現在最近動態，對方看得到）。
2. 有任何紀錄在用的分類（**含已作廢的交易**）一律不能刪，只能停用；完全沒用過的才給刪除。
3. 名稱上限 10 字，同帳本同類型不可重複（忽略大小寫與空白差異）；不同類型可以同名。
4. 圖示只能從固定清單挑（26 個），避免變成任意字串。**沒有**做子分類、顏色編輯、預算綁定或自動分類。

B 自行決定的五件事：
1. **基金支出算進預算**——因為 `/stats` 就是這樣算的（它是真實支出）；固定支出產生的交易同理。
   絕對不另立口徑，這點有整合測試釘住。
2. 「快超過」門檻 80%（`NEAR_RATIO`），用無條件進位比較，避免浮點數誤差。
3. 分類停用後**不能新增**該分類的預算，但既有預算保留、可改、可停用，統計照算。
4. 預算可以硬刪（它不是財務紀錄），但**有預算的分類不能硬刪**——外鍵是 RESTRICT。
5. **沒有**做 rollover、年度預算、總額預算、跨月結轉、預算共享比例或 AI 建議。

E 自行決定的三件事（都往「私人 App、低成本」的方向靠，未來要改很便宜）：
1. 收據只在**記帳詳細頁**增刪，沒有做進建立／編輯表單（不想動到共用的 `TransactionForm`）。
2. 每筆上限 **3 張**、單張 ≤4MB（沿用打卡照片的既有上限）。
3. 防重送用「同檔名 + 同大小視為同一張」，不新增 schema 的 idempotency key。

G 自行決定的四件事：
1. **唯讀成員可以匯出**（匯出範圍就是他本來看得到的資料，不會因此多拿到東西；有測試釘住）。
2. 一列 = 一筆交易（不是一列一個 split），另外給「各自付款／各自負擔」欄位，試算表 SUM 得出來。
3. 單次上限 `EXPORT_LIMIT = 5000` 筆（超過時回傳 `truncated`，私人使用碰不到）。
4. 匯出事件寫 AuditLog（`action = "EXPORT"`、`entityType = "Transaction"`、`entityId = bookId`）。

之後功能的待決事項（不影響現在）：

- **C**：無（兩個建議使用者已同意）
- **K 成員生命週期**：解除綁定後未結清欠款怎麼呈現、還能不能結算

## 10. 最新 commit

```
<本次 commit>  feat(phase3-4): add batch operations
196daf6 Phase 3-4 B：每月分類預算（新增 Budget model + migration）
e9ccd50 Phase 3-4 D：分類管理
0bbc4a4 Phase 3-4 H：最近動態（通知牆）
80c0a8b Phase 3-4 G：CSV 匯出與資料備份
```

## 11. git status

**乾淨**（`git status --short` 無輸出），除了本檔案本身。

## 12. 不能遺漏的技術上下文

**環境（每個新 session 必做）**

- 專案在 `/home/claude/couple-money`；`git` 可用。
- **PostgreSQL 每個 session 都要重新啟動**：`pg_ctlcluster 16 main start`（可能要先移除 stale pid，指令會自己處理）。
- **新增 migration 之後三個資料庫都要 deploy**（`couple_money` / `couple_money_test` / `couple_money_e2e`）：
  Prisma CLI 只看 `.env`，所以要逐一換掉 `.env`（留 `.env.bak`）再 `npx prisma migrate deploy`，最後還原。
  產生 migration 用 `bash scripts/new-migration.sh <名稱>`（非互動，走 shadow DB）。
- 資料庫：`couple_money`（開發，目前**是空的**）、`couple_money_test`（整合測試，會被 TRUNCATE）、
  `couple_money_e2e`（E2E）、`couple_money_shadow`（`scripts/new-migration.sh` 用）。
  `couple_money_review` 已於 `8298cc5` 刪除（備份在 `/tmp/claude-0/couple_money_review.backup.sql`，容器重啟後會消失）。
- **Prisma CLI 會讀 `.env` 並蓋掉 shell 的 `DATABASE_URL`**；要換資料庫必須換掉 `.env`（留 `.env.bak`）再還原。
  Prisma **Client**（執行期）不會，所以 `DATABASE_URL=... npx tsx ...` 與 `DATABASE_URL=... npm start` 都正常。

**測試指令**

```bash
npm test
TEST_DATABASE_URL=postgresql://cm:cm@localhost:5432/couple_money_test UPLOAD_DIR=/tmp/claude-0/uploads npm run test:integration
#   ↑ UPLOAD_DIR 是必填：收據測試會真的寫檔到那裡
npm run build
bash scripts/stop-next.sh
DATABASE_URL=postgresql://cm:cm@localhost:5432/couple_money_e2e UPLOAD_DIR=/tmp/claude-0/uploads-e2e PORT=3100 npm start &
BASE_URL=http://localhost:3100 CHROMIUM_PATH=/opt/pw-browsers/chromium SHOTS_DIR=/tmp/claude-0/shots npm run test:e2e
```

- E2E 結束後記得 `bash scripts/stop-next.sh`。
- 備份：`DATABASE_URL=… UPLOAD_DIR=… BACKUP_DIR=… bash scripts/backup.sh`（需要 `pg_dump`，已實測可用）。
- **新增 app 路由後 `tsc` 會報 `Type '"/stats"' does not satisfy the constraint 'AppRoutes'`**，
  跑 `npx next typegen`（或 `npm run build`）重新產生路由型別即可。

**V1 UI 的硬規則（之後改動不可破壞）**

- 顏色一律走 `globals.css` `@theme` 的 token；**不要在頁面寫死色碼**（`bg-[#...]`）。
  要換色系就改 token，全站會一起跟著換。
- 財務語意顏色不可混用：綠＝收入／正向、紅＝支出／危險、橘＝快超過、
  琥珀＝尚未入金（不是現金）、藍＝不算收支。
- 卡片、按鈕、輸入框、Badge、空狀態、骨架一律用 `src/components/ui.tsx`；
  **不要每頁各自寫一套**。
- E2E 依賴幾個「連結名稱」與 `data-testid`，改版時不可以動到：
  記帳頁捷徑的 `🔁 轉帳`／`📊 統計`／`🤝 結算`（emoji 與名稱之間要有一個空白）、
  交易表單分類鍵的 `ring-brand-500`、`.sticky-submit-bar`，以及所有 `data-testid`。
- 交易表單的「標籤」「備註（選填）」欄位**必須維持可見**（不能收進預設收合的 `<details>`），
  E2E 會直接 `fill()` 它們。
- 動畫只做 `.press` / `.rise` / `.fade` 這種 0.1～0.2 秒的微互動，且要包在
  `prefers-reduced-motion: no-preference` 裡。

**F 的實作硬規則（之後改動不可破壞）**

- 批次刪除**只能**逐筆呼叫 `deleteTransactionIn()`，**永遠不可以用 `deleteMany()` 或自己寫 where 條件**。
  「單筆」與「一批」必須是同一段程式碼，否則基金額度、退款關聯、獎金入金、收據收回會出現第二套規則。
- 整批必須在**同一個 `lockBook` + 同一個 `prisma.$transaction`** 內；任何一筆失敗要整批回滾，
  不可以改成部分成功（Prisma 不支援巢狀 interactive transaction，所以呼叫的是 `...In(tx, …)` 版本，不是外層 API）。
- 批次**只能**改分類與標籤這兩個非金額欄位。金額、日期、帳戶、付款人、Payment、Split、Fund、Debt、
  交易型別一律不可以加進批次；`BATCH_ACTIONS` 有純邏輯測試釘住。
- 筆數上限一定要在 server 端擋（`normalizeSelection()`），畫面上的提示只是體驗。
- Server action **不可以**接受 client 傳來的 bookId，帳本一律取自 `getAppContext()`；
  找不到或跨帳本一律回同一個 `BATCH_NOT_FOUND`，不可以洩漏「那筆存在但不是你的」。
- 畫面只能把**明確勾選的 id** 送出去；不可以加「選取目前搜尋結果全部」而把沒看過的紀錄一起刪掉。
- 批次改分類走的是「只 update `categoryId`」，**不要改成呼叫 `updateTransaction()`**
  （那會重寫 payments／splits、要求 `expectedVersion`，等於讓批次動到金流）。

**B 的實作硬規則（之後改動不可破壞）**

- 預算的「已支出」**只能**來自 `monthStats()` 的分類統計，不可以自己寫 where 條件或另外加總；
  這是「不要有第二套口徑」的唯一防線（整合測試會比對兩邊相等）。
- 預算不產生任何 Transaction／Payment／Split，也不可以回頭改任何金額
  （整合測試把交易數、金流、分帳、基金、餘額、欠款、stats、搜尋 totals 整包 deepEqual）。
- `@@unique([bookId, categoryId, month])` 是「同月同分類只有一個預算」的保證，不要拿掉。
- 超支**只提醒**，不可以變成擋住記帳的驗證。
- 停用的預算仍然列出來，但不進 `summarizeBudgets()`；首頁摘要沒有預算時回 `null`，不要顯示空白區塊。

**D 的實作硬規則（之後改動不可破壞）**

- **停用不可以改動任何既有交易**：`Transaction.categoryId` 永遠不會因為停用或改名而變動。
- 新紀錄不能用停用分類，但**編輯舊紀錄時必須放行它原本的那一個**
  （`validateInput(..., keepCategoryId)` / `validate(..., keepCategoryId)`），否則一存檔就掉分類。
- 表單選單用 `listCategories(ctx, { keepId })`；**搜尋的篩選選單與 /stats 必須列出全部分類（含停用）**，
  不然舊資料就找不到、統計會掉分類。
- 刪除只允許「`Transaction` 與 `RecurringExpense` 都完全沒引用」的分類，
  而且**已作廢的交易也算引用**；其餘一律要求停用。
- 分類管理不產生任何 Transaction／Payment／Split，不碰餘額、欠款、基金與 /stats 的金額（有整合測試整包比對）。

**H 的實作硬規則（之後改動不可破壞）**

- 動態**只是 AuditLog 的呈現**：不可以寫入第二份事件紀錄，也不可以讓它變成任何財務數字的來源。
- `describeAudit()` **只能**透過 `pickNumber`／`pickString` 取白名單欄位；
  永遠不要把 `before`／`after` 整包丟給前端（裡面有 `clientRequestId`、`payments`、`splits`、`storageKey`…）。
- 查詢一律鎖 `ctx.book.id`，而且預設 `actorId != 我`；關聯資料一定要批次查（現在是每種型別一次），不可以在迴圈裡查。
- 實體已 soft delete 時 `href` 必須是 `null`：動態不可以變成繞過權限看已刪除資料的入口。
- 新增 AuditLog 事件時要同時決定它進不進 `NOTIFIABLE`；不確定就先不要進（寧可少也不要吵）。
- 沒有已讀狀態之前，**不可以**做未讀數字或紅點。

**G 的實作硬規則（之後改動不可破壞）**

- 匯出的篩選一律 `buildTransactionWhere()` + `parseFilter()`（與記帳頁同一套），
  **不可以**接受 client 傳來的 bookId／ledgerId；帳本一律取自登入者的 `getBookContext()`。
- CSV 必須保留：UTF-8 BOM、CRLF、金額純數字兩位小數、支出為負、
  `SUM(收支金額)` = 收入 − 淨支出（有整合測試與 /stats 對帳）。
- 文字欄位的公式注入防護（`= + - @` 開頭加單引號）**不可以**套用到數字，否則試算表算不動。
- `Content-Disposition` 只能放 Latin-1 字元，中文檔名一律走 `filename*=UTF-8''…`。
- 匯出入口要用 `<a download>`，**不要用 `<Link>`**（Next 會預抓，等於偷偷匯出一次並寫一筆 AuditLog）。
- **CSV 不是備份**，文件與 UI 都不可以這樣寫；真正的備份是 `scripts/backup.sh`。

**E 的實作硬規則（之後改動不可破壞）**

- 收據是 `Attachment`（`ownerType = "TRANSACTION"`、`ownerId = 交易 id`），**不是交易**：
  不可以讓它進入 `Transaction`、`Payment`、`Split`、搜尋 totals、`/stats` 或餘額。
- 讀取一律經過 `/api/files/[id]` → `readAttachment()`，那裡有三層檢查：登入、帳本成員（且 ACTIVE）、
  **所屬記帳仍存在且未作廢**。第三層是即使別的路徑漏掉收回附件也不會外洩的保險，不要拿掉。
- 記帳作廢時由 `detachReceipts()` 一併 soft delete；新增作廢路徑時要記得呼叫。
- 圖片驗證在伺服器端（`assertImage()` 檢查 MIME + 大小 + **檔頭**），瀏覽器端的壓縮與 accept 只是體驗，不是防線。
- 記帳列表**不可以**載入 `/api/files/*`（效能）；只有詳細頁載縮圖，點擊才放大。

**C 的實作硬規則（之後改動不可破壞）**

- 餘額調整**不得**修改任何既有交易，也不得新增 balance 欄位：餘額永遠是 `−Σpayment`。
- `ADJUSTMENT` 不可以被加進 `INCOME_EXPENSE_TYPES` 或 `DEBT_TYPES`（加進去會同時污染首頁、搜尋、統計與欠款）。
- 往下調整與「作廢往上調整」都要通過 `assertAccountsEarmarkBacked` / `assertTransferCancelable`
  （帳戶餘額 ≥ 已指定給基金）。
- 餘額調整**不走** `deleteTransaction()`（`DELETABLE_TYPES` 刻意不含它），只能用 `cancelAdjustment()`；
  期初餘額則完全不能作廢，要改就補一筆調整。
- 目前餘額是在 `prisma.$transaction` + `lockBook` **之內**重讀的，兩支手機同時調整才不會互相覆蓋；不要改成在交易外先算好。

**A 的實作硬規則（之後改動不可破壞）**

- 統計層**不得**自己判斷 `type === "EXPENSE"` 之類的規則。
  收支一律 `totalsFromGroups()`（`domain/search.ts`），期間與帳本範圍一律 `buildTransactionWhere()`（`services/search.ts`）。
- 兩組對帳測試是機制性保險，**不可放寬**：
  `monthStats().borne.me === monthSummary().myShare`；`monthStats().totals` deepEqual `searchTransactions(同期間).totals`。
- 另有「讀統計前後 `AuditLog` / `Transaction` / `FundTransaction` 筆數完全不變」的唯讀測試。
- 趨勢是**一次查詢 + 純函式 `bucketByMonth` 以 `toDateKey()` 分月**（帳本時區），不要改成原生 `date_trunc` SQL。
- `paid`（Payment 側，三項含共同帳戶）與 `borne`（Split 側，只有兩人）刻意不同：
  共同帳戶付款**沒有**負擔側的「共同」——那些錢仍由兩人負擔，只是不產生欠款（決策 C1）。

**整個專案的財務核心（任何新功能都不可破壞）**

```
Account = 真實資金所在地   Fund = 被指定用途的金額   Goal = 目標
Transaction = 真實金流     Payment = 實際付款來源    Split = 實際負擔
Debt = 由交易計算，沒有任何 balance 欄位
```

- Transfer：不算收入／不算支出／不產生 Debt／不產生 Split
- Refund：獨立 Transaction、不修改原始交易、不得超過原始金額、split 按原比例回沖
- Recurring：設定不是 Transaction、產生後才是金流、不改歷史、同一期只能產生一次
- Fund：指定金額不得超過帳戶可支撐的金額、未入金 Reward 不是現金、
  **Fund Expense 必須由使用者明確指定付款 Account（系統不會自動挑）**

**使用者的長期限制（每一輪都重申過）**

不連 GitHub／Vercel／Neon／Supabase、不部署 Production、只用目前本機 PostgreSQL、
不破壞既有測試、不為了讓測試通過而降低標準、不重寫既有財務核心、
**完成一個階段就停下來回報，不要自行開始下一個**。
