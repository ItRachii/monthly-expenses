"use client";

import { useEffect, useState } from "react";

// The Badging API: a number on the installed app's home-screen icon.
// Android Chrome shows it for the installed app; iOS (16.4+) only for an app
// added to the Home Screen, and only once notifications are allowed.
// Web Push (public/sw.js) keeps it current while the app is closed.
type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

function badgeSupported(): boolean {
  return typeof navigator !== "undefined" && "setAppBadge" in navigator;
}

function setBadge(count: number) {
  const nav = navigator as BadgeNavigator;
  if (!nav.setAppBadge) return;
  // Rejects when the platform refuses (e.g. iOS without notification
  // permission); the in-app count still shows, so there is nothing to do.
  const done = count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.();
  done?.catch(() => {});
}

/** Turns a VAPID public key (base64url) into the bytes subscribe() wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/**
 * This device's push subscription, made if needed, saved for the signed-in
 * user. Only once notifications are allowed; never asks by itself.
 */
async function syncPush(vapidKey: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) }));
    await fetch("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  } catch {
    // Push service unreachable or refused: the in-app list still has everything.
  }
}

/**
 * Keeps the icon badge on the unread count. The layout passes the count it
 * rendered (so marking things read updates it on the next refresh), and
 * whenever the app comes back to the foreground it asks the server again.
 * While the app is closed, pushes set it instead. Also keeps this device's
 * push subscription saved for whoever is signed in.
 */
export function AppBadge({ unreadCount, vapidKey }: { unreadCount: number; vapidKey: string | null }) {
  useEffect(() => {
    if (badgeSupported()) setBadge(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (vapidKey) void syncPush(vapidKey);
  }, [vapidKey]);

  useEffect(() => {
    if (!badgeSupported()) return;
    const check = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const res = await fetch("/api/unread-count", { cache: "no-store", headers: { accept: "application/json" } });
        // A redirect means the session ended (middleware sent us to /login).
        if (!res.ok || res.redirected) return;
        const body = (await res.json()) as { count?: unknown };
        if (typeof body.count === "number") setBadge(body.count);
      } catch {
        // Offline or transient: the next foreground tries again.
      }
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, []);

  return null;
}

/**
 * Signed out: clears the icon badge and drops this device's push
 * subscription, so the last account's notifications stop arriving here.
 * Signing in again makes a new one (permission is remembered).
 */
export function ClearAppBadge() {
  useEffect(() => {
    if (badgeSupported()) setBadge(0);
    if (!pushSupported()) return;
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => sub?.unsubscribe())
      .catch(() => {});
  }, []);
  return null;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Offers to turn notifications on for this device, until it has been asked.
 * With push set up: group activity arrives as a phone notification and keeps
 * the icon badge current. Without it, where the badge needs notification
 * permission (iOS Home Screen apps), it offers just the badge.
 */
export function NotificationsPrompt({ unreadCount, vapidKey }: { unreadCount: number; vapidKey: string | null }) {
  const [mode, setMode] = useState<"push" | "badge" | null>(null);
  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    if (vapidKey && pushSupported()) setMode("push");
    else if (badgeSupported() && isStandalone()) setMode("badge");
  }, [vapidKey]);
  if (!mode) return null;

  async function allow() {
    try {
      const result = await Notification.requestPermission();
      if (result === "granted") {
        setBadge(unreadCount);
        if (mode === "push" && vapidKey) await syncPush(vapidKey);
      }
    } catch {
      // Older Safari takes a callback instead; the prompt simply does not show.
    }
    setMode(null);
  }

  return (
    <div className="alert-info flex flex-wrap items-center justify-between gap-3">
      <span>
        {mode === "push"
          ? "Get a notification on this device when someone in your groups adds, edits or settles an expense."
          : "Show the unread count on the app icon? Your phone asks to allow notifications for this."}
      </span>
      <button className="btn-secondary" onClick={allow}>Turn on</button>
    </div>
  );
}
