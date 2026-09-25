# V1 UI/UX：韓系奶油風 Design System

> 這份文件只講「長什麼樣」。任何財務規則、權限、統計口徑請看 `docs/11-Phase3-4-progress.md`。
> **這一階段沒有修改任何 schema、migration、domain／service、統計或權限邏輯。**

## 1. 設計方向

奶油白 × 燕麥 × 豆沙 × 可可，低飽和、溫暖、乾淨。
目標是「情侶每天會打開的生活 App」，不是 SaaS 後台或企業 Dashboard。

財務語意顏色保留，但全部換成柔和版本：

| 語意 | 顏色家族 | 用在哪裡 |
|---|---|---|
| 收入／正向 | 鼠尾草綠 `emerald-*` | 收入金額、退款、已完成、還好 |
| 支出／危險 | 陶土紅 `red-*` | 超支、刪除、錯誤 |
| 快超過 | 杏桃橘 `orange-*` | 預算 ≥80%、信用卡未繳、欠款 |
| 尚未入金 | 蜂蜜 `amber-*` | 任務獎金（還不是現金） |
| 不算收支 | 霧藍 `sky-*` | 轉帳、餘額調整 |
| 主強調 | 豆沙／可可 `brand-*` | 主按鈕、選取狀態、連結 |

## 2. Design Token（`src/app/globals.css`）

全部寫在 Tailwind 4 的 `@theme` 裡，**直接覆寫既有色階變數**，所以整個 App 原本寫的
`stone-*`／`brand-*`／`emerald-*`… 一次全部換成暖色系，不需要每頁各自改。

- **畫布**：`--color-canvas: #f7f3ed`（App 背景）、`--color-white: #fffdfa`（卡片是暖白，不是純白）
- **中性色**：`stone-50 … stone-900` = 燕麥 → 可可；主要文字 `stone-800 #4b4540`、次要文字 `stone-500 #8a8178`
- **主強調**：`brand-400 #c9a9a3`（柔和填色）、`brand-500 #a9877c`（主按鈕，白字對比 ≥ 4.5:1）、`brand-600 #8f7064`（連結）、`brand-700 #6f564c`
- **圓角**：`--radius-xl/2xl/3xl` 整體調圓（卡片 1.25rem）
- **陰影**：`--shadow-xs/sm/md/lg` 改成暖色、極淡（奶油風不吃重陰影）
- **字體**：維持系統字（`PingFang TC` / `Noto Sans TC`）

輔助 class：

- `.press` — 按下時 `scale(.985)`（`prefers-reduced-motion` 時自動停用）
- `.rise` / `.fade` — 抽屜與錯誤訊息出現的輕量動畫
- `.tnum` — 金額用等寬數字，直排時對得齊
- `.sticky-submit-bar` / `.pb-submit-bar` / `.pb-safe` — 沿用原本的送出列規則

## 3. 共用元件（`src/components/ui.tsx`）

| 元件 | 說明 |
|---|---|
| `Card` / `Divider` | 卡片容器與列分隔線 |
| `Button` / `LinkButton` | `primary` / `secondary` / `soft` / `danger` / `ghost`，高度 48px，內建 `.press` |
| `Field` / `Input` / `Select` / `inputClass` | 表單欄位，focus 是豆沙色 4px ring |
| `ErrorText` | `role="alert"` 的錯誤區塊 |
| `Badge` | `neutral` / `brand` / `income` / `warn` / `danger` / `pending` / `info` |
| `ProgressBar` / `TwoPartProgress` | 進度條（後者的斜紋 = 尚未入金獎金） |
| `Empty` | 空狀態：可選 icon + 一句話 + 一個行動 |
| `Skeleton` | 載入骨架（`loading.tsx` 也用它） |
| `PageHeader` / `SectionTitle` / `ListLink` / `Collapsible` / `Avatar` | 版面與導覽 |

**規則：頁面不要自己寫一套卡片／按鈕／空狀態樣式，一律用這裡的元件。**

