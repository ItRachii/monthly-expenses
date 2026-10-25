// Service worker: install, offline support and push notifications.
//
// - Static assets (hashed build files, icons, fonts): cache-first.
// - Page navigations: network-first, falling back to the last cached copy of
//   that page, then to /offline. This keeps recently visited pages (e.g.
//   /add) usable with no connection; queued offline expenses are handled by
//   the in-page queue, not by the service worker.
// - Privacy: cached pages contain only PII-masked payloads (opaque member
//   keys + display names). The whole page cache is dropped as soon as a
//   navigation comes back redirected to /login (i.e. the session ended), so
//   one account's pages don't linger for the next sign-in on this browser.
// - Push: shows the group notification and sets the icon badge to the
//   unread count the server sent (src/lib/pushPayload.ts is the shape).
const STATIC_CACHE = "ledger-static-v2";
const PAGE_CACHE = "ledger-pages-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = [STATIC_CACHE, PAGE_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

async function handleNavigation(request) {
  try {
    const res = await fetch(request);
    const path = new URL(request.url).pathname;
    if (res.redirected && new URL(res.url).pathname === "/login") {
      // Signed out (or session expired): purge cached personalized pages.
      await caches.delete(PAGE_CACHE);
      return res;
    }
    if (res.ok && !res.redirected && path !== "/login" && path !== OFFLINE_URL) {
      const copy = res.clone();
      caches
        .open(PAGE_CACHE)
        .then((cache) => cache.put(request, copy))
        .catch(() => {});
    }
    return res;
  } catch {
    // Offline. Ignore the Next.js `Vary: rsc, next-router-…` header (and any
    // query string) when looking up the cached page — otherwise an online-
    // cached/warmed page never matches the offline navigation request, and
    // every offline navigation falls through to the generic offline page.
    const cached = await caches.match(request, {
      cacheName: PAGE_CACHE,
      ignoreVary: true,
      ignoreSearch: true,
    });
    return cached || caches.match(OFFLINE_URL, { ignoreVary: true });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations: network-first with per-page offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Build assets, icons, fonts: cache-first (these are content-hashed / static).
  if (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
  }
});

// A push from the server: show it, and put the unread count on the icon.
// iOS revokes push for a site whose pushes show nothing, so every push
// shows a notification.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Ledger";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/notifications";
  const badge = Number.isInteger(data.badge) ? data.badge : null;
  const shown = self.registration.showNotification(title, {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/icon-192.png",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    renotify: typeof data.tag === "string",
    data: { url },
  });
  const badged =
    badge !== null && "setAppBadge" in self.navigator
      ? (badge > 0 ? self.navigator.setAppBadge(badge) : self.navigator.clearAppBadge()).catch(() => {})
      : Promise.resolve();
  event.waitUntil(Promise.all([shown, badged]));
});

// Tapping a notification opens its record, in the app's window when one is open.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/notifications", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus().then((w) => (w || open).navigate(url));
      return self.clients.openWindow(url);
    }),
  );
});
