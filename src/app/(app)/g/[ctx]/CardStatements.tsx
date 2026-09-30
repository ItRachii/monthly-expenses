"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CardStatementView, CardView, StatementExpenseView } from "@/lib/cards";
import type { LoanView } from "@/lib/loans";
import {
  cardRemovalPreviewAction,
  deleteCardAction,
  deleteCardStatementAction,
  statementRemovalPreviewAction,
  type RemovalPreview,
} from "@/lib/actions/cards";
import { AlertTriangleIcon, CalendarIcon, CreditCardIcon, DownloadIcon } from "@/components/Icons";
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
          <StatementBlock key={s.id} cardId={card.id} statement={s} />
        ))}
      </div>
      <button type="button" className="text-xs text-negative hover:underline" onClick={() => setConfirm(true)}>
        Remove this card
      </button>
      {confirm ? (
        <RemoveDialog
          kind="card"
          title={`Remove ${card.bank} •••• ${card.last4}?`}
          load={() => cardRemovalPreviewAction(card.id)}
          exportHref={`/api/cards/export?id=${encodeURIComponent(card.id)}`}
          pending={pending}
          actionError={error}
          onCancel={() => setConfirm(false)}
          onConfirm={() => run(() => deleteCardAction(card.id))}
        />
      ) : null}
    </section>
  );
}

/** One statement: the summary line, then its figures and the expenses added from it. */
function StatementBlock({ cardId, statement: s }: { cardId: string; statement: CardStatementView }) {
  const { pending, error, run } = useAction();
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

        <button type="button" className="text-xs text-negative hover:underline" onClick={() => setConfirm(true)}>
          Remove this statement
        </button>
        {confirm ? (
          <RemoveDialog
            kind="statement"
            title={`Remove the ${monthLabel(s.period)} statement?`}
            load={() => statementRemovalPreviewAction(s.id)}
            exportHref={`/api/cards/export?id=${encodeURIComponent(cardId)}&period=${s.period}`}
            pending={pending}
            actionError={error}
            onCancel={() => setConfirm(false)}
            onConfirm={() => run(() => deleteCardStatementAction(s.id))}
          />
        ) : null}
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Confirms removing a card or a statement, listing everything that goes
 * with it, with its history one tap away as an Excel file first.
 */
function RemoveDialog({
  kind,
  title,
  load,
  exportHref,
  pending,
  actionError,
  onCancel,
  onConfirm,
}: {
  kind: "card" | "statement";
  title: string;
  load: () => Promise<{ ok: true; preview: RemovalPreview } | { ok: false; error: string }>;
  exportHref: string;
  pending: boolean;
  actionError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [preview, setPreview] = useState<RemovalPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load once, when the popup opens.
  const [loader] = useState(() => load);
  useEffect(() => {
    let live = true;
    loader().then((res) => {
      if (!live) return;
      if (res.ok) setPreview(res.preview);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [loader]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, pending]);

  const p = preview;
  const lines: string[] = p
    ? [
        ...(kind === "card" ? [plural(p.statements, "statement")] : ["The statement summary"]),
        ...(p.personal.count > 0 ? [`${plural(p.personal.count, "Personal expense")} · ${formatINR(p.personal.total)}`] : []),
        ...p.groups.map((g) => `${plural(g.count, "expense")} in ${g.name} · ${formatINR(g.total)}`),
        ...(p.instalments > 0 ? [plural(p.instalments, "EMI instalment record")] : []),
      ]
    : [];

  return (
    <div className="sheet-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !pending && onCancel()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-title"
        aria-describedby="remove-text"
        className="modal-pop card max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-remove={kind}
      >
        <h2 id="remove-title" className="section-title">
          {title}
        </h2>
        <div id="remove-text" className="space-y-3 text-sm">
          {error ? (
            <div className="alert-error">{error}</div>
          ) : !p ? (
            <p className="text-muted">Checking what is linked to this {kind}…</p>
          ) : (
            <>
              <p className="text-muted">
                This permanently deletes the {kind} and everything imported from it, everywhere it appears: the Expenses tab, group pages,
                summaries and change history.
              </p>
              <ul className="list-disc space-y-1 pl-5" data-remove-lines>
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {p.groups.length > 0 ? (
                <p className="text-warning">
                  Balances in {p.groups.map((g) => g.name).join(", ")} change for everyone in {p.groups.length === 1 ? "that group" : "those groups"}, and they are notified.
                </p>
              ) : null}
              {p.kept > 0 ? (
                <p className="text-muted">
                  {plural(p.kept, "expense")} in groups you have left stay{p.kept === 1 ? "s" : ""} as {p.kept === 1 ? "it is" : "they are"}.
                </p>
              ) : null}
              <p className="text-muted">This cannot be undone. Export the history first if you may need it.</p>
            </>
          )}
          {actionError ? <div className="alert-error">{actionError}</div> : null}
        </div>
        {/* Phones: export first, then delete, then cancel. Wider: export on
            the left, the destructive action last on the right. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <a href={exportHref} className="btn-secondary inline-flex items-center justify-center gap-2 whitespace-nowrap sm:mr-auto" download>
            <DownloadIcon className="h-4 w-4 text-muted" />
            Export history
          </a>
          <button type="button" className="btn-danger whitespace-nowrap sm:order-last" disabled={pending || !p} onClick={onConfirm}>
            {pending ? "Removing…" : "Delete everything"}
          </button>
          <button type="button" className="btn-secondary whitespace-nowrap" autoFocus disabled={pending} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
