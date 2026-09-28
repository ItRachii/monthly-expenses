"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCardAction, deleteCardStatementAction } from "@/lib/actions/cards";
import type { CardView } from "@/lib/cards";
import { TrashIcon } from "@/components/Icons";
import { formatINR } from "@/lib/format";

function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

function dayLabel(iso: string | null): string {
  if (!iso) return "n/a";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

const money = (n: number | null) => (n === null ? "n/a" : formatINR(n));

/** The user's cards with every statement summary saved so far. */
export function CardsPanel({ cards }: { cards: CardView[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="section-title">Your cards</h2>
      {cards.map((c) => (
        <CardBlock key={c.id} card={c} />
      ))}
    </section>
  );
}

function CardBlock({ card }: { card: CardView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = card.statements[0];

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      router.refresh();
    });
  }

  return (
    <details className="card">
      <summary className="cursor-pointer select-none">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-semibold">
            {card.bank} •••• {card.last4}
          </span>
          {card.product ? <span className="pill">{card.product}</span> : null}
          <span className="text-sm text-muted">
            {card.statements.length} statement{card.statements.length === 1 ? "" : "s"}
          </span>
          {latest?.totalDue !== null && latest?.totalDue !== undefined ? (
            <span className="text-sm text-muted">
              Latest due {formatINR(latest.totalDue)}
              {latest.dueDate ? ` by ${dayLabel(latest.dueDate)}` : ""}
            </span>
          ) : null}
        </div>
      </summary>

      <div className="mt-3 space-y-3">
        {error ? <div className="alert-error">{error}</div> : null}
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Total due</th>
                <th className="text-right">Min due</th>
                <th>Due date</th>
                <th className="text-right">Purchases</th>
                <th className="text-right">Payments</th>
                <th className="text-right">Available</th>
                <th className="text-right">Limit</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {card.statements.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap font-medium">{monthLabel(s.period)}</td>
                  <td className="whitespace-nowrap text-right font-semibold">{money(s.totalDue)}</td>
                  <td className="whitespace-nowrap text-right">{money(s.minimumDue)}</td>
                  <td className="whitespace-nowrap">{dayLabel(s.dueDate)}</td>
                  <td className="whitespace-nowrap text-right">{money(s.purchases)}</td>
                  <td className="whitespace-nowrap text-right">{money(s.paymentsCredits)}</td>
                  <td className="whitespace-nowrap text-right">{money(s.availableCredit)}</td>
                  <td className="whitespace-nowrap text-right">{money(s.creditLimit)}</td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn text-red-400 hover:text-red-300"
                      disabled={pending}
                      aria-label={`Delete ${monthLabel(s.period)} statement`}
                      title="Delete statement"
                      onClick={() => run(() => deleteCardStatementAction(s.id))}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!confirm ? (
          <button type="button" className="btn-danger px-3 py-1 text-xs" onClick={() => setConfirm(true)}>
            Remove card
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Remove this card and all its saved statements?</span>
            <button type="button" className="btn-danger px-3 py-1 text-xs" disabled={pending} onClick={() => run(() => deleteCardAction(card.id))}>
              Yes, remove
            </button>
            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
