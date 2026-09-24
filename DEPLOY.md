# Couple Money — 安裝與部署

這份文件只講三件事：**在自己電腦上跑起來**、**部署到 Vercel**、**要設哪些環境變數**。

> 這個版本是 V2：全站已經沒有 emoji（圖示是 lucide 的 SVG）、預算分成共同與個人、
> 可以上傳使用者頭貼，而且照片有真正的物件儲存層。

---

## 1. 在自己的電腦上跑起來

需要 **Node.js 20 以上** 與 **PostgreSQL 14 以上**。

```bash
npm install                  # 會自動跑 prisma generate
cp .env.example .env         # 然後編輯 .env，填入你的資料庫連線字串
npx prisma migrate deploy    # 建立／更新資料表（第一次跑會建立全部）
npm run dev                  # 打開 http://localhost:3000
```

`.env` 至少要有這兩行（本機兩行填一樣的就好）：

```
DATABASE_URL="postgresql://使用者:密碼@localhost:5432/couple_money"
DATABASE_URL_UNPOOLED="postgresql://使用者:密碼@localhost:5432/couple_money"
```

> Prisma CLI 只讀 `.env`（不讀 `.env.local`），而且**兩個變數都要有**，
> 少一個會出現 Validation Error。

### 用手機測試

同一個 Wi-Fi 底下：

```bash
npm run dev -- -H 0.0.0.0
```

手機瀏覽器開 `http://電腦的區域網路IP:3000`。

### 正式模式（本機）

```bash
npm run build
npm start        # http://localhost:3000
```

---

## 2. 資料庫 migration

```bash
npx prisma migrate deploy    # 套用所有還沒套用的 migration（正式環境用這個）
npx prisma migrate status    # 看目前落後幾個
```

V2 新增了兩個 migration，**都不會動到任何金額、交易、分帳或餘額**：

| migration | 做什麼 | 為什麼需要 |
|---|---|---|
| `20260923120000_icon_keys` | 把 `Category.icon`、`Fund.emoji`、`Goal.emoji`、`Task.emoji`、`Book.coverEmoji`、`UserAchievement.emoji`、`TaskMilestone.badgeEmoji` 裡的舊 emoji 轉成 icon key，並改掉預設值 | 全站不再用 emoji 當圖示。已經是 key 的原樣保留，對不到的退回該表的預設圖示，**沒有任何一筆分類／基金／目標／任務會消失** |
| `20260923130000_budget_subject_key` | `Budget` 新增 `subjectKey`（預設 `'COUPLE'`），唯一鍵改成 `[bookId, categoryId, month, subjectKey]` | 同一個分類要能同時有共同預算與兩個人的個人預算。**既有預算全部視為共同預算，行為完全不變** |

升級前建議先備份：

```bash
bash scripts/backup.sh          # pg_dump + 照片，輸出到 ./backups/<日期>/
```

---

## 3. 部署到 Vercel

### 3-1 資料庫

Vercel 本身沒有資料庫，需要一個對外的 PostgreSQL（Neon 免費方案就夠）。
Neon 建好之後會拿到兩個連線字串：

- **Pooled**（含 `-pooler`）→ 給 `DATABASE_URL`
- **Direct / Unpooled** → 給 `DATABASE_URL_UNPOOLED`（migration 用）

### 3-2 Build Command

Vercel 專案設定 → **Build & Development Settings** → Build Command 改成：

```
npm run vercel-build
```

（等同 `prisma generate && prisma migrate deploy && next build`，所以每次部署會自動套用 migration。）

### 3-3 照片儲存（Vercel Blob）

Vercel 的機器**沒有持久硬碟**，寫進檔案系統的照片下次部署就會消失。
所以線上環境要接 Vercel Blob：

1. Vercel 專案 → **Storage** → **Create Database** → 選 **Blob** → Connect 到這個專案
2. Vercel 會自動把 `BLOB_READ_WRITE_TOKEN` 注入這個專案的環境變數
3. 這個 App 偵測到那個變數就會**自動**改用 Blob，不需要改任何程式碼

沒有接 Blob 的話，伺服器會直接拒絕上傳（錯誤訊息：「這個環境還沒有設定照片儲存空間」），
不會讓使用者傳完才發現檔案不見。如果暫時不想要照片功能，可以設 `NEXT_PUBLIC_PHOTOS_ENABLED=0`
把上傳入口整個藏起來。

