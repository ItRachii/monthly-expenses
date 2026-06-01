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
                    {members.map((m) => {
                      const paid = monthRows.filter((r) => r.payer === m.email).reduce((s, r) => s + r.amount, 0);
                      const resp =
                        monthRows.filter((r) => r.split === m.email).reduce((s, r) => s + r.amount, 0) +
                        monthRows.filter((r) => r.split === SPLIT_EQUAL).reduce((s, r) => s + r.amount, 0) / nMembers;
                      const net = paid - resp;
                      const status =
                        net > 0.01 ? `Gets back ${formatINR(net)}` : net < -0.01 ? `Owes ${formatINR(Math.abs(net))}` : "Settled";
                      return (
                        <tr key={m.email}>
                          <td>{m.displayName}</td>
                          <td className="text-right">{paid.toFixed(2)}</td>
                          <td className="text-right">{resp.toFixed(2)}</td>
                          <td className="text-right">{net.toFixed(2)}</td>
                          <td>{status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

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
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="input"
                      value={groupAmount}
                      onChange={(e) => setGroupAmount(e.target.value)}
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
