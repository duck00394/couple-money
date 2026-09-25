/**
 * 固定頭貼清單。
 *
 * 使用者只能從這裡「選」，不能上傳 —— 所有圖片都是專案裡既有的檔案，
 * 由 GitHub 管理，不需要任何 storage、upload API 或外部圖片服務。
 *
 * 資料庫存的是 `User.avatarUrl`，值就是下面的路徑字串（例如
 * `/assets/avatars/avatar-01.png`），沒有新增任何欄位。
 *
 * 要新增頭貼：把 PNG 放進 `public/assets/avatars/`，在下面加一筆，重新部署即可。
 */
export const AVATARS = [
  { key: "avatar-01", label: "愛心" },
  { key: "avatar-02", label: "閃亮" },
  { key: "avatar-03", label: "蛋糕" },
  { key: "avatar-04", label: "月亮" },
  { key: "avatar-05", label: "咖啡" },
  { key: "avatar-06", label: "飛機" },
  { key: "avatar-07", label: "狗狗" },
  { key: "avatar-08", label: "葉子" },
  { key: "avatar-09", label: "寶石" },
  { key: "avatar-10", label: "山" },
  { key: "avatar-11", label: "廚師帽" },
  { key: "avatar-12", label: "遊戲" },
] as const;

export type AvatarKey = (typeof AVATARS)[number]["key"];

const KEYS = new Set<string>(AVATARS.map((a) => a.key));

export const isAvatarKey = (v: string | null | undefined): v is AvatarKey => !!v && KEYS.has(v);

/** key → public 路徑。 */
export const avatarSrc = (key: AvatarKey | string) => `/assets/avatars/${key}.png`;

/** 目前存的值對應到哪一個固定頭貼（選不到就是 null，畫面退回色塊 + 名字首字）。 */
export function avatarKeyOf(avatarUrl: string | null | undefined): AvatarKey | null {
  if (!avatarUrl) return null;
  const m = /^\/assets\/avatars\/([\w-]+)\.png$/.exec(avatarUrl);
  return m && isAvatarKey(m[1]) ? m[1] : null;
}
