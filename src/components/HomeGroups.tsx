"use client";

import Link from "next/link";
import { useState } from "react";
import type { GroupBalance } from "@/lib/balances";
import { formatINR } from "@/lib/format";

// Splitwise-style group cards: net balance headline + per-member lines.
// Settled-up groups collapse behind a toggle so the list stays scannable.

function GroupCard({ g }: { g: GroupBalance }) {
  return (
    <Link
      href={`/g/${encodeURIComponent(g.id)}`}
      className="card block transition hover:border-white/20 hover:bg-white/5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-semibold">{g.name}</span>
        <span className="shrink-0 text-xs text-muted">{g.memberCount} people</span>
      </div>
      <div
        className={`mt-1 text-sm font-medium ${
          g.settled ? "text-muted" : g.net >= 0 ? "text-emerald-400" : "text-orange-400"
        }`}
      >
        {g.settled
          ? "settled up"
          : g.net >= 0
          ? `you are owed ${formatINR(g.net)}`
          : `you owe ${formatINR(Math.abs(g.net))}`}
      </div>
      {g.lines.length > 0 ? (
        <div className="mt-2 space-y-0.5 border-l-2 border-white/10 pl-3">
          {g.lines.map((l) => (
            <p key={`${l.key}-${l.direction}`} className="text-sm text-muted">
              {l.direction === "owes_you" ? (
                <>
                  {l.name} owes you{" "}
                  <span className="text-emerald-400">{formatINR(l.amount)}</span>
                </>
              ) : (
                <>
                  You owe {l.name}{" "}
                  <span className="text-orange-400">{formatINR(l.amount)}</span>
                </>
              )}
            </p>
          ))}
        </div>
      ) : null}
    </Link>
  );
}

export function HomeGroups({ groups }: { groups: GroupBalance[] }) {
  const [showSettled, setShowSettled] = useState(false);
  const active = groups.filter((g) => !g.settled);
  const settled = groups.filter((g) => g.settled);

  return (
    <div className="space-y-3">
      {active.map((g) => (
        <GroupCard key={g.id} g={g} />
      ))}
      {showSettled ? settled.map((g) => <GroupCard key={g.id} g={g} />) : null}
      {settled.length > 0 ? (
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() => setShowSettled((v) => !v)}
        >
          {showSettled
            ? "Hide settled-up groups"
            : `Show ${settled.length} settled-up group${settled.length === 1 ? "" : "s"}`}
        </button>
      ) : null}
      {groups.length === 0 ? (
        <div className="alert-info">
          You&apos;re not in any groups yet.{" "}
          <Link href="/groups" className="underline">
            Create one
          </Link>{" "}
          to split expenses with others.
        </div>
      ) : null}
    </div>
  );
}
