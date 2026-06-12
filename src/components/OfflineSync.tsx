"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addExpenseAction } from "@/lib/actions/expenses";
import {
  dismissFailed,
  flushQueue,
  listFailed,
  listQueued,
  subscribeQueue,
  type FailedExpense,
} from "@/lib/offlineQueue";

/**
 * Mounted once in the authenticated layout. Watches the offline expense queue
 * and replays it through addExpenseAction when the app (re)gains connectivity,
 * showing a small status banner while anything is pending or has failed.
 * `ownerTag` is the opaque per-user token queue items are scoped to.
 */
export function OfflineSync({ ownerTag }: { ownerTag: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<FailedExpense[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);

  const refresh = useCallback(() => {
    setPending(listQueued(ownerTag).length);
    setFailed(listFailed(ownerTag));
  }, [ownerTag]);

  const sync = useCallback(async () => {
    if (!navigator.onLine || listQueued(ownerTag).length === 0) return;
    setSyncing(true);
    try {
      const res = await flushQueue(ownerTag, (q) =>
        addExpenseAction({
          ctx: q.ctx,
          date: q.date,
          category: q.category,
          item: q.item,
          amount: q.amount,
          payer: q.payer,
          split: q.split,
        }),
      );
      if (res.synced > 0) router.refresh();
    } finally {
      setSyncing(false);
      refresh();
    }
  }, [ownerTag, router, refresh]);

  useEffect(() => {
    refresh();
    setOnline(navigator.onLine);
    const onOnline = () => {
      setOnline(true);
      void sync();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const unsubscribe = subscribeQueue(refresh);
    // Pick up anything left over from a previous session or another page.
    void sync();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      unsubscribe();
    };
  }, [refresh, sync]);

  if (pending === 0 && failed.length === 0) return null;

  const n = pending;
  const plural = n === 1 ? "" : "s";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6">
      <div className="pointer-events-auto card w-full max-w-md space-y-2 px-4 py-3 text-sm shadow-xl">
        {n > 0 ? (
          <div className="flex items-center gap-3">
            <span aria-hidden>{syncing ? "🔄" : online ? "⏳" : "📴"}</span>
            <span className="flex-1">
              {syncing
                ? `Syncing ${n} offline expense${plural}…`
                : online
                  ? `${n} offline expense${plural} waiting to sync.`
                  : `${n} expense${plural} saved offline — will sync when you're back online.`}
            </span>
            {online && !syncing ? (
              <button
                className="btn-secondary shrink-0 px-2 py-1 text-xs"
                onClick={() => void sync()}
              >
                Sync now
              </button>
            ) : null}
          </div>
        ) : null}
        {failed.map((f) => (
          <div key={f.id} className="flex items-center gap-3">
            <span aria-hidden>⚠️</span>
            <span className="flex-1 text-red-300">
              Couldn&apos;t sync &quot;{f.item}&quot; — {f.error}
            </span>
            <button
              className="shrink-0 text-xs text-muted hover:text-ink"
              onClick={() => dismissFailed(ownerTag, f.id)}
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
