# Couple Money 💞

一起記帳、一起存錢、一起完成目標。情侶私人使用的手機型 Web App。

## 目前進度（Phase 1 最小可用版本）

- [x] 需求分析與架構：`docs/01-需求分析與架構.md`
- [x] 核心財務邏輯 + 18 項單元測試：`src/server/domain/`、`tests/domain/`
- [x] 資料庫 schema：`prisma/schema.prisma`（migration：`prisma/migrations/`）
- [x] Next.js 16 + TypeScript + Tailwind 4 手機版介面
- [x] Email + 密碼登入（scrypt、資料庫 Session、HttpOnly Cookie）
- [x] 建立情侶帳本、邀請碼／邀請連結綁定另一半（7 天有效、一次性、最多兩人）
- [x] 首頁 Dashboard（誰欠誰、本月總支出、我本月負擔、最近紀錄）
- [x] 新增／編輯／刪除記帳（支出、收入；版本衝突保護、防重複送出）
- [x] 分帳：平分、自訂比例、自訂金額、一人負擔（即時預覽欠款影響）
- [x] 即時計算誰欠誰（共同帳戶支付不產生欠款）
- [x] 一鍵結清、部分結算、防超額／防重複結算、取消結算
- [x] 帳戶：現金、銀行、信用卡（未繳金額）、電子支付、共同帳戶；期初餘額、停用
- [x] 服務層整合測試 8 項（真實 PostgreSQL，含同時結算的並發測試）
- [x] 兩支手機瀏覽器端到端流程測試（Playwright）

## Phase 2（共同目標＋任務系統）

- [x] 共同目標：名稱、描述、封面圖示、目標金額、開始／目標日期、啟用、完成狀態（自動＋手動）、剩餘金額、進度
- [x] 共同基金：多個基金、目標金額、到期日、兩人投入、取回、基金支出（連結真實消費）、進度
- [x] 每日任務：我的／另一半／共同任務、每日／每週／自訂週期、需確認、需照片、獎金、懲罰、啟用停用
- [x] 打卡：備註、照片（瀏覽器壓縮）、待確認／已完成／被拒絕／已取消、修改、取消
- [x] 任務獎金：TaskReward → FundTransaction → 基金 → 目標進度
- [x] 連續打卡：目前連續、最長連續、本週／本月完成次數、本週完成率
- [x] 里程碑：3／7／14／30 天（可自訂），徽章＋額外獎金＋非金錢獎勵，同一段連續只發一次
- [x] 懲罰：漏做自動產生（扣基金＋非金錢懲罰），可由另一半免除

資料原則：

```
Account（共同帳戶）＝ 真實的錢放在哪裡   → Transaction 加總
Fund（共同基金）  ＝ 錢指定要做什麼       → FundTransaction 加總（不移動帳戶的錢）
Goal（共同目標）  ＝ 想達成的結果         → 讀取連結基金的餘額
TaskReward／TaskPenalty ＝ 金額的來源紀錄 → 各自對應一筆 FundTransaction
```

沒有任何 `balance` 欄位；取消打卡、免除懲罰、刪除消費都是 soft delete，紀錄保留可追溯。

## Phase 3（搜尋、轉帳退款、固定支出、統計）

- [x] 3-1 搜尋與篩選：關鍵字、日期、類型、分類、付款人、帳戶、基金、標籤、金額區間（條件寫在網址）
- [x] 3-2 帳戶間轉帳與退款：轉帳不算收支也不產生欠款；退款獨立成一筆、不修改原始消費、按原比例回沖
- [x] 3-3 固定支出：設定不是金流，到期由使用者按「產生記帳」才成為真實交易，同一期只能產生一次
- [x] 3-4 A 統計與報表 `/stats`：淨支出、收入、誰掏錢（Payment）、誰負擔（Split）、分類佔比、最近 6 個月趨勢
- [x] 3-4 C 餘額調整：實際餘額與 App 對不起來時補一筆 `ADJUSTMENT`，不修改任何歷史紀錄、不算收支、不產生欠款
- [x] 3-4 E 記帳收據照片：每筆記帳最多 3 張（JPG／PNG／WebP，上傳前在瀏覽器壓縮），點縮圖放大，記帳作廢後照片也讀不到
- [x] 3-4 G CSV 匯出與備份：依目前搜尋條件匯出交易明細（UTF-8 BOM，Excel 直接開），另附 `scripts/backup.sh` 做真正的資料庫備份
- [x] 3-4 H 最近動態：把既有 AuditLog 整理成「另一半做了什麼」，不新增資料表、不做推播
- [x] 3-4 D 分類管理：新增／改名／換圖示／停用／重新啟用；沒用過的分類才可以真的刪除
- [x] 3-4 B 每月預算：分類預算、預算／已支出／剩餘、快超過與超支提醒（只提醒，不擋記帳）
- [x] 3-4 F 批次操作：記帳列表勾選多筆，一次改分類／加標籤／刪除（一次最多 50 筆，任何一筆不能刪就整批不動）
- [x] V1 UI：韓系奶油風改版（統一 Design Token 與共用元件，設計說明見 `docs/12-UI-Design-System.md`）

