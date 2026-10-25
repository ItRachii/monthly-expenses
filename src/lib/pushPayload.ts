// What a push carries to the service worker (public/sw.js reads the same
// shape). Kept free of server imports so tests can check it directly.

export interface PushPayload {
  /** The notification's heading: the group it happened in. */
  title: string;
  /** What happened, as the in-app notification says it. */
  body: string;
  /** Where tapping it goes. */
  url: string;
  /** The recipient's unread count, for the home-screen icon badge. */
  badge: number;
  /** Notifications from the same group replace each other instead of piling up. */
  tag: string;
}

// Push services cap payloads near 4 KB; a message is short, but a long
// item name should not make the push fail.
const MAX_BODY = 240;

export function buildPushPayload(p: { groupId: string; groupName: string; message: string; url: string; unread: number }): PushPayload {
  const body = p.message.length > MAX_BODY ? `${p.message.slice(0, MAX_BODY - 1)}…` : p.message;
  return {
    title: p.groupName || "Ledger",
    body,
    url: p.url.startsWith("/") ? p.url : "/notifications",
    badge: Math.max(0, Math.floor(p.unread)),
    tag: `group-${p.groupId}`,
  };
}

/** A subscription as the browser hands it over, or null when it is not one. */
export function parseSubscription(raw: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof s.endpoint !== "string" || !/^https:\/\/[^\s]{1,2000}$/.test(s.endpoint)) return null;
  const p256dh = s.keys?.p256dh;
  const auth = s.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (!/^[A-Za-z0-9_-]{20,200}={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]{10,100}={0,2}$/.test(auth)) return null;
  return { endpoint: s.endpoint, p256dh, auth };
}
