import type { BalanceLine } from "@/lib/balances";
import { SETTLE_EPS } from "@/lib/settlementMath";
import { formatINR } from "@/lib/format";

// One look for "where do I stand" everywhere: the home group cards and the
// group page hero render these same pieces, so the two screens never drift.

/** Headline: You owe / You are owed <amount> overall, or settled up. */
export function BalanceHeadline({ net }: { net: number }) {
  if (net > SETTLE_EPS) {
    return (
      <span className="text-sm font-medium">
        You are owed <span className="text-emerald-400">{formatINR(net)}</span> overall
      </span>
    );
  }
  if (net < -SETTLE_EPS) {
    return (
      <span className="text-sm font-medium">
        You owe <span className="text-red-400">{formatINR(Math.abs(net))}</span> overall
      </span>
    );
  }
  return <span className="text-sm font-medium text-muted">You are settled up</span>;
}

/** Per-person lines under the headline. Renders nothing when empty. */
export function BalanceLines({ lines }: { lines: BalanceLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="space-y-0.5 border-l-2 border-white/10 pl-3">
      {lines.map((l) => (
        <p key={`${l.key}-${l.direction}`} className="text-sm text-muted">
          {l.direction === "owes_you" ? (
            <>
              {l.name} owes you{" "}
              <span className="text-emerald-400">{formatINR(l.amount)}</span>
            </>
          ) : (
            <>
              You owe {l.name}{" "}
              <span className="text-red-400">{formatINR(l.amount)}</span>
            </>
          )}
        </p>
      ))}
    </div>
  );
}