## 4. 各頁重點

- **首頁**：本月支出做成最大的數字，底下接我負擔／收入；再來是欠款、提醒（固定支出、預算）、
  最近紀錄 3 筆、今日任務、主要目標。沒有資料的提醒完全不佔位置。
- **底部導覽**：選取狀態是豆沙色藥丸底 + 可可色 icon，未選取是暖灰。
- **記帳列表**：捷徑改成 4 欄 icon 磚（高度砍半），日期分組標題加上當日小計，
  每一列是「圖示 + 名稱 + 付款人／分帳 + 金額」的輕量列，不是厚重大卡片。
- **新增／編輯交易**：金額卡最醒目（`text-5xl` + 豆沙色 `$`），順序是
  類型 → 金額 → 分類 → 名稱／日期 → 帳戶 → 基金 → 分帳；標籤與備註收進「其他（選填）」區塊。
  **步驟數完全沒有增加。**
- **統計**：淨支出做成大數字，收入接在同一張卡下面；橫條與趨勢維持純 CSS。
- **預算**：一列看完「預算 → 已支出 → 剩餘 → 使用率」，狀態用柔和色票，超支才用陶土紅。
- **目標／任務**：柔和進度條、狀態 badge、圓角 icon 磚，維持成熟不幼稚。
- **更多**：每一列加一句說明（例如「錢放在哪裡」），icon 放在圓角底色磚裡。

## 5. Responsive

實際在 **390×844 / 390×664 / 320×568** 三個尺寸逐頁截圖檢查：
首頁、記帳、新增交易、統計、預算、更多、目標、任務、帳戶、動態、分類，
三個尺寸都沒有水平溢出、底部導覽列都在。
E2E 的 `ux-audit` 也照舊在 390×664 與 320×568 檢查 17 個頁面。

---

## 6. V2 調整（2026-09）

### 6-1 全站沒有 emoji

圖示一律是 `lucide-react` 的線性 SVG。資料庫裡存的是 **icon key**（例如 `"utensils"`），
畫面透過 `<Icon name={key} />` 轉成元件。三層保險：

1. `src/lib/icons.ts` 是**唯一**的登錄表（`ICONS`、`FALLBACK_ICON`、`toIconKey()`），不引入第二套圖庫
2. migration `20260923120000_icon_keys` 把資料庫裡的舊 emoji 一次轉成 key
3. `toIconKey()` 在讀取時再擋一次；對不到就退回 `FALLBACK_ICON`，畫面不會壞、也不會冒出 emoji

E2E `phase4-ui.ts` 會掃 19 個頁面的文字，出現 emoji 直接讓測試失敗（`＋・→‹›−` 是排版符號，不算）。

### 6-2 減少卡片感

| 之前 | 現在 |
|---|---|
| `bg-white shadow-sm`（看得出來的陰影） | `bg-white shadow-xs ring-1 ring-line/70`（髮絲線 + 幾乎看不見的微光） |
| `divide-stone-100` / `border-stone-100` | `divide-line` / `border-line`（新的 `--color-line: #ece6dd`） |
| `SectionTitle` `mt-6` | `mt-8`，空狀態 `py-8` → `py-10` |

`--shadow-xs` / `--shadow-sm` 都調淡了；`--shadow-md` / `--shadow-lg` 保留給真的要浮起來的東西
（彈出層、固定送出列）。E2E 會檢查首頁主卡片的 `box-shadow` alpha < 0.1。

### 6-3 金額的視覺層級

新增兩個 utility（`globals.css`）：

```css
.amount      /* tabular-nums + 700 + 負字距 -0.02em + 行高 1.1 */
.amount-lg   /* 同上，字距 -0.035em、行高 1.05，給首頁那種大數字 */
```

首頁本月支出、統計淨支出、預算合計、帳戶餘額、記帳列金額、目標金額、金額輸入框都改用它。
E2E 會檢查首頁的金額字級**大於 `<h1>`**，確保金額才是主角。