> Blob 全部走 `access: "private"`，而且讀取一律經過 `/api/files/[id]` 的帳本成員檢查，
> 所以照片網址不會外流。**Token 不要寫進程式碼或 commit，只放在 Vercel 的環境變數裡。**

---

## 4. 環境變數一覽

### 一定要設（沒有就跑不起來）

| 變數 | 用途 | 在哪裡設 |
|---|---|---|
| `DATABASE_URL` | App 連資料庫用的連線字串（Neon 用 pooled 的那一條） | 本機：專案根目錄的 `.env`；線上：Vercel → Settings → Environment Variables |
| `DATABASE_URL_UNPOOLED` | migration 用的直連字串（Neon 用 direct／unpooled 那一條；本機填跟上面一樣） | 同上 |

### 線上建議設定

| 變數 | 用途 | 在哪裡設 |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 的讀寫權杖。**有這個變數就會自動改用 Blob 存照片與頭貼** | Vercel → Storage → 建立 Blob store 並 Connect 到專案後**自動注入**，不用手動填 |

### 選用（不設也會動）

| 變數 | 預設 | 用途 | 在哪裡設 |
|---|---|---|---|
| `STORAGE_DRIVER` | 自動判斷 | 明確指定儲存方式：`local`（磁碟）或 `blob`（Vercel Blob）。留空就是「有 `BLOB_READ_WRITE_TOKEN` 用 blob，否則用 local」 | `.env` 或 Vercel |
| `UPLOAD_DIR` | 專案下的 `.uploads/` | `local` driver 把照片寫到哪個資料夾 | `.env` |
| `NEXT_PUBLIC_PHOTOS_ENABLED` | `1`（開啟） | 設成 `0` 會把收據照片、打卡照片、頭貼的上傳入口整個藏起來 | `.env` 或 Vercel |
| `TEST_DATABASE_URL` | — | 整合測試要用的資料庫（**會被清空**，千萬不要填正式資料庫） | 只在跑測試時當作指令前綴 |
| `BASE_URL` | `http://localhost:3000` | E2E 測試要打哪個網址 | 只在跑測試時當作指令前綴 |
| `BACKUP_DIR` | `./backups` | `scripts/backup.sh` 的輸出位置 | 只在跑備份時當作指令前綴 |

**這份清單裡沒有任何一個變數是我幫你設好的。** 線上環境要自己到 Vercel 的
Settings → Environment Variables 填，或照 3-3 把 Blob store connect 上去讓它自動注入。

---

## 5. 測試指令

```bash
# 1. 純邏輯（不需要資料庫）
npm test

# 2. 服務層整合測試（會清空 TEST_DATABASE_URL 指向的資料庫！）
TEST_DATABASE_URL=postgresql://使用者:密碼@localhost:5432/couple_money_test \
  npm run test:integration

# 3. 型別與 lint
npx tsc --noEmit
npm run lint

# 4. 端到端（兩支手機瀏覽器跑完整流程）
npm run build
DATABASE_URL=postgresql://使用者:密碼@localhost:5432/couple_money_e2e \
DATABASE_URL_UNPOOLED=postgresql://使用者:密碼@localhost:5432/couple_money_e2e \
PORT=3100 npm start &
BASE_URL=http://localhost:3100 npm run test:e2e
```

E2E 會建立隨機 Email 的測試帳號，**請不要對正式資料庫執行**。

---

## 6. 備份與還原

```bash
bash scripts/backup.sh                        # 輸出到 ./backups/<日期>/
BACKUP_DIR=/mnt/nas/cm bash scripts/backup.sh
```

備份資料夾裡的 `README.txt` 寫了還原步驟。CSV 匯出是給人跟試算表看的明細，**還原不了 App**，
真正的備份是這支腳本（`pg_dump` + 照片打包）。

---

## 7. 常見狀況

| 狀況 | 原因與解法 |
|---|---|
| `prisma migrate deploy` 說 Validation Error | `.env` 裡少了 `DATABASE_URL_UNPOOLED`，兩個都要有 |
| Windows PowerShell 說「已停用指令碼執行」 | 改用 `cmd`（或直接打 `npm.cmd`） |
| 上傳照片出現「這個環境還沒有設定照片儲存空間」 | 部署在沒有硬碟的平台又沒接 Blob，照 3-3 建立 Blob store |
| 照片上傳後過幾天不見了 | 線上還在用 `local` driver，同上 |
| 部署後資料表沒建立 | Build Command 沒改成 `npm run vercel-build` |
| 改了 schema 之後 TypeScript 說某個欄位不存在 | 跑 `npx prisma generate` |
