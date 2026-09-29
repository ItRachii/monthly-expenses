"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteLoanAction } from "@/lib/actions/cards";
import type { LoanView } from "@/lib/loans";
import { formatINR } from "@/lib/format";

function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Every EMI on record, instalment by instalment, with the GST the bank
 * billed later shown against the instalment it belongs to.
 */
export function LoansPanel({ loans }: { loans: LoanView[] }) {
  if (loans.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="section-title">Your EMIs</h2>
      {loans.map((l) => (
        <LoanBlock key={l.loanKey} loan={l} />
      ))}
    </section>
  );
}

function LoanBlock({ loan }: { loan: LoanView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const paid = loan.instalments.reduce((s, i) => s + i.principal + i.interest + (i.gst ?? 0), 0);
  const pendingGst = loan.instalments.filter((i) => i.gst === null).length;

  return (
    <details className="card">
      <summary className="cursor-pointer select-none">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-semibold">Loan …{loan.loanLast4 ?? "?"}</span>
          {loan.card ? <span className="text-sm text-muted">{loan.card}</span> : null}
          <span className="text-sm text-muted">
            {loan.instalments.length} instalment{loan.instalments.length === 1 ? "" : "s"} · {formatINR(paid)} so far
          </span>
          {pendingGst > 0 ? <span className="pill">GST pending on {pendingGst}</span> : null}
        </div>
      </summary>
      <div className="mt-3 space-y-3">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Billed</th>
                <th className="text-right">Principal</th>
                <th className="text-right">Interest</th>
                <th className="text-right">GST</th>
                <th className="text-right">Total</th>
                <th>GST billed in</th>
              </tr>
            </thead>
            <tbody>
              {loan.instalments.map((i) => (
                <tr key={i.id}>
                  <td className="font-medium">{i.instalmentNo ?? "?"}</td>
                  <td className="whitespace-nowrap">
                    {dayLabel(i.date)} <span className="text-muted">({monthLabel(i.period)})</span>
                  </td>
                  <td className="whitespace-nowrap text-right">{formatINR(i.principal)}</td>
                  <td className="whitespace-nowrap text-right">{formatINR(i.interest)}</td>
                  <td className="whitespace-nowrap text-right">{i.gst === null ? <span className="text-muted">pending</span> : formatINR(i.gst)}</td>
                  <td className="whitespace-nowrap text-right font-semibold">{formatINR(i.principal + i.interest + (i.gst ?? 0))}</td>
                  <td className="whitespace-nowrap">{i.gstPeriod ? monthLabel(i.gstPeriod) : <span className="text-muted">not yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Total is what the instalment really cost once its GST arrived. A pending GST usually turns up in the next statement.
        </p>
        {!confirm ? (
          <button type="button" className="btn-danger px-3 py-2.5 text-xs" onClick={() => setConfirm(true)}>
            Forget this loan
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Remove every recorded instalment of this loan?</span>
            <button
              type="button"
              className="btn-danger px-3 py-1 text-xs"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteLoanAction(loan.loanKey);
                  router.refresh();
                })
              }
            >
              Yes, forget
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
