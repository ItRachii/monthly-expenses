import { requireUser } from "@/lib/session";
import { getNotifications, getUnreadCount } from "@/lib/notifications";
import { NotificationList } from "./NotificationList";
import { AppBadgePermission } from "@/components/AppBadge";

// Activity for the signed-in user only; always fresh.
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser();
  const [notifications, unreadCount] = await Promise.all([getNotifications(user.email), getUnreadCount(user.email)]);

  return (
    <div className="space-y-6">
      <h1>Notifications</h1>
      <AppBadgePermission unreadCount={unreadCount} />
      <NotificationList notifications={notifications} renderedAt={Date.now()} />
    </div>
  );
}
