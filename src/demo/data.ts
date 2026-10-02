/**
 * 試用模式的固定假資料。
 *
 * **全部是編造的**，一個字都不是從正式資料庫來的（規格點 17）：
 * 假名字、假帳戶、假金額，沒有 Email、沒有真實頭貼。
 *
 * 資料量刻意壓在「看起來完整但不複雜」：交易 22 筆、帳戶 3 個、基金 2 個、
 * 任務 5 個、預購 4 筆、結算 1 筆。目的是展示功能，不是模擬一年的財務。
 *
 * 寫法上，除了 users / accounts / categories / 購買紀錄的分類樹是靜態的，
 * **其餘全部用 DemoOp 跑出來**（見 engine.ts）。好處是預設資料與使用者自己操作走
 * 完全同一條路徑：如果 seed 跑得出來，新增功能就一定也能跑。
 */
import { addDays, toDateKey } from "@/lib/dates";
import { applyOps } from "./engine";
import type { DemoOp, DemoState } from "./types";

/** Demo 的兩個人。A 是「我」（登入者視角），B 是另一半。 */
export const DEMO_ME = "demo_a";
export const DEMO_PARTNER = "demo_b";

const ACC_JOINT = "acc_joint";
const ACC_A = "acc_a";
const ACC_B = "acc_b";

const C = {
  food: "cat_food",
  transit: "cat_transit",
  date: "cat_date",
  daily: "cat_daily",
  shop: "cat_shop",
  fun: "cat_fun",
  home: "cat_home",
  medical: "cat_medical",
  salary: "cat_salary",
  bonus: "cat_bonus",
} as const;

const F_TRIP = "fund_trip";
const F_WASHER = "fund_washer";

const T_DISHES = "task_dishes";
const T_TRASH = "task_trash";
const T_MOP = "task_mop";
const T_BOOK = "task_book";
const T_PLANT = "task_plant";

const G_CHIIKAWA = "pg_chiikawa";
const G_HAIKYU = "pg_haikyu";

/** 不含任何交易的空白底盤。users / accounts / categories 是靜態的，其餘由 ops 長出來。 */
function baseState(): DemoState {
  return {
    users: [
      { id: DEMO_ME, nickname: "小桃", avatarColor: "#ff9e3d" },
      { id: DEMO_PARTNER, nickname: "阿柴", avatarColor: "#6bb3a0" },
    ],
    accounts: [
      { id: ACC_JOINT, name: "共同生活費", type: "JOINT", ownerId: null, isActive: true },
      { id: ACC_A, name: "小桃的錢包", type: "CASH", ownerId: DEMO_ME, isActive: true },
      { id: ACC_B, name: "阿柴的銀行", type: "BANK", ownerId: DEMO_PARTNER, isActive: true },
    ],
    categories: [
      { id: C.food, kind: "EXPENSE", name: "餐飲", icon: "utensils" },
      { id: C.transit, kind: "EXPENSE", name: "交通", icon: "bus" },
      { id: C.date, kind: "EXPENSE", name: "約會", icon: "heart" },
      { id: C.daily, kind: "EXPENSE", name: "日用品", icon: "package" },
      { id: C.shop, kind: "EXPENSE", name: "購物", icon: "shopping-bag" },
      { id: C.fun, kind: "EXPENSE", name: "娛樂", icon: "clapperboard" },
      { id: C.home, kind: "EXPENSE", name: "居家", icon: "house" },
      { id: C.medical, kind: "EXPENSE", name: "醫療", icon: "pill" },
      { id: C.salary, kind: "INCOME", name: "薪水", icon: "banknote" },
      { id: C.bonus, kind: "INCOME", name: "獎金", icon: "gift" },
    ],
    txs: [],
    funds: [],
    fundTxs: [],
    tasks: [],
    checkIns: [],
    preorders: [],
    purchaseGroups: [
      { id: G_CHIIKAWA, name: "吉伊卡哇", icon: "sparkles" },
      { id: G_HAIKYU, name: "排球少年", icon: "trophy" },
    ],
    purchaseTags: [
      { id: "pt_chiikawa", groupId: G_CHIIKAWA, name: "吉伊", isDefault: true },
      { id: "pt_hachiware", groupId: G_CHIIKAWA, name: "小八", isDefault: false },
      { id: "pt_usagi", groupId: G_CHIIKAWA, name: "烏薩奇", isDefault: false },
      { id: "pt_hinata", groupId: G_HAIKYU, name: "日向", isDefault: true },
      { id: "pt_kageyama", groupId: G_HAIKYU, name: "影山", isDefault: false },
      { id: "pt_tsukki", groupId: G_HAIKYU, name: "月島", isDefault: false },
    ],
    purchaseCategories: [
      { id: "pc_c_hang", groupId: G_CHIIKAWA, name: "吊娃", isDefault: false },
      { id: "pc_c_s", groupId: G_CHIIKAWA, name: "S娃", isDefault: false },
      { id: "pc_c_gacha", groupId: G_CHIIKAWA, name: "扭蛋", isDefault: false },
      { id: "pc_c_ichiban", groupId: G_CHIIKAWA, name: "一番賞", isDefault: false },
      { id: "pc_c_other", groupId: G_CHIIKAWA, name: "其他", isDefault: true },
      { id: "pc_h_hang", groupId: G_HAIKYU, name: "吊娃", isDefault: false },
      { id: "pc_h_card", groupId: G_HAIKYU, name: "色紙", isDefault: false },
      { id: "pc_h_badge", groupId: G_HAIKYU, name: "徽章", isDefault: false },
      { id: "pc_h_other", groupId: G_HAIKYU, name: "其他", isDefault: true },
    ],
    purchaseEntries: [],
    // V14：試用模式預設就是一本「剛去完日本」的帳本，所以先放好日圓匯率。
    // 朋友可以直接看到原幣 → 匯率 → 台幣換算這一整條（規格點 21）。
    baseCurrency: "TWD",
    rates: [{ currency: "JPY", foreignUnits: 100, baseMinor: 2150 }],
    seq: 1,
  };
}

