"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { ExpenseDTO } from "@/lib/expenses";
import { SPLIT_EQUAL } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import { Metric } from "@/components/Metric";
import {
  CategoryBar,
  CategoryPie,
  MonthlyTrend,
} from "@/components/charts/Charts";

interface Member {
  email: string;
  displayName: string;
}

function byCategory(rows: ExpenseDTO[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.category, (m.get(r.category) ?? 0) + r.amount);
  return Array.from(m, ([category, amount]) => ({ category, amount }));
}

function byMonth(rows: ExpenseDTO[]) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = r.date.slice(0, 7);
    m.set(k, (m.get(k) ?? 0) + r.amount);
  }
  return Array.from(m, ([month, amount]) => ({ month, amount })).sort((a, b) =>
    a.month.localeCompare(b.month),
  );
}

export function Summary({
  rows,
  isPersonal,
  nameMap,
  members,
  contextSelector,
}: {
  rows: ExpenseDTO[];
  isPersonal: boolean;
  nameMap: Record<string, string>;
  members: Member[];
  contextSelector: ReactNode;
}) {
  const months = useMemo(() => {
    const set = new Set(rows.map((r) => r.date.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [rows]);

  const [month, setMonth] = useState(months[0] ?? "");
  const [tab, setTab] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {contextSelector}
        <div className="alert-info">No expenses recorded yet.</div>
      </div>
    );
  }

  const selectedMonth = months.includes(month) ? month : months[0];
  const monthRows = rows.filter((r) => r.date.slice(0, 7) === selectedMonth);
  const total = monthRows.reduce((s, r) => s + r.amount, 0);

  const categoryData = byCategory(monthRows);
  const trendData = byMonth(rows);
  // Clicking a pie slice filters the detail table to that category.
  const detailRows = selectedCategory
    ? monthRows.filter((r) => r.category === selectedCategory)
    : monthRows;

  const tabs = ["Category (Pie)", "Category (Bar)", "Monthly Trend"];

  const payerLabel = (v: string) => nameMap[v] ?? v;
  const splitLabel = (v: string) => (v === SPLIT_EQUAL ? "Equal Split" : nameMap[v] ?? v);

  return (
    <div className="space-y-6">
      {/* Context + month selectors on one horizontal line. */}
      <div className="grid grid-cols-2 items-end gap-3">
        {contextSelector}
        <div>
          <label className="label">Select Month</label>
          <select
            className="select"
            value={selectedMonth}
            onChange={(e) => {
              setMonth(e.target.value);
              setSelectedCategory(null);
            }}
          >
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      <h2 className="section-title">Overview</h2>

      {isPersonal ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Total Spent" value={formatINR(total)} />
          <Metric label="Expenses" value={String(monthRows.length)} />
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-center">Total Spent</th>
                {members.map((m) => (
                  <th key={m.email} className="text-center">
                    {m.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-center font-semibold">{formatINR(total)}</td>
                {members.map((m) => {
                  const paid = monthRows
                    .filter((r) => r.payer === m.email)
                    .reduce((s, r) => s + r.amount, 0);
                  return (
                    <td key={m.email} className="text-center">
                      {formatINR(paid)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Charts */}
      <div className="space-y-3">
        <h2 className="section-title">Spending Breakdown</h2>
        <div className="flex flex-wrap gap-2">
          {tabs.map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(i)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                tab === i ? "bg-primary/20 font-semibold text-ink" : "text-muted hover:bg-white/5"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="card">
          {tabs[tab] === "Category (Pie)" && (
            <CategoryPie
              data={categoryData}
              selected={selectedCategory}
              onSelect={(c) =>
                setSelectedCategory((prev) => (prev === c ? null : c))
              }
            />
          )}
          {tabs[tab] === "Category (Bar)" && <CategoryBar data={categoryData} />}
          {tabs[tab] === "Monthly Trend" && <MonthlyTrend data={trendData} />}
        </div>
        {tabs[tab] === "Category (Pie)" ? (
          <p className="text-xs text-muted">
            Click a slice to filter the expense detail below.
          </p>
        ) : null}
      </div>

      {/* Detail table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">
            Expense Detail{selectedCategory ? ` — ${selectedCategory}` : ""}
          </h2>
          {selectedCategory ? (
            <button
              type="button"
              onClick={() => setSelectedCategory(null)}
              className="text-sm text-muted hover:text-ink"
            >
              Clear filter ✕
            </button>
          ) : null}
        </div>
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
              </tr>
            </thead>
            <tbody>
              {detailRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td>{r.category}</td>
                  <td>{r.item}</td>
                  <td className="text-right">{r.amount.toFixed(2)}</td>
                  <td>{payerLabel(r.payer)}</td>
                  <td>{splitLabel(r.split)}</td>
                </tr>
              ))}
              {detailRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-muted">
                    No expenses in this category.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
