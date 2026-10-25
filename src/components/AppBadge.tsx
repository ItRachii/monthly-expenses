"use client";

import { useEffect, useState } from "react";

// The Badging API: a number on the installed app's home-screen icon.
// Android Chrome shows it for the installed app; iOS (16.4+) only for an app
// added to the Home Screen, and only once notifications are allowed.
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

/**
 * Keeps the icon badge on the unread count. The layout passes the count it
 * rendered (so marking things read updates it on the next refresh), and
 * whenever the app comes back to the foreground it asks the server again,
 * since notifications may have arrived while it was in the background.
 * Without push it cannot update while the app is closed.
 */
export function AppBadge({ unreadCount }: { unreadCount: number }) {
  useEffect(() => {
    if (badgeSupported()) setBadge(unreadCount);
  }, [unreadCount]);

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

/** Clears the icon badge, so a signed-out app shows no count from the last account. */
export function ClearAppBadge() {
  useEffect(() => {
    if (badgeSupported()) setBadge(0);
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
 * Offers to turn the icon badge on where the platform needs notification
 * permission for it (iOS Home Screen apps). Shown only in the installed app,
 * only when the badge is supported and permission has not been asked yet.
 */
export function AppBadgePermission({ unreadCount }: { unreadCount: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(badgeSupported() && "Notification" in window && Notification.permission === "default" && isStandalone());
  }, []);
  if (!show) return null;

  async function allow() {
    try {
      const result = await Notification.requestPermission();
      if (result === "granted") setBadge(unreadCount);
    } catch {
      // Older Safari takes a callback instead; the prompt simply does not show.
    }
    setShow(false);
  }

  return (
    <div className="alert-info flex flex-wrap items-center justify-between gap-3">
      <span>Show the unread count on the app icon? Your phone asks to allow notifications for this.</span>
      <button className="btn-secondary" onClick={allow}>Turn on</button>
    </div>
  );
}
