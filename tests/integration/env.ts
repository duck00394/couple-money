// 在載入 Prisma 之前，把連線改成測試資料庫（避免清空開發資料）
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("請設定 TEST_DATABASE_URL，例如 postgresql://cm:cm@localhost:5432/couple_money_test");
process.env.DATABASE_URL = url;
