import webpush from "web-push";
import { prisma } from "./prisma";
import { buildPushPayload } from "./pushPayload";

// Web Push to the devices that turned notifications on. Configured by
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT; without them the
// app never offers notifications and nothing is sent.

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return (configured = false);
  try {
    webpush.setVapidDetails(subject, pub, priv);
    configured = true;
  } catch (e) {
    console.error("[push] bad VAPID settings:", e instanceof Error ? e.message : e);
    configured = false;
  }
  return configured;
}

/** The public key devices subscribe with, or null when push is not set up. */
export function vapidPublicKey(): string | null {
  return ensureConfigured() ? process.env.VAPID_PUBLIC_KEY! : null;
}

/**
 * Saves a device for this user. The endpoint belongs to the device, so a
 * device that signs in as someone else moves to them instead of keeping
 * the last account's notifications.
 */
export async function savePushSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string }): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, ...sub },
    update: { userId, p256dh: sub.p256dh, auth: sub.auth },
  });
}

/**
 * Sends one push per device of each recipient: the group, the message, and
 * their unread count for the icon badge. Best-effort, like the in-app
 * notification it follows: failures are logged, devices the push service
 * says are gone are removed, and nothing is thrown.
 */
export async function pushToUsers(params: {
  groupId: string;
  message: string;
  /** Each recipient and where tapping their notification goes. */
  recipients: { userId: string; url: string }[];
}): Promise<void> {
  if (params.recipients.length === 0 || !ensureConfigured()) return;
  try {
    const urlOf = new Map(params.recipients.map((r) => [r.userId, r.url]));
    const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: [...urlOf.keys()] } } });
    if (subs.length === 0) return;
    const userIds = [...new Set(subs.map((s) => s.userId))];
    const [group, counts] = await Promise.all([
      prisma.group.findUnique({ where: { id: params.groupId }, select: { name: true } }),
      prisma.notification.groupBy({
        by: ["recipientEmail"],
        where: { recipientEmail: { in: userIds }, isRead: false },
        _count: { _all: true },
      }),
    ]);
    const unreadOf = new Map(counts.map((c) => [c.recipientEmail, c._count._all]));
    const gone: bigint[] = [];
    await Promise.all(
      subs.map(async (s) => {
        const payload = buildPushPayload({
          groupId: params.groupId,
          groupName: group?.name ?? "",
          message: params.message,
          url: urlOf.get(s.userId) ?? "/notifications",
          unread: unreadOf.get(s.userId) ?? 0,
        });
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { TTL: 60 * 60 * 24, timeout: 5000 },
          );
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(s.id);
          else console.error("[push] send failed:", status ?? (e instanceof Error ? e.message : e));
        }
      }),
    );
    if (gone.length > 0) await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
  } catch (e) {
    // No table yet (db/2026_10_push_subscriptions.sql not run) or a transient error.
    console.error("[push] skipped:", e instanceof Error ? e.message : e);
  }
}
