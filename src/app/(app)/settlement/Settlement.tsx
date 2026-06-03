"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseDTO } from "@/lib/expenses";
import type { SettlementDTO } from "@/lib/settlements";
import { SPLIT_EQUAL } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import { Metric } from "@/components/Metric";
import { settleAction } from "@/lib/actions/settlements";

interface Member {
  email: string;
  displayName: string;
}
interface Opt {
  value: string;
  label: string;
}
interface Transfer {
  from: string;
  to: string;
  amount: number;
}

// Reduce per-member net balances to a minimal set of "X owes Y" transfers.
// For a two-person group this collapses to a single line.
function simplifyDebts(
  balances: { displayName: string; net: number }[],
): Transfer[] {
  const creditors = balances
    .filter((b) => b.net > 0.01)
    .map((b) => ({ name: b.displayName, amount: b.net }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = balances
    .filter((b) => b.net < -0.01)
    .map((b) => ({ name: b.displayName, amount: -b.net }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    transfers.push({ from: debtors[i].name, to: creditors[j].name, amount: pay });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount <= 0.01) i++;
    if (creditors[j].amount <= 0.01) j++;
  }
  return transfers;
}

export function Settlement({
  ctx,
  rows,
  settlements,
  isPersonal,
  nameMap,
  members,
  payerOptions,
}: {
  ctx: string;
  rows: ExpenseDTO[];
  settlements: SettlementDTO[];
  isPersonal: boolean;
  nameMap: Record<string, string>;
  members: Member[];
  payerOptions: Opt[];
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
  const settledMonths = new Set(settlements.map((s) => s.month));
  const isSettled = selectedMonth ? settledMonths.has(selectedMonth) : false;
  const monthRows = rows.filter((r) => r.date.slice(0, 7) === selectedMonth);
  const total = monthRows.reduce((s, r) => s + r.amount, 0);
  const nMembers = members.length;

  // Per-member balance for the selected month: paid (fronted), owes (share of
  // the bill = items split to them + their cut of equal-split items), net.
  const equalPool = monthRows
    .filter((r) => r.split === SPLIT_EQUAL)
    .reduce((s, r) => s + r.amount, 0);
  const equalShare = nMembers ? equalPool / nMembers : 0;
  const balances = members.map((m) => {
    const paid = monthRows
      .filter((r) => r.payer === m.email)
      .reduce((s, r) => s + r.amount, 0);
    const owes =
      monthRows
        .filter((r) => r.split === m.email)
        .reduce((s, r) => s + r.amount, 0) + equalShare;
    return { email: m.email, displayName: m.displayName, paid, owes, net: paid - owes };
  });
  const transfers = simplifyDebts(balances);

  // Settle form state (group only; personal/solo has nothing to settle).
  const defaultSettledBy = payerOptions[0]?.value ?? "";
  const [settledBy, setSettledBy] = useState(defaultSettledBy);
  const [note, setNote] = useState("");
  const [groupAmount, setGroupAmount] = useState(
    nMembers ? (total / nMembers).toFixed(2) : "0",
  );

  function settle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amount = parseFloat(groupAmount);
    startTransition(async () => {
      const res = await settleAction({
        ctx,
        month: selectedMonth,
        settledBy,
        amount: isNaN(amount) ? 0 : amount,
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
    return <div className="alert-info">No expenses recorded yet.</div>;
  }

  const settledRec = settlements.find((s) => s.month === selectedMonth);

  return (
    <div className="space-y-6">
      <div className="max-w-xs">
        <label className="label">Select Month</label>
        <select className="select" value={selectedMonth} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <h2 className="section-title">Balance — {selectedMonth}</h2>

      {isSettled && settledRec ? (
        <div className="space-y-3">
          <div className="alert-success">This month is marked as <strong>settled</strong>.</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Amount Settled" value={formatINR(settledRec.amount)} />
            <Metric label="Settled By" value={nameOf(settledRec.settledBy)} />
            <Metric label="Settled On" value={settledRec.settledAt.slice(0, 10)} />
          </div>
          {settledRec.note ? <div className="alert-info">Note: {settledRec.note}</div> : null}
        </div>
      ) : isPersonal ? (
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
                      const status =
                        b.net > 0.01
                          ? `Gets back ${formatINR(b.net)}`
                          : b.net < -0.01
                          ? `Owes ${formatINR(Math.abs(b.net))}`
                          : "Settled";
                      return (
                        <tr key={b.email}>
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

              {/* Bottom line: who owes whom, in plain English. */}
              {transfers.length > 0 ? (
                <div className="card space-y-1">
                  {transfers.map((t, idx) => (
                    <p key={idx} className="text-sm">
                      <strong>{t.from}</strong> owes <strong>{t.to}</strong>{" "}
                      <strong>{formatINR(t.amount)}</strong>
                    </p>
                  ))}
                </div>
              ) : (
                <div className="alert-success">
                  Everyone is settled up for {selectedMonth}.
                </div>
              )}

              {total > 0.01 ? (
                <form onSubmit={settle} className="card space-y-4">
                  <h3 className="section-title">Mark as Settled</h3>
                  <div>
                    <label className="label">Who is making the settlement payment?</label>
                    <select className="select" value={settledBy} onChange={(e) => setSettledBy(e.target.value)}>
                      {payerOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Settlement Amount (₹)</label>
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
                    {pending ? "Saving…" : "Confirm Settlement"}
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
                  <th>Settled By</th>
                  <th className="text-right">Amount (₹)</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <td>{s.month}</td>
                    <td>{s.settledAt.slice(0, 16).replace("T", " ")}</td>
                    <td>{nameOf(s.settledBy)}</td>
                    <td className="text-right">{s.amount.toFixed(2)}</td>
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
