"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseDTO } from "@/lib/expenses";
import type { SettlementDTO } from "@/lib/settlements";
import {
  SETTLE_EPS,
  applyPayments,
  computeNets,
  pairAmount,
  paymentLineage,
  round2,
  simplifyDebts,
  totalOutstanding,
  type LineageEntry,
  type PaymentLike,
} from "@/lib/settlementMath";
import { formatINR } from "@/lib/format";
import { Metric } from "@/components/Metric";
import { settleAction } from "@/lib/actions/settlements";

interface Member {
  /** Opaque member key — matches the masked payer/split values in rows. */
  key: string;
  displayName: string;
}
interface Opt {
  value: string;
  label: string;
}

export function Settlement({
  ctx,
  rows,
  settlements,
  isPersonal,
  nameMap,
  members,
  payerOptions,
  contextSelector,
}: {
  ctx: string;
  rows: ExpenseDTO[];
  settlements: SettlementDTO[];
  isPersonal: boolean;
  nameMap: Record<string, string>;
  members: Member[];
  payerOptions: Opt[];
  contextSelector: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const months = useMemo(() => {
    const set = new Set(rows.map((r) => r.date.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [rows]);

  const [month, setMonth] = useState(months[0] ?? "");

  const nameOf = (v: string) => nameMap[v] ?? v;

  const selectedMonth = months.includes(month) ? month : months[0];
  const monthRows = rows.filter((r) => r.date.slice(0, 7) === selectedMonth);
  const total = monthRows.reduce((s, r) => s + r.amount, 0);
  const nMembers = members.length;
  const memberKeys = useMemo(() => members.map((m) => m.key), [members]);

  // Expense-derived balances and debts for the month, then subtract every
  // recorded payment. The month is only "settled" when nothing remains.
  const nets = computeNets(monthRows, memberKeys);
  const balances = nets.map((n) => ({ ...n, displayName: nameOf(n.id) }));
  const expenseTransfers = simplifyDebts(nets);
  const monthPayments: PaymentLike[] = settlements
    .filter((s) => s.month === selectedMonth)
    .sort((a, b) => a.settledAt.localeCompare(b.settledAt))
    .map((s) => ({ from: s.settledBy, to: s.settledTo, amount: s.amount }));
  const remainingTransfers = applyPayments(expenseTransfers, monthPayments);
  const owedTotal = totalOutstanding(expenseTransfers);
  const outstanding = totalOutstanding(remainingTransfers);
  const recoveredTotal = round2(owedTotal - outstanding);
  const fullySettled = expenseTransfers.length > 0 && remainingTransfers.length === 0;

  // Settle form state (group only; personal/solo has nothing to settle).
  const [settledBy, setSettledBy] = useState(payerOptions[0]?.value ?? "");
  const [settledTo, setSettledTo] = useState(payerOptions[1]?.value ?? "");
  const [note, setNote] = useState("");
  const [groupAmount, setGroupAmount] = useState("");

  const pairRemaining = pairAmount(remainingTransfers, settledBy, settledTo);
  const toOptions = payerOptions.filter((o) => o.value !== settledBy);

  // Default the form to the first outstanding pair whenever the month or the
  // recorded payments change and the current selection has nothing due.
  useEffect(() => {
    const first = remainingTransfers[0];
    if (first && pairAmount(remainingTransfers, settledBy, settledTo) <= SETTLE_EPS) {
      setSettledBy(first.from);
      setSettledTo(first.to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, settlements]);

  // Prefill the amount with what is still owed for the selected pair.
  useEffect(() => {
    setGroupAmount(pairRemaining > SETTLE_EPS ? pairRemaining.toFixed(2) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledBy, settledTo, selectedMonth, settlements]);

  // History lineage: for every recorded payment, where it sat in its debt's
  // lifetime (owed → paid so far → remaining), computed per month.
  const lineageById = useMemo(() => {
    const map = new Map<number, LineageEntry>();
    const historyMonths = Array.from(new Set(settlements.map((s) => s.month)));
    for (const m of historyMonths) {
      const mRows = rows.filter((r) => r.date.slice(0, 7) === m);
      const transfers = simplifyDebts(computeNets(mRows, memberKeys));
      const pays = settlements
        .filter((s) => s.month === m)
        .sort((a, b) => a.settledAt.localeCompare(b.settledAt));
      const entries = paymentLineage(
        transfers,
        pays.map((s) => ({ from: s.settledBy, to: s.settledTo, amount: s.amount })),
      );
      pays.forEach((s, i) => map.set(s.id, entries[i]));
    }
    return map;
  }, [settlements, rows, memberKeys]);

  function progressText(entry: LineageEntry | undefined): string {
    if (!entry || entry.owed <= SETTLE_EPS) return "—";
    if (entry.remaining > SETTLE_EPS)
      return `${formatINR(entry.paidToDate)} of ${formatINR(entry.owed)} — ${formatINR(entry.remaining)} left`;
    return `${formatINR(entry.owed)} fully recovered`;
  }

  function settle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amount = parseFloat(groupAmount);
    if (!(amount > 0)) {
      setError("Enter a payment amount.");
      return;
    }
    if (settledTo === settledBy) {
      setError("Payer and recipient must be different people.");
      return;
    }
    if (pairRemaining <= SETTLE_EPS) {
      setError(`Nothing is outstanding from ${nameOf(settledBy)} to ${nameOf(settledTo)}.`);
      return;
    }
    if (amount > pairRemaining + SETTLE_EPS) {
      setError(
        `Amount exceeds the outstanding ${formatINR(pairRemaining)} — a payment can't be more than what's owed.`,
      );
      return;
    }
    startTransition(async () => {
      const res = await settleAction({
        ctx,
        month: selectedMonth,
        settledBy,
        settledTo,
        amount,
        note,
      });
      if (res.ok) {
        setNote("");
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {contextSelector}
        <div className="alert-info">No expenses recorded yet.</div>
      </div>
    );
  }

  const isPartial = monthPayments.length > 0 && outstanding > SETTLE_EPS;

  return (
    <div className="space-y-6">
      {/* Context + month selectors on one horizontal line. */}
      <div className="grid grid-cols-2 items-end gap-3">
        {contextSelector}
        <div>
          <label className="label">Select Month</label>
          <select className="select" value={selectedMonth} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      <h2 className="section-title">Balance — {selectedMonth}</h2>

      {isPersonal ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric label="Total Spent" value={formatINR(total)} />
            <Metric label="Expenses" value={String(monthRows.length)} />
          </div>
          <div className="alert-info">
            Personal expenses are yours alone — there&apos;s nothing to settle here.
            Settlements apply to <strong>group</strong> expenses.
          </div>
        </div>
      ) : fullySettled ? (
        <div className="space-y-3">
          <div className="alert-success">
            This month is <strong>fully settled</strong> — {formatINR(owedTotal)} recovered
            across {monthPayments.length} payment{monthPayments.length === 1 ? "" : "s"}.
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Amount Owed" value={formatINR(owedTotal)} />
            <Metric label="Recovered" value={formatINR(recoveredTotal)} />
            <Metric label="Payments" value={String(monthPayments.length)} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            <strong>Total spent this month:</strong> {formatINR(total)}
          </p>
          {nMembers ? (
            <>
              <p className="text-sm text-muted">Equal share per member: {formatINR(total / nMembers)}</p>
              <div className="card overflow-x-auto p-0">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th className="text-right">Paid (₹)</th>
                      <th className="text-right">Owes (₹)</th>
                      <th className="text-right">Net (₹)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((b) => {
                      // Status reflects settlement payments already made, so a
                      // part-paid debt shows only what is still to be recovered.
                      const owesNow = round2(
                        remainingTransfers.filter((t) => t.from === b.id).reduce((s, t) => s + t.amount, 0),
                      );
                      const getsNow = round2(
                        remainingTransfers.filter((t) => t.to === b.id).reduce((s, t) => s + t.amount, 0),
                      );
                      const status =
                        getsNow > SETTLE_EPS
                          ? `Gets back ${formatINR(getsNow)}`
                          : owesNow > SETTLE_EPS
                          ? `Owes ${formatINR(owesNow)}`
                          : "Settled";
                      return (
                        <tr key={b.id}>
                          <td>{b.displayName}</td>
                          <td className="text-right">{b.paid.toFixed(2)}</td>
                          <td className="text-right">{b.owes.toFixed(2)}</td>
                          <td className="text-right">{b.net.toFixed(2)}</td>
                          <td>{status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Bottom line: who still owes whom, after part payments. */}
              {remainingTransfers.length > 0 ? (
                <div className="card space-y-1">
                  {remainingTransfers.map((t, idx) => {
                    const owedPair = pairAmount(expenseTransfers, t.from, t.to);
                    const paidPair = round2(owedPair - t.amount);
                    return (
                      <p key={idx} className="text-sm">
                        <strong>{nameOf(t.from)}</strong> owes <strong>{nameOf(t.to)}</strong>{" "}
                        <strong>{formatINR(t.amount)}</strong>
                        {paidPair > SETTLE_EPS ? (
                          <span className="text-muted">
                            {" "}— {formatINR(paidPair)} of {formatINR(owedPair)} already paid
                          </span>
                        ) : null}
                      </p>
                    );
                  })}
                  {isPartial ? (
                    <p className="text-xs text-muted">
                      Partially settled — {formatINR(outstanding)} still to be recovered.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="alert-success">
                  Everyone is settled up for {selectedMonth}.
                </div>
              )}

              {remainingTransfers.length > 0 ? (
                <form onSubmit={settle} className="card space-y-4">
                  <h3 className="section-title">Record a Settlement Payment</h3>
                  <p className="text-xs text-muted">
                    Part payments are fine — the month stays open until the full
                    amount is recovered.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">Who is paying?</label>
                      <select
                        className="select"
                        value={settledBy}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSettledBy(v);
                          if (settledTo === v) {
                            const other = payerOptions.find((o) => o.value !== v);
                            if (other) setSettledTo(other.value);
                          }
                        }}
                      >
                        {payerOptions.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Paying to</label>
                      <select className="select" value={settledTo} onChange={(e) => setSettledTo(e.target.value)}>
                        {toOptions.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label">
                      Amount (₹)
                      {pairRemaining > SETTLE_EPS ? (
                        <span className="text-muted"> — outstanding {formatINR(pairRemaining)}</span>
                      ) : null}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="input"
                      value={groupAmount}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "" || /^\d*\.?\d*$/.test(v)) setGroupAmount(v);
                      }}
                    />
                  </div>
                  <div>
                    <label className="label">Note (optional)</label>
                    <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                  {error ? <div className="alert-error">{error}</div> : null}
                  <button type="submit" className="btn-primary" disabled={pending}>
                    {pending
                      ? "Saving…"
                      : parseFloat(groupAmount) < pairRemaining - SETTLE_EPS
                      ? "Record Part Payment"
                      : "Record Payment"}
                  </button>
                </form>
              ) : null}
            </>
          ) : null}
        </div>
      )}

      {/* History */}
      <div className="space-y-2">
        <h2 className="section-title">Settlement History</h2>
        {settlements.length === 0 ? (
          <div className="alert-info">No settlements recorded yet.</div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Settled At</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="text-right">Paid (₹)</th>
                  <th>Progress</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <td>{s.month}</td>
                    <td>{s.settledAt.slice(0, 16).replace("T", " ")}</td>
                    <td>{nameOf(s.settledBy)}</td>
                    <td>{s.settledTo ? nameOf(s.settledTo) : "—"}</td>
                    <td className="text-right">{s.amount.toFixed(2)}</td>
                    <td className="whitespace-nowrap">{progressText(lineageById.get(s.id))}</td>
                    <td>{s.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
