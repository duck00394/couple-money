import { LogoutButton } from "@/components/LogoutButton";
import { BookSettingsForm } from "@/components/BookForms";
import { InviteBox } from "@/components/InviteBox";
import { AvatarForm } from "@/components/AvatarForm";
import { Avatar, Card, ListLink, PageHeader, SectionTitle } from "@/components/ui";
import { toDateKey } from "@/lib/dates";
import { getAppContext } from "@/server/context";
import { prisma } from "@/server/db";
import { ArtIcon } from "@/components/ArtIcon";

/**
 * 「更多」只放低頻管理：每天會用到的（首頁・任務・記帳・基金・統計）都在底部導覽。
 */
const MENU: Array<{ title: string; items: Array<{ href: string; icon: string; label: string; sub?: string }> }> = [
  {
    title: "管理",
    items: [
      { href: "/preorders", icon: "package", label: "預購", sub: "已付、待結、運費、預計到貨" },
      { href: "/accounts", icon: "credit-card", label: "帳戶管理", sub: "新增帳戶、餘額、可自由使用的錢" },
      { href: "/categories", icon: "tag", label: "分類管理", sub: "新增、改名、停用" },
      { href: "/recurring", icon: "calendar-clock", label: "固定支出", sub: "房租、訂閱、每月自動提醒" },
      { href: "/budgets", icon: "coins", label: "每月預算", sub: "只是提醒，不會擋記帳" },
    ],
  },
  {
    title: "紀錄",
    items: [
      { href: "/transactions", icon: "transaction", label: "記帳明細與 CSV", sub: "搜尋、篩選、批次整理、匯出備份" },
      { href: "/activity", icon: "bell", label: "最近動態", sub: "活動紀錄：誰改了什麼、另一半做了什麼" },
      { href: "/settle", icon: "settle", label: "結算", sub: "把欠款一次結清" },
      { href: "/goals", icon: "target", label: "共同目標", sub: "要買什麼、幾月幾號之前" },
    ],
  },
];

export default async function MorePage() {
  const { user, ctx } = await getAppContext();
  const invite = ctx.partner
    ? null
    : await prisma.invite.findFirst({
        where: { bookId: ctx.book.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });

  return (
    <>
      <PageHeader title="更多" />
      <div className="px-4">
        <Card className="p-4">
          <AvatarForm name={ctx.me.nickname} email={user.email} color={ctx.me.avatarColor} src={ctx.me.avatarUrl} />
        </Card>

        <SectionTitle>另一半</SectionTitle>
        <Card>
          {ctx.partner ? (
            <div className="flex items-center gap-3">
              <Avatar name={ctx.partner.nickname} color={ctx.partner.avatarColor} src={ctx.partner.avatarUrl} />
              <p className="flex-1 font-medium">{ctx.partner.nickname}</p>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">已綁定</span>
            </div>
          ) : (
            <InviteBox code={invite?.code ?? null} expiresText={invite ? toDateKey(invite.expiresAt).replaceAll("-", "/") : null} />
          )}
        </Card>

        {MENU.map((section) => (
          <div key={section.title}>
            <SectionTitle>{section.title}</SectionTitle>
            <Card className="divide-y divide-line p-0">
              {section.items.map((i) => (
                <ListLink key={i.href} href={i.href} icon={<ArtIcon name={i.icon} size={18} />} sub={i.sub}>{i.label}</ListLink>
              ))}
            </Card>
          </div>
        ))}

        <SectionTitle>帳本設定</SectionTitle>
        <Card>
          <BookSettingsForm name={ctx.book.name} nickname={ctx.me.nickname} />
        </Card>

        <LogoutButton />
      </div>
    </>
  );
}
