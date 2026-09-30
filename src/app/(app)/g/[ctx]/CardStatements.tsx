"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CardStatementView, CardView, StatementExpenseView } from "@/lib/cards";
import type { LoanView } from "@/lib/loans";
import { deleteCardAction, deleteCardStatementAction } from "@/lib/actions/cards";
import { AlertTriangleIcon, CalendarIcon, CreditCardIcon } from "@/components/Icons";
import { PendingFlagNote } from "@/components/PendingFlag";
import { LoansPanel } from "@/components/LoansPanel";
import { DateBadge } from "@/components/DateBadge";
import { formatINR, monthLabel } from "@/lib/format";
import { tableDate } from "@/components/table/Table";

const ALL = "all";
const money = (n: number | null) => (n === null ? "n/a" : formatINR(n));

// The Statements tab of the Personal page: every card, its statements, and
// under each statement the expenses imported from it (with the group they
// went to, if any), then the EMIs on record. A chip per card narrows the
// view to one; a month picker narrows to one statement month. This is also
// where statements and cards are removed; importing stays on /statements.
export function CardStatements({ cards, loans }: { cards: CardView[]; loans: LoanView[] }) {
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

  if (cards.length === 0 && loans.length === 0) {
    return (
      <div className="alert-info">
        No card statements yet.{" "}
        <Link href="/statements" className="font-semibold underline">
          Import one
        </Link>{" "}
        and it is filed under its card here, with the expenses you add from it.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {cards.length > 0 ? (
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
              return rows.length === 0 ? null : <CardBlock key={c.id} card={c} statements={rows} />;
            })
          )}
        </div>
      ) : null}

      <LoansPanel loans={loans} />

      <p className="text-xs text-muted">
        Import a statement on the{" "}
        <Link href="/statements" className="text-primary hover:underline">
          Statements page
        </Link>
        . Its summary and the expenses you add from it appear here.
      </p>
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      router.refresh();
    });
  };
  return { pending, error, run };
}

function CardBlock({ card, statements }: { card: CardView; statements: CardStatementView[] }) {
  const { pending, error, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const latest = card.statements[0];
  const withDue = card.statements.find((s) => s.totalDue !== null);
  return (
    <section className="card space-y-3" data-card={card.last4}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">
          {card.bank} •••• {card.last4}
        </span>
        {card.product ? <span className="pill">{card.product}</span> : null}
        <span className="text-sm text-muted">
          {card.statements.length} statement{card.statements.length === 1 ? "" : "s"}
        </span>
        {withDue && withDue === latest ? (
          <span className="text-sm text-muted">
            Latest due {formatINR(latest.totalDue!)}
            {latest.dueDate ? ` by ${tableDate(latest.dueDate)}` : ""}
          </span>
        ) : null}
      </div>
      {error ? <div className="alert-error">{error}</div> : null}
      <div className="space-y-2">
        {statements.map((s) => (
          <StatementBlock key={s.id} statement={s} pending={pending} onDelete={() => run(() => deleteCardStatementAction(s.id))} />
        ))}
      </div>
      {!confirm ? (
        <button type="button" className="text-xs text-negative hover:underline" onClick={() => setConfirm(true)}>
          Remove this card
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Remove this card and its saved statements? Expenses added from them stay.</span>
          <button type="button" className="btn-danger px-3 py-1.5 text-xs" disabled={pending} onClick={() => run(() => deleteCardAction(card.id))}>
            Yes, remove
          </button>
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

/** One statement: the summary line, then its figures and the expenses added from it. */
function StatementBlock({ statement: s, pending, onDelete }: { statement: CardStatementView; pending: boolean; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const n = s.expenses.length;
  const added = s.expenses.reduce((sum, e) => sum + e.amount, 0);
  const figures: [string, string][] = [
    ["Minimum due", money(s.minimumDue)],
    ["Purchases", money(s.purchases)],
    ["Payments", money(s.paymentsCredits)],
    ["Available", money(s.availableCredit)],
    ["Credit limit", money(s.creditLimit)],
    ["Statement date", s.statementDate ? tableDate(s.statementDate) : "n/a"],
  ];
  return (
    <details className="group rounded-lg border border-ink/10" data-statement={s.period}>
      <summary className="-my-2 flex min-h-11 cursor-pointer select-none flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-4 text-sm">
        <span className="font-medium">{monthLabel(s.period)}</span>
        {s.figuresMissing ? (
          <span className="pill">No summary figures</span>
        ) : (
          <>
            <span className="font-semibold tabular-nums">{money(s.totalDue)}</span>
            <span className="text-muted">{s.dueDate ? `due ${tableDate(s.dueDate)}` : "no due date"}</span>
          </>
        )}
        <span className="ml-auto text-muted">
          {n === 0 ? "No expenses added" : `${n} expense${n === 1 ? "" : "s"} · ${formatINR(added)}`}
        </span>
      </summary>
      <div className="space-y-3 border-t border-ink/10 px-3 py-3">
        {s.figuresMissing ? (
          <p className="text-xs text-muted">This file carried no dues, limits or due date. ICICI&rsquo;s CSV export leaves them out; the PDF statement has them.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {figures.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* The expenses added from this statement, and where each went. */}
        {n === 0 ? (
          <p className="text-sm text-muted">No expenses were added from this statement.</p>
        ) : (
          <ul className="divide-y divide-ink/5 rounded-lg border border-ink/10">
            {s.expenses.map((e) => (
              <StatementExpenseRow key={e.id} expense={e} />
            ))}
          </ul>
        )}

        {!confirm ? (
          <button type="button" className="text-xs text-negative hover:underline" onClick={() => setConfirm(true)}>
            Remove this statement
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Remove the {monthLabel(s.period)} statement? Its expenses stay.</span>
            <button type="button" className="btn-danger px-3 py-1.5 text-xs" disabled={pending} onClick={onDelete}>
              Yes, remove
            </button>
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

const shortMonth = (ym: string) => new Date(`${ym}-01T00:00:00.000Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

/**
 * One imported expense. A GST charge whose instalment is not on record yet
 * carries a pill naming the statement to import; tapping it shows why.
 */
function StatementExpenseRow({ expense: e }: { expense: StatementExpenseView }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2" data-expense={e.id}>
      <div className="flex items-center gap-3">
        <DateBadge iso={e.date} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{e.item}</div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <span className="truncate">{e.category || "Uncategorised"}</span>
            {e.group ? (
              <Link href={`/g/${encodeURIComponent(e.group.id)}`} className="pill shrink-0 hover:text-ink" title={`Added to the group ${e.group.name}`}>
                {e.group.name}
              </Link>
            ) : (
              <span className="shrink-0">· Personal</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-sm font-semibold tabular-nums">{formatINR(e.amount)}</div>
      </div>
      {/* Its own line, lined up with the item, full width on phones so it stays one line. */}
      {e.gstPending ? (
        <div className="sm:pl-12">
          <button
            type="button"
            className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-left text-xs font-medium text-warning hover:bg-amber-500/15"
            title={e.gstPending.reason}
            aria-expanded={open}
            data-gst-pending
            onClick={() => setOpen((o) => !o)}
          >
            <AlertTriangleIcon className="h-3 w-3 shrink-0" />
            <span>GST pending: import {shortMonth(e.gstPending.month)} statement</span>
          </button>
          {open ? <PendingFlagNote reason={e.gstPending.reason} /> : null}
        </div>
      ) : null}
    </li>
  );
}
