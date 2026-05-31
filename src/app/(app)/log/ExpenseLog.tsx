"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseDTO } from "@/lib/expenses";
import { computeOwes } from "@/lib/calculations";
import { formatINR } from "@/lib/format";
import { deleteExpenseAction } from "@/lib/actions/expenses";
import { Metric } from "@/components/Metric";

interface Opt {
  value: string;
  label: string;
}

export function ExpenseLog({
  rows,
  isPersonal,
  nameMap,
  categories,
  payerOptions,
  splitOptions,
}: {
  rows: ExpenseDTO[];
  isPersonal: boolean;
  nameMap: Record<string, string>;
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [month, setMonth] = useState("All");
  const [category, setCategory] = useState("All");
  const [payer, setPayer] = useState("All");
  const [split, setSplit] = useState("All");

  const months = useMemo(() => {
    const set = new Set(rows.map((r) => r.date.slice(0, 7)));
    return ["All", ...Array.from(set).sort().reverse()];
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (month === "All" || r.date.slice(0, 7) === month) &&
          (category === "All" || r.category === category) &&
          (payer === "All" || r.payer === payer) &&
          (split === "All" || r.split === split),
      ),
    [rows, month, category, payer, split],
  );

  const payerLabel = (v: string) => nameMap[v] ?? v;
  const splitLabel = (v: string) => (v === "equal" ? "Equal Split" : nameMap[v] ?? v);

  const totalSpent = filtered.reduce((s, r) => s + r.amount, 0);
  const aShare = filtered.reduce((s, r) => s + computeOwes(r.amount, r.split)[0], 0);
  const bShare = filtered.reduce((s, r) => s + computeOwes(r.amount, r.split)[1], 0);
  const personA = nameMap["Person A"] ?? "Person A";
  const personB = nameMap["Person B"] ?? "Person B";

  function exportCsv() {
    const header = isPersonal
      ? ["Date", "Category", "Item", "Amount", "Payer", "Split", `${personA} Share`, `${personB} Share`]
      : ["Date", "Category", "Item", "Amount", "Payer", "Split"];
    const lines = filtered.map((r) => {
      const base = [
        r.date,
        r.category,
        r.item,
        r.amount.toFixed(2),
        payerLabel(r.payer),
        splitLabel(r.split),
      ];
      if (isPersonal) {
        const [a, b] = computeOwes(r.amount, r.split);
        base.push(a.toFixed(2), b.toFixed(2));
      }
      return base.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "expenses_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function remove(id: number) {
    if (!confirm("Delete this expense?")) return;
    startTransition(async () => {
      await deleteExpenseAction(id);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="alert-info">
        No expenses recorded yet. Head to <strong>Add Expense</strong> to get started.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">Month</label>
          <select className="select" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Category</label>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {["All", ...categories].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Payer</label>
          <select className="select" value={payer} onChange={(e) => setPayer(e.target.value)}>
            <option value="All">All</option>
            {payerOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Split</label>
          <select className="select" value={split} onChange={(e) => setSplit(e.target.value)}>
            <option value="All">All</option>
            {splitOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className={`grid gap-3 ${isPersonal ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2"}`}>
        <Metric label="Expenses" value={String(filtered.length)} />
        <Metric label="Total Spent" value={formatINR(totalSpent)} />
        {isPersonal ? (
          <>
            <Metric label={`${personA}'s Share`} value={formatINR(aShare)} />
            <Metric label={`${personB}'s Share`} value={formatINR(bShare)} />
          </>
        ) : null}
      </div>

      {/* Table */}
      <div className="card overflow-x-auto p-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Item</th>
              <th className="text-right">Amount (₹)</th>
              <th>Payer</th>
              <th>Split</th>
              {isPersonal ? (
                <>
                  <th className="text-right">{personA} (₹)</th>
                  <th className="text-right">{personB} (₹)</th>
                </>
              ) : null}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const [a, b] = computeOwes(r.amount, r.split);
              return (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td>{r.category}</td>
                  <td>{r.item}</td>
                  <td className="text-right">{r.amount.toFixed(2)}</td>
                  <td>{payerLabel(r.payer)}</td>
                  <td>{splitLabel(r.split)}</td>
                  {isPersonal ? (
                    <>
                      <td className="text-right">{a.toFixed(2)}</td>
                      <td className="text-right">{b.toFixed(2)}</td>
                    </>
                  ) : null}
                  <td className="text-right">
                    <button
                      className="text-red-400 hover:text-red-300 disabled:opacity-50"
                      onClick={() => remove(r.id)}
                      disabled={pending}
                      aria-label="Delete expense"
                      title="Delete"
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={isPersonal ? 9 : 7} className="text-center text-muted">
                  No expenses match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <button className="btn-secondary" onClick={exportCsv} disabled={filtered.length === 0}>
        Export to CSV
      </button>
    </div>
  );
}
