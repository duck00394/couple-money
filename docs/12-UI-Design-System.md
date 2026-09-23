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
