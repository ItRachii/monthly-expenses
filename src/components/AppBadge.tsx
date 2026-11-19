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
 * user. Only once notifications are allowed; never asks by itself. Resolves
 * true when the server has it.
 */
async function syncPush(vapidKey: string): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    // Register here too rather than waiting on serviceWorker.ready, which
    // never settles while no service worker is registered.
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
    if (!reg.active) await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) }));
    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return res.ok;
  } catch {
    // Push service unreachable or refused: the in-app list still has everything.
    return false;
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

  // Unless push was turned off on this device.
  useEffect(() => {
    if (vapidKey && !pushTurnedOff()) void syncPush(vapidKey);
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

// "Off" is remembered on the device, so the app does not sign it up again by
// itself. Push is on by default once notifications are allowed.
const OFF_KEY = "ledger.pushOff";
const pushTurnedOff = () => {
  try {
    return window.localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
};
const rememberPushOff = (off: boolean) => {
  try {
    if (off) window.localStorage.setItem(OFF_KEY, "1");
    else window.localStorage.removeItem(OFF_KEY);
  } catch {
    // Storage unavailable: the app may sign this device up again next time.
  }
};

/** This device's subscription, if it has one. */
async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

type PushState = "loading" | "on" | "off" | "blocked" | "unsupported" | "unavailable";

/**
 * The Profile page's switch for push notifications on this device. On asks
 * the phone for permission if needed and signs the device up; off removes it
 * here and on the server. Blocked in the phone's settings, it says where to
 * change that.
 */
export function PushToggle({ vapidKey }: { vapidKey: string | null }) {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      let next: PushState;
      if (!vapidKey) next = "unavailable";
      else if (!pushSupported()) next = "unsupported";
      else if (Notification.permission === "denied") next = "blocked";
      // Allowed and not turned off: the app signs this device up as it opens,
      // so finish that here rather than read a subscription not made yet.
      else next = Notification.permission === "granted" && !pushTurnedOff() && (await syncPush(vapidKey)) ? "on" : "off";
      if (live) setState(next);
    })();
    return () => {
      live = false;
    };
  }, [vapidKey]);

  async function turnOn() {
    if (!vapidKey) return;
    let permission = Notification.permission;
    if (permission === "default") {
      try {
        permission = await Notification.requestPermission();
      } catch {
        // Older Safari takes a callback instead; treated as not allowed.
      }
    }
    if (permission === "denied") return setState("blocked");
    if (permission !== "granted") return;
    rememberPushOff(false);
    if (await syncPush(vapidKey)) setState("on");
    else setError("This device could not be signed up for notifications. Check your connection and try again.");
  }

  async function turnOff() {
    rememberPushOff(true);
    const sub = await currentSubscription();
    if (sub) {
      await fetch("/api/push", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe().catch(() => false);
    }
    setState("off");
  }

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await (state === "on" ? turnOff() : turnOn());
    } finally {
      setBusy(false);
    }
  }

  const on = state === "on";
  const usable = state === "on" || state === "off";
  const note =
    state === "blocked"
      ? "Notifications are blocked for this app. Allow them in your phone's settings for this app, then come back here."
      : state === "unsupported"
        ? "This browser can't receive notifications. On iPhone, add the app to your Home Screen first."
        : state === "unavailable"
          ? "Notifications aren't set up on this server."
          : "When someone in your groups adds, edits or settles an expense. Applies to this device only.";

  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="push-toggle-label" className="section-title">
            Push notifications
          </h2>
          <p className="text-sm text-muted">{note}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="push-toggle-label"
          disabled={!usable || busy}
          onClick={toggle}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${on ? "bg-primary" : "bg-ink/20"}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
          <span className="sr-only">{on ? "On" : "Off"}</span>
        </button>
      </div>
      {error ? (
        <div className="alert-error" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
