import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline — Ledger" };

// Shown by the service worker when a navigation happens with no connection.
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-5xl">📡</div>
      <h1 className="text-2xl font-bold">You&apos;re offline</h1>
      <p className="max-w-sm text-muted">
        Ledger needs a connection to load your expenses. Reconnect and try
        again — your data is safe.
      </p>
    </div>
  );
}
