import { requireUser } from "@/lib/session";
import { getUnreadCount } from "@/lib/notifications";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/SidebarContext";
import { AppMain } from "@/components/AppMain";

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
      {/* Pad by the device safe-area insets so the app sits clear of notches
          and the home indicator in standalone (PWA) mode. */}
      <div className="flex min-h-screen flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:flex-row">
        <Sidebar name={displayName} image={user.image} unreadCount={unreadCount} />
        <AppMain>{children}</AppMain>
      </div>
    </SidebarProvider>
  );
}
