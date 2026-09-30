"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CardView } from "@/lib/cards";
import { CalendarIcon, CreditCardIcon } from "@/components/Icons";
import { formatINR, monthLabel } from "@/lib/format";
import { tableDate } from "@/components/table/Table";

const ALL = "all";
const money = (n: number | null) => (n === null ? "n/a" : formatINR(n));

// The Statements tab of the Personal page: every card's saved statement
// summaries, with a chip per card to look at just one and a month picker.
// Importing and deleting stay on the Statements page.
export function CardStatements({ cards }: { cards: CardView[] }) {
  const [cardId, setCardId] = useState<string>(ALL);
  const [month, setMonth] = useState<string>(ALL);

  const shownCards = cards.filter((c) => cardId === ALL || c.id === cardId);
  // Months across the cards on show, newest first.
  const months = useMemo(
    () => Array.from(new Set(shownCards.flatMap((c) => c.statements.map((s) => s.period)))).sort((a, b) => b.localeCompare(a)),
    [shownCards],
  );
  const monthOk = month === ALL || months.includes(month) ? month : ALL;
  const statementsOf = (c: CardView) => c.statements.filter((s) => monthOk === ALL || s.period === monthOk);
  const total = shownCards.reduce((n, c) => n + statementsOf(c).length, 0);

  if (cards.length === 0) {
    return (
      <div className="alert-info">
        No card statements yet.{" "}
        <Link href="/statements" className="font-semibold underline">
          Import one
        </Link>{" "}
        and its summary is filed under the card here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters: one chip per card, and the month. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Cards">
          <button
            type="button"
            aria-pressed={cardId === ALL}
            className={`chip-btn ${cardId === ALL ? "border-primary/40 bg-primary/10" : ""}`}
            onClick={() => setCardId(ALL)}
          >
            All cards
          </button>
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={cardId === c.id}
              className={`chip-btn ${cardId === c.id ? "border-primary/40 bg-primary/10" : ""}`}
              onClick={() => setCardId(cardId === c.id ? ALL : c.id)}
            >
              <CreditCardIcon className="h-4 w-4 text-muted" />
              {c.bank} •••• {c.last4}
            </button>
          ))}
        </div>
        <label className="relative shrink-0 sm:ml-auto">
          <span className="sr-only">Month</span>
          <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted sm:block" />
          <select className="select w-auto py-2 pl-3 pr-8 sm:pl-9" value={monthOk} onChange={(e) => setMonth(e.target.value)}>
            <option value={ALL}>All months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {total === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No statements for {monthLabel(monthOk)}.</p>
      ) : (
        shownCards.map((c) => {
          const rows = statementsOf(c);
          if (rows.length === 0) return null;
          const latest = c.statements[0];
          return (
            <section key={c.id} className="card space-y-3 p-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-4">
                <span className="font-semibold">
                  {c.bank} •••• {c.last4}
                </span>
                {c.product ? <span className="pill">{c.product}</span> : null}
                <span className="text-sm text-muted">
                  {c.statements.length} statement{c.statements.length === 1 ? "" : "s"}
                </span>
                {latest?.totalDue !== null && latest?.totalDue !== undefined ? (
                  <span className="text-sm text-muted">
                    Latest due {formatINR(latest.totalDue)}
                    {latest.dueDate ? ` by ${tableDate(latest.dueDate)}` : ""}
                  </span>
                ) : null}
              </div>

              {/* Phones: one row per statement. */}
              <ul className="divide-y divide-ink/5 md:hidden">
                {rows.map((s) => (
                  <li key={s.id} className="space-y-0.5 px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">{monthLabel(s.period)}</span>
                      <span className="text-sm font-semibold tabular-nums">{money(s.totalDue)}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {s.dueDate ? `Due ${tableDate(s.dueDate)}` : "No due date"} · Min {money(s.minimumDue)}
                    </div>
                    <div className="text-xs text-muted">
                      Purchases {money(s.purchases)} · Payments {money(s.paymentsCredits)}
                    </div>
                  </li>
                ))}
              </ul>

              {/* Desktop: the table. */}
              <div className="hidden overflow-x-auto md:block">
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
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id}>
                        <td className="whitespace-nowrap font-medium">{monthLabel(s.period)}</td>
                        <td className="whitespace-nowrap text-right font-semibold tabular-nums">{money(s.totalDue)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{money(s.minimumDue)}</td>
                        <td className="whitespace-nowrap">{s.dueDate ? tableDate(s.dueDate) : "n/a"}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{money(s.purchases)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{money(s.paymentsCredits)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{money(s.availableCredit)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{money(s.creditLimit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      <p className="text-xs text-muted">
        Import a new statement, or remove a card, on the{" "}
        <Link href="/statements" className="text-primary hover:underline">
          Statements page
        </Link>
        .
      </p>
    </div>
  );
}
