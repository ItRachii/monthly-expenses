"use client";

import Link from "next/link";
import { useState } from "react";
import type { GroupBalance } from "@/lib/balances";
import { BalanceHeadline, BalanceLines } from "./BalanceSummary";

// Splitwise-style group cards: net balance headline + per-member lines.
// Settled-up groups collapse behind a toggle so the list stays scannable.

function GroupCard({ g }: { g: GroupBalance }) {
  return (
    <Link
      href={`/g/${encodeURIComponent(g.id)}`}
      className="card block transition hover:border-white/20 hover:bg-white/5"
    >
      <div className="truncate text-lg font-semibold">{g.name}</div>
      <div className="mt-2">
        <BalanceHeadline net={g.settled ? 0 : g.net} />
      </div>
      <div className="mt-2">
        <BalanceLines lines={g.lines} />
      </div>
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
