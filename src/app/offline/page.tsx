import type { Metadata } from "next";
import { WifiOffIcon } from "@/components/Icons";

export const metadata: Metadata = { title: "Offline — Ledger" };

// Shown by the service worker when a navigation happens with no connection.
export default function OfflinePage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <WifiOffIcon className="h-12 w-12 text-muted" />
      <h1 className="text-2xl font-bold">You&apos;re offline</h1>
      <p className="max-w-sm text-muted">
        This page hasn&apos;t been loaded on this device yet. Pages you&apos;ve
        visited recently — like <strong>Add Expense</strong> — still work
        offline, and expenses you add there are kept on this device and synced
        automatically when you reconnect.
      </p>
    </div>
  );
}