### 6-4 首頁＝兩個人的生活帳本

最上面是兩個人的頭像（重疊擺放）、帳本名稱與今天的日期，再接「我們這個月花了」＋大數字。
不是「Dashboard / 統計期間 / KPI」那種後台語氣。

### 6-5 頭貼

`Avatar` 多了 `src`：有頭貼就顯示圓形照片（`object-cover`，上傳前已在瀏覽器裁成正方形），
沒有就維持原本的色塊 + 名字首字。頭貼網址是 `/api/files/<attachmentId>`，
會檢查帳本成員身分，所以只有兩個人看得到。

---

## 7. V3 色系：Puff Fav（2026-09）

整組色票換成「奶油白＋霧粉＋灰棕」，**不再使用原本偏黃的奶油色系**。
四個核心色由使用者指定，其餘色階都是從這四個色延伸出來的：

| 角色 | 色碼 | Token |
|---|---|---|
| 主色・柔粉 | `#E1CDCC` | `--color-brand-200` |
| 深色文字／主要 icon／強調色 | `#A08C8B` | `--color-stone-400`、`--color-brand-500` |
| 頁面背景 | `#ECE2E0` | `--color-canvas` |
| 輔助色／邊框 | `#D8C6C2` | `--color-stone-300` |

### 7-1 為什麼主色放在 200 這一階

`bg-brand-500` 原本是「主按鈕底 + 白字」，`text-brand-600` 是連結文字。
如果直接把 `#E1CDCC` 塞進 500，連結文字會比背景還淡。

所以整條色階維持**由淺到深**，主色放在 200：

```
brand-100 #F2E7E6  淡色區塊、導覽列選取藥丸
brand-200 #E1CDCC  ← 主色：主按鈕、選取
brand-300 #D5BBBA  主按鈕按下
brand-400 #C09E9C  進度條、輸入框 focus 外框
brand-500 #A08C8B  強調色：選取外框、重點 icon
brand-600 #87706F  連結文字（對紙張 4.6:1）
brand-700 #6E5A59  深色強調文字
```

主按鈕因此改成 **`#E1CDCC` 底 + 深棕字（`stone-800`）+ 一圈 `brand-400/60` 細外框**。
理由：`#E1CDCC` 配白字只有 1.8:1 完全讀不到；配深棕字是 5.7:1。
而 `#E1CDCC` 對紙張只有 1.2:1，沒有外框會看不出那是一顆按鈕。

### 7-2 文字對比

`#A08C8B` 對紙張是 3.0:1 — 當 icon 與強調色沒問題，當內文不夠。
所以內文用同色相再深一階：

```
stone-400 #A08C8B  主要 icon、placeholder
stone-500 #877170  次要文字（4.5:1）
stone-800 #4E4140  主要文字（8.6:1）
```

### 7-3 語意色

全部壓到跟灰棕同一個明度層，沒有高飽和色：

| 語意 | 色碼 |
|---|---|
| 收入／正向 | `emerald-*`，霧綠 `#7F9A83` |
| 支出／危險 | `red-*`，陶土紅 `#B37A70` |
| 快超過 | `orange-*`，暖褐 `#D2A481` |
| 尚未入金 | `amber-*`，蜂蜜 `#E0C79C` |
| 轉帳／不算收支 | `sky-*`，霧灰藍 `#6F7B87`（唯一的冷色，刻意最不顯眼） |

### 7-4 規則沒變的部分

- 金額仍然是最高視覺層級（`.amount` / `.amount-lg`），色系換了但字級與字重沒動。
- Icon 仍然是 Lucide SVG，沒有 emoji。
- 卡片仍然是「紙張 + 髮絲線 + 幾乎看不見的陰影」，只是髮絲線換成 `#E3D5D2`。
- 頁面不自己寫 HEX：全站只有 `globals.css` 的 `@theme` 有色碼，
  另外兩處是 `layout.tsx` 的 `themeColor` 與 `users.ts` 的預設頭像底色。
