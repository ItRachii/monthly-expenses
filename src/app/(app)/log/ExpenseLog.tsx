"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseDTO, ExpenseChangeDTO } from "@/lib/expenses";
import { SPLIT_EQUAL } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import { deleteExpenseAction, updateExpenseAction } from "@/lib/actions/expenses";
import { Metric } from "@/components/Metric";

interface Opt {
  value: string;
  label: string;
}

export function ExpenseLog({
  rows,
  nameMap,
  categories,
  payerOptions,
  splitOptions,
  contextSelector,
  isPersonal,
  recentChanges,
}: {
  rows: ExpenseDTO[];
  nameMap: Record<string, string>;
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
  contextSelector: ReactNode;
  isPersonal: boolean;
  recentChanges: ExpenseChangeDTO[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [month, setMonth] = useState("All");
  const [category, setCategory] = useState("All");
  const [payer, setPayer] = useState("All");
  const [split, setSplit] = useState("All");
  const [editing, setEditing] = useState<ExpenseDTO | null>(null);

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
  const splitLabel = (v: string) => (v === SPLIT_EQUAL ? "Equal Split" : nameMap[v] ?? v);

  const totalSpent = filtered.reduce((s, r) => s + r.amount, 0);

  function exportCsv() {
    const header = ["Date", "Category", "Item", "Amount", "Payer", "Split"];
    const lines = filtered.map((r) => {
      const base = [
        r.date,
        r.category,
        r.item,
        r.amount.toFixed(2),
        payerLabel(r.payer),
        splitLabel(r.split),
      ];
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
      <div className="space-y-6">
        {contextSelector}
        <div className="alert-info">
          No expenses recorded yet. Head to <strong>Add Expense</strong> to get started.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters — context selector + data filters on one horizontal line.
          items-end keeps the selects aligned if a label wraps. */}
      <div className="grid grid-cols-5 items-end gap-3">
        {contextSelector}
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Expenses" value={String(filtered.length)} />
        <Metric label="Total Spent" value={formatINR(totalSpent)} />
      </div>

      {/* Recent updates — captured by the expenses CDC trigger. */}
      {recentChanges.length > 0 ? (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="section-title text-base">Recent updates</h2>
            <span className="pill text-muted">live change capture</span>
          </div>
          <ul className="space-y-1.5">
            {recentChanges.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <span aria-hidden>{CHANGE_ICON[c.operation]}</span>
                <span className="flex-1 text-ink/90">{c.summary}</span>
                <span className="shrink-0 text-xs text-muted" title={c.changedAt}>
                  {c.when}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.category}</td>
                <td>{r.item}</td>
                <td className="text-right">{r.amount.toFixed(2)}</td>
                <td>{payerLabel(r.payer)}</td>
                <td>{splitLabel(r.split)}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      className="text-muted hover:text-ink disabled:opacity-50"
                      onClick={() => setEditing(r)}
                      disabled={pending}
                      aria-label="Edit expense"
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      className="text-red-400 hover:text-red-300 disabled:opacity-50"
                      onClick={() => remove(r.id)}
                      disabled={pending}
                      aria-label="Delete expense"
                      title="Delete"
                    >
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-muted">
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

      {editing ? (
        <EditExpenseModal
          expense={editing}
          categories={categories}
          payerOptions={payerOptions}
          splitOptions={splitOptions}
          isPersonal={isPersonal}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

const CHANGE_ICON: Record<ExpenseChangeDTO["operation"], string> = {
  INSERT: "➕",
  UPDATE: "✏️",
  DELETE: "🗑",
};

function EditExpenseModal({
  expense,
  categories,
  payerOptions,
  splitOptions,
  isPersonal,
  onClose,
  onSaved,
}: {
  expense: ExpenseDTO;
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
  isPersonal: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(expense.date);
  const [category, setCategory] = useState(expense.category);
  const [item, setItem] = useState(expense.item);
  const [amount, setAmount] = useState(String(expense.amount));
  const [payer, setPayer] = useState(expense.payer);
  const [split, setSplit] = useState(expense.split);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amt = parseFloat(amount);
    if (!item.trim()) {
      setError("Please enter an item description.");
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    startTransition(async () => {
      const res = await updateExpenseAction(expense.id, {
        date,
        category,
        item,
        amount: amt,
        payer,
        split,
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="card max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="section-title">Edit Expense</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div>
          <label className="label">Date</label>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Category</label>
          <select
            className="select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Item / Description</label>
          <input className="input" value={item} onChange={(e) => setItem(e.target.value)} />
        </div>
        <div>
          <label className="label">Amount (₹)</label>
          <input
            type="text"
            inputMode="decimal"
            className="input"
            value={amount}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
            }}
          />
        </div>
        {!isPersonal ? (
          <>
            <div>
              <label className="label">Payer</label>
              <select
                className="select"
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
              >
                {payerOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Split</label>
              <select
                className="select"
                value={split}
                onChange={(e) => setSplit(e.target.value)}
              >
                {splitOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        {error ? <div className="alert-error">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
