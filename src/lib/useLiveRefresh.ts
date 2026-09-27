"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a context's screen current without reloading it. Every `intervalMs`
 * while the tab is visible and online (and whenever it becomes visible
 * again) it fetches a tiny version fingerprint; only when that changes does
 * it call router.refresh(), which re-renders the server data in place and
 * keeps client state (open tabs, scroll, expanded months).
 */
export function useLiveRefresh(ctx: string, intervalMs = 15000) {
  const router = useRouter();
  const last = useRef<string | null>(null);

  useEffect(() => {
    last.current = null;
    let inFlight = false;

    const check = async () => {
      if (inFlight || document.visibilityState !== "visible" || !navigator.onLine) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/ctx-version?ctx=${encodeURIComponent(ctx)}`, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        // A redirect means the session ended (middleware sent us to /login).
        if (!res.ok || res.redirected) return;
        const body = (await res.json()) as { version?: unknown };
        if (typeof body.version !== "string") return;
        if (last.current !== null && body.version !== last.current) router.refresh();
        last.current = body.version;
      } catch {
        // Offline or transient: try again on the next tick.
      } finally {
        inFlight = false;
      }
    };

    void check();
    const timer = window.setInterval(check, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [ctx, intervalMs, router]);
}
