import { requireUser } from "@/lib/session";
import { getNotifications } from "@/lib/notifications";
import { NotificationList } from "./NotificationList";

// Activity for the signed-in user only; always fresh.
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser();
  const notifications = await getNotifications(user.email);

  return (
    <div className="space-y-6">
      <h1>Notifications</h1>
      <NotificationList notifications={notifications} />
    </div>
  );
}
