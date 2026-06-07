import { requireUser } from "@/lib/session";
import { getUnreadCount } from "@/lib/notifications";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/SidebarContext";
import { AppMain } from "@/components/AppMain";
import { MobileTopBar } from "@/components/MobileTopBar";
import { MobileBottomNav } from "@/components/MobileBottomNav";

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
    <SidebarProvider>
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* Desktop: left sidebar. Mobile: a top bar (profile + notifications)
            and a bottom tab bar — these handle their own safe-area insets. */}
        <Sidebar name={displayName} image={user.image} unreadCount={unreadCount} />
        <MobileTopBar image={user.image} unreadCount={unreadCount} />
        <AppMain>{children}</AppMain>
        <MobileBottomNav />
      </div>
    </SidebarProvider>
  );
}
