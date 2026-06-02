import { requireUser } from "@/lib/session";
import { getUnreadCount } from "@/lib/notifications";
import { Sidebar } from "@/components/Sidebar";

// Every page in this group depends on the signed-in user, so never prerender.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const displayName =
    user.appUser?.username?.trim() ||
    user.appUser?.firstName ||
    user.name ||
    user.email;
  const unreadCount = await getUnreadCount(user.email);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar name={displayName} image={user.image} unreadCount={unreadCount} />
      <main className="flex-1 overflow-x-hidden p-5 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">{children}</div>
      </main>
    </div>
  );
}
