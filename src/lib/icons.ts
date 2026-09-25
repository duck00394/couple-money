/**
 * 全站唯一的圖示登錄表。
 *
 * 規則（之後改動不可破壞）：
 *   1. **UI 不使用 emoji**。資料庫存的是這裡的 icon key（例如 "utensils"），
 *      畫面一律透過 `<Icon name={key} />` 轉成 lucide 的線性 SVG。
 *   2. 只用 `lucide-react` 一套圖庫，不再引入第二套。
 *   3. 找不到對應的 key 就退回 `FALLBACK_ICON`，畫面不會壞掉、也不會冒出 emoji。
 *   4. `LEGACY_EMOJI_ICON` 只用來轉換舊資料（migration 與讀取時的保險），
 *      **不可以拿它把 emoji 顯示回畫面上**。
 */
import {
  Banknote, Bell, BookOpen, Brush, Bus, Cake, CalendarClock, Car, Check, CheckCircle,
  ChefHat, Clapperboard, Coffee, Coins, CreditCard, Dog, Droplet, Dumbbell, Flame, Footprints,
  Fuel, Gamepad2, Gem, Gift, GraduationCap, Handshake, Heart, HeartHandshake, Hotel, House,
  Download, ImagePlus, Landmark, Laptop, Leaf, Lightbulb, Lock, Mail, Map, Medal, Moon, Mountain,
  NotebookPen, Package, PartyPopper, Pencil, PersonStanding, PhoneOff, PiggyBank, Pill, Plane,
  Receipt, ReceiptText, RotateCcw, Scissors, Search, Shirt, ShoppingBag, Smartphone, Sofa,
  Sparkles, Sprout, Stethoscope, Tag, Target, Trash2, TrendingUp, Trophy, Undo2, Users,
  Utensils, UtensilsCrossed, Wallet, Repeat, ArrowLeftRight, ArrowDown, Hourglass, Wrench, X, Menu,
  type LucideIcon,
} from "lucide-react";

/** key → lucide 元件。新增圖示只要加在這裡。 */
export const ICONS = {
  // 生活與分類
  tag: Tag,
  utensils: Utensils,
  "utensils-crossed": UtensilsCrossed,
  coffee: Coffee,
  bus: Bus,
  car: Car,
  fuel: Fuel,
  house: House,
  lightbulb: Lightbulb,
  smartphone: Smartphone,
  package: Package,
  "shopping-bag": ShoppingBag,
  shirt: Shirt,
  clapperboard: Clapperboard,
  gamepad: Gamepad2,
  plane: Plane,
  hotel: Hotel,
  pill: Pill,
  stethoscope: Stethoscope,
  dog: Dog,
  gift: Gift,
  scissors: Scissors,
  book: BookOpen,
  "piggy-bank": PiggyBank,
  banknote: Banknote,
  receipt: Receipt,
  coins: Coins,
  heart: Heart,
  cake: Cake,
  "graduation-cap": GraduationCap,
  gem: Gem,
  sofa: Sofa,
  mountain: Mountain,
  laptop: Laptop,
  map: Map,
  // 任務
  "check-circle": CheckCircle,
  "chef-hat": ChefHat,
  run: Footprints,
  walk: PersonStanding,
  medal: Medal,
  trophy: Trophy,
  mail: Mail,
  droplet: Droplet,
  dumbbell: Dumbbell,
  "phone-off": PhoneOff,
  lock: Lock,
  moon: Moon,
  brush: Brush,
  sparkles: Sparkles,
  sprout: Sprout,
  leaf: Leaf,
  // 帳戶
  wallet: Wallet,
  "credit-card": CreditCard,
  landmark: Landmark,
  couple: HeartHandshake,
  // 功能與狀態
  target: Target,
  "calendar-clock": CalendarClock,
  stats: TrendingUp,
  transfer: ArrowLeftRight,
  refund: Undo2,
  recurring: Repeat,
  settle: Handshake,
  adjust: NotebookPen,
  transaction: ReceiptText,
  search: Search,
  trash: Trash2,
  pencil: Pencil,
  check: Check,
  close: X,
  hourglass: Hourglass,
  "arrow-down": ArrowDown,
  undo: RotateCcw,
  bell: Bell,
  people: Users,
  flame: Flame,
  celebrate: PartyPopper,
  photo: ImagePlus,
  tool: Wrench,
  menu: Menu,
  download: Download,
} as const;

export type IconName = keyof typeof ICONS;

