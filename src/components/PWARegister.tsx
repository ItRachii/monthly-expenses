"use client";

import { useEffect } from "react";

// Must match PAGE_CACHE in public/sw.js — the cache the SW serves offline
// navigations from.
const PAGE_CACHE = "ledger-pages-v1";

// Pages we want usable with no connection. The App Router navigates via RSC
// fetches (not document loads), so the service worker never sees a cacheable
// navigation for these just from in-app link clicks. We warm them here by
// fetching the real (authenticated) document while online and storing it in the
// same cache the SW reads, so an offline visit to /add actually opens the form.
const WARM_PATHS = ["/", "/add"];

async function warmOfflinePages() {
  if (typeof window === "undefined") return;
  if (!("caches" in window) || !navigator.onLine) return;
  try {
    const cache = await caches.open(PAGE_CACHE);
    await Promise.all(
      WARM_PATHS.map(async (path) => {
        try {
          // Same-origin fetch → sends the session cookie → real page HTML.
          // Skip redirects so a signed-out /login response is never stored.
          const res = await fetch(path, { credentials: "same-origin" });
          if (res.ok && !res.redirected) await cache.put(path, res.clone());
        } catch {
          // Offline or transient — nothing to warm.
        }
      }),
    );
  } catch {
    // CacheStorage unavailable (e.g. private mode) — offline shell just won't warm.
  }
}

// Registers the service worker (production only — avoids dev caching surprises)
// and keeps the offline page cache warm.
export function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      void warmOfflinePages();
    };
    const onOnline = () => void warmOfflinePages();
    window.addEventListener("load", onLoad);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("load", onLoad);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return null;
}