/* ───────────────────────── 分帳規則的簡寫 ───────────────────────── */

const EQUAL = { method: "EQUAL" as const, participants: [{ userId: DEMO_ME }, { userId: DEMO_PARTNER }] };
const MINE = { method: "FULL" as const, participants: [{ userId: DEMO_ME }] };
const HERS = { method: "FULL" as const, participants: [{ userId: DEMO_PARTNER }] };

/** $ 轉成最小單位。Demo 的金額全部寫成「元」比較好讀，這裡一次換算。 */
const $ = (yuan: number) => Math.round(yuan * 100);

/**
 * 預設資料的操作清單。
 *
 * 刻意涵蓋規格點 15 要求的每一種情況，而不是塞一堆同質的交易：
 *   共同支出、A 個人支出、B 個人支出、A 付 B 擔、B 付 A 擔、收入、
 *   退款、轉帳（基金投入）、結算、今天的交易、不同付款人、不同負擔人。
 */
function seedOps(today: string): DemoOp[] {
  /**
   * 日期要同時滿足兩件事，而且**不管朋友哪一天打開都要成立**：
   *   (1) 最近紀錄要散開在不同日子（不能全部擠在今天）
   *   (2)「本月」要有收入也有支出（不能一片空白）
   *
   * 踩過兩次坑才收斂成現在這樣：
   *   第一版 `today − n` → 1 號打開時全部掉到上個月，本月整個空的。
   *   第二版把日期夾在月初 → 1 號打開時 21 筆全部塌到「今天」那一組，更怪。
   *
   * 現在改成分兩種：日常開銷用自然散開的 d()，而「每個月固定會發生」的那幾筆
   * （薪水、月費、電費）用 early()，放在月初的前幾天 —— 這本來就是它們真實發生的時間，
   * 所以就算今天是 1 號，本月也一定有收入與固定支出，而且不需要假造任何東西。
   */

  /** n 天前，自然散開（可能落在上個月，那是正常的）。 */
  const d = (n: number) => addDays(today, -n);

  /** 本月的第 k 天，但不會超過今天。用在「月初固定會發生」的收支。 */
  const early = (k: number) => {
    const target = `${today.slice(0, 7)}-${String(k).padStart(2, "0")}`;
    return target > today ? today : target;
  };

  return [
    // ── 期初餘額：讓三個帳戶一開始就有錢，畫面才不會全是負數 ──
    { kind: "account.opening", accountId: ACC_JOINT, amount: $(28000), occurredOn: d(40) },
    { kind: "account.opening", accountId: ACC_A, amount: $(12000), occurredOn: d(40) },
    { kind: "account.opening", accountId: ACC_B, amount: $(35000), occurredOn: d(40) },

    // ── 收入 ──
    { kind: "tx.add", input: { type: "INCOME", title: "這個月的薪水", amount: $(48000), occurredOn: early(5), categoryId: C.salary, note: "", payers: [{ accountId: ACC_B, amount: $(48000) }], rule: HERS } },
    { kind: "tx.add", input: { type: "INCOME", title: "接案尾款", amount: $(9500), occurredOn: d(18), categoryId: C.bonus, note: "", payers: [{ accountId: ACC_A, amount: $(9500) }], rule: MINE } },

    // ── 共同支出（共同帳戶付，兩人平分）──
    { kind: "tx.add", input: { type: "EXPENSE", title: "家樂福採買", amount: $(2380), occurredOn: d(21), categoryId: C.daily, note: "衛生紙、洗衣精", payers: [{ accountId: ACC_JOINT, amount: $(2380) }], rule: EQUAL } },
    { kind: "tx.add", input: { type: "EXPENSE", title: "電費", amount: $(1640), occurredOn: early(3), categoryId: C.home, note: "", payers: [{ accountId: ACC_JOINT, amount: $(1640) }], rule: EQUAL } },
    { kind: "tx.add", input: { type: "EXPENSE", title: "網路月費", amount: $(899), occurredOn: early(2), categoryId: C.home, note: "", payers: [{ accountId: ACC_JOINT, amount: $(899) }], rule: EQUAL } },

    // ── A 付款、兩人平分（最常見的代墊）──
    { kind: "tx.add", input: { type: "EXPENSE", title: "麻辣鍋", amount: $(1680), occurredOn: d(12), categoryId: C.food, note: "慶祝加薪", payers: [{ accountId: ACC_A, amount: $(1680) }], rule: EQUAL, tags: ["約會"] } },
    { kind: "tx.add", input: { type: "EXPENSE", title: "看電影", amount: $(760), occurredOn: d(9), categoryId: C.fun, note: "", payers: [{ accountId: ACC_A, amount: $(760) }], rule: EQUAL, tags: ["約會"] } },

    // ── B 付款、兩人平分 ──
    { kind: "tx.add", input: { type: "EXPENSE", title: "加油", amount: $(1200), occurredOn: d(11), categoryId: C.transit, note: "", payers: [{ accountId: ACC_B, amount: $(1200) }], rule: EQUAL } },
    { kind: "tx.add", input: { type: "EXPENSE", title: "日式燒肉", amount: $(2460), occurredOn: d(7), categoryId: C.food, note: "", payers: [{ accountId: ACC_B, amount: $(2460) }], rule: EQUAL, tags: ["約會"] } },

    // ── A 付款但 B 全額負擔（規格點 15 要求的情況）──
    { kind: "tx.add", input: { type: "EXPENSE", title: "阿柴的球鞋", amount: $(3280), occurredOn: d(16), categoryId: C.shop, note: "小桃先刷，阿柴的東西", payers: [{ accountId: ACC_A, amount: $(3280) }], rule: HERS } },
    { kind: "tx.add", input: { type: "EXPENSE", title: "阿柴的感冒藥", amount: $(420), occurredOn: d(6), categoryId: C.medical, note: "", payers: [{ accountId: ACC_A, amount: $(420) }], rule: HERS } },

    // ── B 付款但 A 全額負擔 ──
    { kind: "tx.add", input: { type: "EXPENSE", title: "小桃的瑜珈課", amount: $(2800), occurredOn: d(15), categoryId: C.fun, note: "阿柴先付", payers: [{ accountId: ACC_B, amount: $(2800) }], rule: MINE } },

    // ── 各自的個人支出（自己付自己擔，不產生欠款）──
    { kind: "tx.add", input: { type: "EXPENSE", title: "手機殼", amount: $(390), occurredOn: d(13), categoryId: C.shop, note: "", payers: [{ accountId: ACC_A, amount: $(390) }], rule: MINE } },
    { kind: "tx.add", input: { type: "EXPENSE", title: "漫畫新刊", amount: $(540), occurredOn: d(8), categoryId: C.fun, note: "", payers: [{ accountId: ACC_B, amount: $(540) }], rule: HERS } },

    // ── 依份數分攤（展示非平分）──
    { kind: "tx.add", input: { type: "EXPENSE", title: "外送晚餐", amount: $(650), occurredOn: d(5), categoryId: C.food, note: "阿柴加點了一份甜點", payers: [{ accountId: ACC_A, amount: $(650) }], rule: { method: "SHARES", participants: [{ userId: DEMO_ME, value: 2 }, { userId: DEMO_PARTNER, value: 3 }] } } },

    // ── 退款（分帳是負的，會自動沖銷）──
    { kind: "tx.add", input: { type: "REFUND", title: "退：球鞋尺寸不合", amount: $(3280), occurredOn: d(4), categoryId: C.shop, note: "全額退", payers: [{ accountId: ACC_A, amount: $(3280) }], rule: HERS } },

    // ── 結算一次（展示欠款被還掉）──
    { kind: "settle", fromUserId: DEMO_PARTNER, toUserId: DEMO_ME, amount: $(1500), occurredOn: d(3), note: "先還一部分" },

    // ── 今天的交易：首頁「今天」區塊要有東西 ──
    { kind: "tx.add", input: { type: "EXPENSE", title: "早餐店", amount: $(150), occurredOn: today, categoryId: C.food, note: "", payers: [{ accountId: ACC_JOINT, amount: $(150) }], rule: EQUAL } },
    { kind: "tx.add", input: { type: "EXPENSE", title: "便利商店", amount: $(88), occurredOn: today, categoryId: C.daily, note: "", payers: [{ accountId: ACC_A, amount: $(88) }], rule: EQUAL } },
    { kind: "tx.add", input: { type: "EXPENSE", title: "捷運儲值", amount: $(500), occurredOn: today, categoryId: C.transit, note: "", payers: [{ accountId: ACC_B, amount: $(500) }], rule: HERS } },
    { kind: "tx.add", input: { type: "EXPENSE", title: "吉伊卡哇吊娃", amount: $(680), occurredOn: today, categoryId: C.shop, note: "扭蛋機轉到的", payers: [{ accountId: ACC_A, amount: $(680) }], rule: MINE } },

    // ── 日本旅遊：原幣記帳，照 100 JPY = 21.5 TWD 換算成台幣 ──
    //    ¥2,500 → NT$537.50　¥8,000 → NT$1,720　¥1,200 → NT$258
    { kind: "tx.add", input: { type: "EXPENSE", title: "一蘭拉麵", amount: 0, currency: "JPY", foreignAmount: 2500, occurredOn: d(6), categoryId: C.food, note: "東京車站店", payers: [{ accountId: ACC_A, amount: 0 }], rule: EQUAL, tags: ["日本旅行"] } },
    { kind: "tx.add", input: { type: "EXPENSE", title: "藥妝店掃貨", amount: 0, currency: "JPY", foreignAmount: 8000, occurredOn: d(5), categoryId: C.shop, note: "面膜、眼藥水", payers: [{ accountId: ACC_B, amount: 0 }], rule: EQUAL, tags: ["日本旅行"] } },
    { kind: "tx.add", input: { type: "EXPENSE", title: "地鐵一日券", amount: 0, currency: "JPY", foreignAmount: 1200, occurredOn: d(5), categoryId: C.transit, note: "", payers: [{ accountId: ACC_A, amount: 0 }], rule: MINE, tags: ["日本旅行"] } },

    // ── 基金 ──
    { kind: "fund.add", id: F_TRIP, name: "沖繩旅行", icon: "plane", targetAmount: $(60000) },
    { kind: "fund.add", id: F_WASHER, name: "換洗衣機", icon: "house", targetAmount: $(18000) },
    { kind: "fund.deposit", fundId: F_TRIP, amount: $(18000), occurredOn: d(30), note: "第一筆" },
    { kind: "fund.deposit", fundId: F_TRIP, amount: $(6000), occurredOn: d(10), note: "九月" },
    { kind: "fund.deposit", fundId: F_WASHER, amount: $(4500), occurredOn: d(20), note: "" },

    // ── 任務 ──
    { kind: "task.add", id: T_DISHES, name: "洗碗", icon: "utensils", assigneeId: null, rewardAmount: $(20), weekdays: [] },
    { kind: "task.add", id: T_TRASH, name: "倒垃圾", icon: "package", assigneeId: DEMO_PARTNER, rewardAmount: $(15), weekdays: [1, 3, 5] },
    { kind: "task.add", id: T_MOP, name: "拖地", icon: "house", assigneeId: DEMO_ME, rewardAmount: $(30), weekdays: [6] },
    { kind: "task.add", id: T_BOOK, name: "記帳對帳", icon: "tag", assigneeId: DEMO_ME, rewardAmount: $(10), weekdays: [] },
    { kind: "task.add", id: T_PLANT, name: "澆花", icon: "sprout", assigneeId: null, rewardAmount: $(5), weekdays: [2, 5] },

    // ── 幾天前的打卡紀錄（獎勵餘額才不會是 0）──
    { kind: "task.checkIn", taskId: T_DISHES, userId: DEMO_ME, dateKey: d(1) },
    { kind: "task.checkIn", taskId: T_DISHES, userId: DEMO_PARTNER, dateKey: d(1) },
    { kind: "task.checkIn", taskId: T_DISHES, userId: DEMO_ME, dateKey: d(2) },
    { kind: "task.checkIn", taskId: T_BOOK, userId: DEMO_ME, dateKey: d(1) },
    // 今天也先打一個，首頁的「今日獎勵」才不會是 0（其餘留給朋友自己點）
    { kind: "task.checkIn", taskId: T_BOOK, userId: DEMO_ME, dateKey: today },

    // ── 預購 ──
    { kind: "preorder.add", input: { name: "吉伊卡哇一番賞 A 賞", seller: "蝦皮・娃娃屋", emoji: "🧸", expectedOn: addDays(today, 12), ownerId: null, paidById: DEMO_ME, status: "PENDING", items: [{ name: "A 賞 大娃", amount: $(1800), ownerId: null }, { name: "B 賞 吊飾", amount: $(450), ownerId: DEMO_ME }] } },
    { kind: "preorder.add", input: { name: "排球少年 色紙 BOX", seller: "日本代購", emoji: "🏐", expectedOn: addDays(today, 25), ownerId: DEMO_PARTNER, paidById: DEMO_PARTNER, status: "PENDING", items: [{ name: "色紙一箱", amount: $(2400), ownerId: DEMO_PARTNER }] } },
    { kind: "preorder.add", input: { name: "小八 S 娃", seller: "官方商店", emoji: "🐱", expectedOn: addDays(today, 5), ownerId: DEMO_ME, paidById: DEMO_PARTNER, status: "PENDING", items: [{ name: "S 娃 本體", amount: $(1280), ownerId: DEMO_ME }, { name: "專用衣服", amount: $(380), ownerId: DEMO_ME }] } },
    { kind: "preorder.add", input: { name: "月島 亞克力立牌", seller: "AmiAmi", emoji: "🎴", expectedOn: addDays(today, -2), ownerId: DEMO_PARTNER, paidById: DEMO_ME, status: "ARRIVED", items: [{ name: "立牌", amount: $(760), ownerId: DEMO_PARTNER }] } },

    // ── 購買紀錄 ──
    { kind: "purchase.add", input: { groupId: G_CHIIKAWA, categoryId: "pc_c_gacha", tagId: "pt_chiikawa", ownerId: DEMO_ME, title: "吉伊卡哇吊娃", amount: $(680), occurredOn: today, note: "扭蛋機轉到的", transactionId: null } },
    { kind: "purchase.add", input: { groupId: G_CHIIKAWA, categoryId: "pc_c_s", tagId: "pt_hachiware", ownerId: DEMO_ME, title: "小八 S 娃", amount: $(1280), occurredOn: addDays(today, -17), note: "", transactionId: null } },
    { kind: "purchase.add", input: { groupId: G_CHIIKAWA, categoryId: "pc_c_hang", tagId: "pt_usagi", ownerId: null, title: "烏薩奇吊飾（一起買的）", amount: $(420), occurredOn: addDays(today, -23), note: "兩個人一起挑", transactionId: null } },
    { kind: "purchase.add", input: { groupId: G_HAIKYU, categoryId: "pc_h_card", tagId: "pt_tsukki", ownerId: DEMO_PARTNER, title: "月島 色紙", amount: $(350), occurredOn: addDays(today, -8), note: "", transactionId: null } },
    { kind: "purchase.add", input: { groupId: G_HAIKYU, categoryId: "pc_h_badge", tagId: "pt_hinata", ownerId: DEMO_PARTNER, title: "日向 徽章組", amount: $(560), occurredOn: addDays(today, -30), note: "", transactionId: null } },
  ];
}

/**
 * 產生一份全新的預設 Demo 資料。
 *
 * 每次呼叫都重新跑一遍 ops，所以「重置」就只是再呼叫一次這個函式 —— 不需要
 * 深拷貝、也不可能殘留上一輪被改過的資料。
 */
export function createDemoState(now = new Date()): DemoState {
  const today = toDateKey(now);
  return applyOps(baseState(), seedOps(today));
}