export const FALLBACK_ICON: IconName = "tag";

export function iconOf(name: string | null | undefined): LucideIcon {
  return ICONS[(name ?? "") as IconName] ?? ICONS[FALLBACK_ICON];
}

export function isIconName(name: string | null | undefined): name is IconName {
  return !!name && name in ICONS;
}

/**
 * 舊資料的 emoji → icon key。
 * 只用於：① 一次性 migration ② 讀到還沒轉換的舊值時的保險。
 * 沒對應到的一律用 `FALLBACK_ICON`。
 */
export const LEGACY_EMOJI_ICON: Record<string, IconName> = {
  "🏷️": "tag", "🏷": "tag",
  "🍜": "utensils", "🍱": "utensils-crossed", "☕": "coffee", "🍳": "chef-hat",
  "🚌": "bus", "🚗": "car", "⛽": "fuel", "🚲": "run",
  "🏠": "house", "💡": "lightbulb", "📱": "smartphone", "🧻": "package",
  "🛍️": "shopping-bag", "🛍": "shopping-bag", "👕": "shirt",
  "🎬": "clapperboard", "🎮": "gamepad", "✈️": "plane", "✈": "plane",
  "🏨": "hotel", "💊": "pill", "🏥": "stethoscope", "🐶": "dog", "🐕": "dog",
  "🎁": "gift", "💇": "scissors", "📚": "book", "📖": "book",
  "💰": "piggy-bank", "🐷": "piggy-bank", "💵": "banknote", "🧾": "receipt",
  "💞": "couple", "💕": "heart", "❤️": "heart", "💍": "gem",
  "🎂": "cake", "🎓": "graduation-cap", "🛋️": "sofa", "🛋": "sofa",
  "⛰️": "mountain", "⛰": "mountain", "💻": "laptop", "🗾": "map", "🌸": "leaf",
  "🎯": "target", "📅": "calendar-clock", "📊": "stats",
  "🔁": "transfer", "↩️": "refund", "↩": "refund", "🤝": "settle", "📒": "adjust",
  "🏦": "landmark", "💳": "credit-card", "👛": "wallet",
  "✅": "check-circle", "✓": "check", "✔️": "check", "✔": "check",
  "⏳": "hourglass", "⌛": "hourglass", "⬇️": "arrow-down", "⬇": "arrow-down", "↓": "arrow-down", "🏅": "medal", "🏆": "trophy",
  "💌": "mail", "💧": "droplet", "💪": "dumbbell", "📵": "phone-off",
  "🔒": "lock", "😴": "moon", "🧹": "brush", "🧘": "sparkles", "🚶": "walk", "🏃": "run",
  "🔥": "flame", "🎉": "celebrate", "🌱": "sprout", "🌿": "leaf", "🍃": "leaf",
  "🔔": "bell", "🔍": "search", "🗑️": "trash", "🗑": "trash", "✏️": "pencil", "✏": "pencil",
  "📷": "photo", "⚙️": "tool", "⚙": "tool", "📎": "photo", "📌": "tag",
};

/**
 * lucide 元件名 → icon key（"Wallet" → "wallet"、"CheckCircle" → "check-circle"）。
 * 有些舊資料存的是元件名而不是 key，沒有這層就會全部掉到 fallback，變成一片標籤圖示。
 */
const COMPONENT_NAME_ICON: Record<string, IconName> = Object.fromEntries(
  Object.entries(ICONS).map(([key, comp]) => [(comp as { displayName?: string; name?: string }).displayName ?? (comp as { name?: string }).name ?? key, key as IconName]),
) as Record<string, IconName>;

/**
 * 舊值一律正規化成 icon key。可能是：
 *   已經是 key（"wallet"）／舊 emoji（"💰"）／lucide 元件名（"Wallet"）／完全不認識的字串。
 * 認不出來的一律回 FALLBACK_ICON —— 絕對不會把原字串傳出去變成畫面上的文字。
 */
export function toIconKey(value: string | null | undefined): IconName {
  const v = (value ?? "").trim();
  if (isIconName(v)) return v;
  if (LEGACY_EMOJI_ICON[v]) return LEGACY_EMOJI_ICON[v];
  if (COMPONENT_NAME_ICON[v]) return COMPONENT_NAME_ICON[v];
  // "Check Circle"、"check_circle"、"CHECK-CIRCLE" 這種變形也試著救回來
  const kebab = v.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase();
  return isIconName(kebab) ? kebab : FALLBACK_ICON;
}
