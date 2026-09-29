"use client";

import { formatINR } from "@/lib/format";
import { SETTLE_EPS, round2, type Shares } from "@/lib/settlementMath";

interface Opt {
  value: string;
  label: string;
}

/** Typed amounts per member key, as strings so partial input survives. */
export type ShareInputs = Record<string, string>;

export function sharesToInputs(shares: Shares | null): ShareInputs {
  if (!shares) return {};
  return Object.fromEntries(Object.entries(shares).map(([k, n]) => [k, String(n)]));
}

/** Parsed, non-zero amounts to send to the server. */
export function sharesFromInputs(values: ShareInputs, members: Opt[]): Shares {
  const out: Shares = {};
  for (const m of members) {
    const n = round2(parseFloat(values[m.value] ?? ""));
    if (n > 0) out[m.value] = n;
  }
  return out;
}

function assigned(values: ShareInputs, members: Opt[]): number {
  return round2(Object.values(sharesFromInputs(values, members)).reduce((s, n) => s + n, 0));
}

/** Why the shares can't be saved yet, or null when they add up. */
export function sharesError(values: ShareInputs, members: Opt[], amount: number): string | null {
  const total = assigned(values, members);
  if (total <= 0) return "Enter how much each person owes.";
  if (Math.abs(total - round2(amount)) > SETTLE_EPS)
    return `Shares add up to ${formatINR(total)} but the expense is ${formatINR(amount)}.`;
  return null;
}

/**
 * Per-person amount inputs for an unequal split, with a running total so it
 * is obvious how much is still unassigned. "Split the rest" spreads what is
 * left evenly over the people with no amount yet.
 */
export function SplitShares({
  members,
  amount,
  values,
  onChange,
}: {
  members: Opt[];
  /** The expense total; NaN while the amount field is empty or invalid. */
  amount: number;
  values: ShareInputs;
  onChange: (next: ShareInputs) => void;
}) {
  const total = assigned(values, members);
  const valid = Number.isFinite(amount) && amount > 0;
  const left = valid ? round2(amount - total) : 0;
  const blanks = members.filter((m) => !(parseFloat(values[m.value] ?? "") > 0));

  function splitRest() {
    if (left <= SETTLE_EPS || blanks.length === 0) return;
    // Whole paise each; the last blank takes the rounding remainder.
    const each = Math.floor((left / blanks.length) * 100) / 100;
    const next = { ...values };
    blanks.forEach((m, i) => {
      next[m.value] = String(i === blanks.length - 1 ? round2(left - each * (blanks.length - 1)) : each);
    });
    onChange(next);
  }

  return (
    <div className="space-y-2 rounded-lg border border-ink/10 p-3">
      {members.map((m) => (
        <div key={m.value} className="flex items-center gap-3">
          <label htmlFor={`share-${m.value}`} className="min-w-0 flex-1 truncate text-sm">
            {m.label}
          </label>
          <input
            id={`share-${m.value}`}
            type="text"
            inputMode="decimal"
            className="input w-28 text-right"
            placeholder="0.00"
            value={values[m.value] ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*\.?\d*$/.test(v)) onChange({ ...values, [m.value]: v });
            }}
          />
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 pt-1 text-xs">
        <span
          className={
            !valid
              ? "text-muted"
              : Math.abs(left) <= SETTLE_EPS
                ? "text-positive"
                : "text-negative"
          }
        >
          {!valid
            ? `${formatINR(total)} assigned`
            : Math.abs(left) <= SETTLE_EPS
              ? `All ${formatINR(amount)} assigned`
              : left > 0
                ? `${formatINR(left)} left to assign`
                : `${formatINR(-left)} over the total`}
        </span>
        {valid && left > SETTLE_EPS && blanks.length > 0 ? (
          <button type="button" className="text-primary hover:underline" onClick={splitRest}>
            Split the rest equally
          </button>
        ) : null}
      </div>
    </div>
  );
}