### 照片功能開關

收據照片與打卡照片存在伺服器的檔案系統（`UPLOAD_DIR`，預設專案下的 `.uploads/`）。
部署在**沒有持久硬碟**的平台（例如 Vercel）時，把環境變數 `NEXT_PUBLIC_PHOTOS_ENABLED` 設成 `0`，
畫面會直接隱藏照片相關的上傳入口，也不會把檔案寫進會消失的暫存區。
本機執行不用設，預設就是開啟。

統計是**純讀取**：不新增任何交易，收支的定義直接沿用搜尋頁的 `totalsFromGroups()`，
並有測試強制「統計 = 首頁 `monthSummary()` = 搜尋 `totals`」，避免出現第二套財務規則。

餘額永遠是 `−Σpayment`，沒有任何 balance 欄位可以改：對帳差額一律用一筆 `ADJUSTMENT` 交易記下來，
可以搜尋、可以作廢，往下調整時仍受「帳戶餘額 ≥ 已指定給基金」這條不變式保護。

收據照片沿用既有的 `Attachment`（`ownerType = "TRANSACTION"`），完全不參與任何財務計算；
讀取一律經過 `/api/files/[id]`，會檢查帳本成員身分，而且所屬的記帳必須還沒被作廢。

**匯出與備份是兩件事**：CSV 是給人與試算表看的明細（金額是純數字、支出為負、`SUM(收支金額)` 等於淨收支），
**還原不了 App**；真正的備份是 `scripts/backup.sh`（`pg_dump` + 照片打包），還原方式寫在備份資料夾的 README.txt 裡。

```bash
bash scripts/backup.sh                       # 備份到 ./backups/<日期>/
BACKUP_DIR=/mnt/nas/cm bash scripts/backup.sh
```

「最近動態」只是 `AuditLog` 的呈現：AuditLog 仍然是完整稽核紀錄，動態只挑白名單事件與白名單欄位，
自己的操作不會通知自己，已作廢的資料不給連結（不能靠動態繞過權限）。沒有已讀狀態，所以也刻意沒有未讀紅點。

分類管理沿用 `Category.isArchived`：**停用只是「新紀錄不能再選」**，舊紀錄的 `categoryId` 一個字都不會動，
仍然看得到、搜尋得到、算進 `/stats` 與 CSV；編輯舊紀錄時那個停用分類會標成「（已停用）」留在選單裡。
有歷史紀錄在用的分類**不能刪除**，只能停用，避免歷史資料斷裂。

預算是唯一新增資料表的功能（`Budget`，migration `20260919182621_phase3_4_budgets`）。
它**不是資金帳本**：不產生 Transaction／Payment／Split，不影響餘額、欠款、基金與 `/stats` 的金額。
「已支出」不另外定義——直接取自 `monthStats()` 的分類統計，與 `/stats`、搜尋頁完全同一套口徑。

批次操作**不是另一套刪除路徑**：批次刪除是逐筆呼叫與單筆刪除完全相同的那段程式碼
（`deleteTransactionIn()`），所以基金額度、退款關聯、任務獎金入金、收據收回與稽核紀錄的規則完全一致，
餘額調整與期初餘額一樣刪不掉。整批跑在同一個 `lockBook` + 同一個資料庫交易裡，
**任何一筆不能刪，整批就都不刪**；批次修改也只動分類與標籤這兩個非金額欄位，
金額、日期、帳戶、付款人、分帳與交易類型一律不支援批次修改。一次最多 50 筆，由伺服器端擋下來。

## 本機啟動

需要 Node.js 20+ 與 PostgreSQL（本機、Docker、Neon 或 Supabase 免費方案皆可）。

```bash
npm install
cp .env.example .env          # 填入 DATABASE_URL
npx prisma migrate deploy     # 建立資料表
npm run dev                   # http://localhost:3000
```

手機測試：同一個 Wi-Fi 下用 `npm run dev -- -H 0.0.0.0`，手機開 `http://電腦IP:3000`。

## 測試

```bash
npm test                                                  # 純邏輯（Phase 1～3-4）
TEST_DATABASE_URL=postgresql://.../couple_money_test \
  npm run test:integration                                # 服務層整合測試（會清空該資料庫！）
npm run build && npm start                                # 另開視窗
BASE_URL=http://localhost:3000 npm run test:e2e           # 兩人完整流程
```

## 程式結構

```
src/
  app/(auth)/        登入、註冊
  app/(app)/         登入後頁面：首頁、明細、記一筆、編輯、結算、帳戶、更多
  app/onboarding     建立帳本／輸入邀請碼
  app/invite/[code]  邀請連結
  app/actions/       Server Actions（只做輸入解析，邏輯都在 server/services）
  components/        UI 元件
  server/domain/     純函式財務邏輯（分帳、分錄、欠款）
  server/services/   資料庫服務層（鎖定帳本 → 檢查 → 寫入 → AuditLog）
```
