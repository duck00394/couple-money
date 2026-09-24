import { prisma } from "../db";
import { hashPassword, verifyPassword } from "../auth/password";
import { assert, DomainError } from "../domain/errors";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 預設頭像底色：跟 Design System 同一組霧粉／灰棕，沒有高飽和色。
// 只在註冊時挑一個，之後使用者上傳頭貼就會蓋掉它。
const COLORS = ["#E1CDCC", "#D8C6C2", "#E0C9BE", "#D6C6C9", "#CFC4BC"];

export async function registerUser(input: { email: string; password: string; name: string }) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  assert(EMAIL_RE.test(email), "AUTH_EMAIL", "Email 格式不正確");
  assert(input.password.length >= 8, "AUTH_PASSWORD_SHORT", "密碼至少 8 個字元");
  assert(input.password.length <= 200, "AUTH_PASSWORD_LONG", "密碼太長");
  assert(name.length >= 1 && name.length <= 30, "AUTH_NAME", "暱稱需為 1～30 個字");
  const exists = await prisma.user.findUnique({ where: { email } });
  assert(!exists, "AUTH_EMAIL_TAKEN", "這個 Email 已經註冊過了");
  return prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(input.password),
      avatarColor: COLORS[Math.floor(Math.random() * COLORS.length)],
    },
  });
}

// 帳號不存在時也跑一次雜湊，避免用回應時間猜出 Email 是否註冊
const DUMMY_HASH = hashPassword("dummy-password-for-timing");

export async function authenticate(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
  if (!user || !ok || user.deletedAt) throw new DomainError("AUTH_INVALID", "Email 或密碼錯誤");
  return user;
}
