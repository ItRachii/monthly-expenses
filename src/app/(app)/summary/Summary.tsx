"use client";

import { useMemo, useState } from "react";
import type { ExpenseDTO } from "@/lib/expenses";
import { computeOwes, computeNetBalance } from "@/lib/calculations";
import { formatINR } from "@/lib/format";
import { Metric } from "@/components/Metric";
import {
  CategoryBar,
  CategoryPie,
  MonthlyTrend,
  PerPersonBar,
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
}: {
  rows: ExpenseDTO[];
  isPersonal: boolean;
  nameMap: Record<string, string>;
  members: Member[];
}) {
  const months = useMemo(() => {
    const set = new Set(rows.map((r) => r.date.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [rows]);

  const [month, setMonth] = useState(months[0] ?? "");
  const [tab, setTab] = useState(0);

  if (rows.length === 0) {
    return <div className="alert-info">No expenses recorded yet.</div>;
  }

  const selectedMonth = months.includes(month) ? month : months[0];
  const monthRows = rows.filter((r) => r.date.slice(0, 7) === selectedMonth);
  const total = monthRows.reduce((s, r) => s + r.amount, 0);

  const categoryData = byCategory(monthRows);
  const trendData = byMonth(rows);

  const tabs = isPersonal
    ? ["Category (Pie)", "Category (Bar)", "Per Person", "Monthly Trend"]
    : ["Category (Pie)", "Category (Bar)", "Monthly Trend"];

  const personA = nameMap["Person A"] ?? "Person A";
  const personB = nameMap["Person B"] ?? "Person B";

  // Personal aggregates
  const aPaid = monthRows.filter((r) => r.payer === "Person A").reduce((s, r) => s + r.amount, 0);
  const bPaid = monthRows.filter((r) => r.payer === "Person B").reduce((s, r) => s + r.amount, 0);
  const aShare = monthRows.reduce((s, r) => s + computeOwes(r.amount, r.split)[0], 0);
  const bShare = monthRows.reduce((s, r) => s + computeOwes(r.amount, r.split)[1], 0);
  const { balance, description } = computeNetBalance(monthRows);
  const balanceDesc = description
    .replace("Person A", personA)
    .replace("Person B", personB);

  const nMembers = members.length;
  const perPersonData = [
    { name: personA, paid: aPaid, share: aShare },
    { name: personB, paid: bPaid, share: bShare },
  ];

  const payerLabel = (v: string) => nameMap[v] ?? v;
  const splitLabel = (v: string) => (v === "equal" ? "Equal Split" : nameMap[v] ?? v);

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

      <h2 className="section-title">Overview — {selectedMonth}</h2>

      {isPersonal ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Total Spent" value={formatINR(total)} />
            <Metric label={`${personA} Paid`} value={formatINR(aPaid)} delta={`share ${formatINR(aShare)}`} />
            <Metric label={`${personB} Paid`} value={formatINR(bPaid)} delta={`share ${formatINR(bShare)}`} />
          </div>
          <div className={Math.abs(balance) < 0.01 ? "alert-success" : "alert-warning"}>
            <strong>{balanceDesc}</strong>
          </div>
        </>
      ) : (
        <>
          <Metric label="Total Spent" value={formatINR(total)} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m) => {
              const paid = monthRows.filter((r) => r.payer === m.email).reduce((s, r) => s + r.amount, 0);
              const resp =
                monthRows.filter((r) => r.split === m.email).reduce((s, r) => s + r.amount, 0) +
                (nMembers ? monthRows.filter((r) => r.split === "equal").reduce((s, r) => s + r.amount, 0) / nMembers : 0);
              return (
                <Metric
                  key={m.email}
                  label={m.displayName}
                  value={`Paid ${formatINR(paid)}`}
                  delta={`owes ${formatINR(resp)}`}
                />
              );
            })}
          </div>
        </>
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
          {tabs[tab] === "Category (Pie)" && <CategoryPie data={categoryData} />}
          {tabs[tab] === "Category (Bar)" && <CategoryBar data={categoryData} />}
          {tabs[tab] === "Per Person" && <PerPersonBar data={perPersonData} />}
          {tabs[tab] === "Monthly Trend" && <MonthlyTrend data={trendData} />}
        </div>
      </div>

      {/* Detail table */}
      <div className="space-y-2">
        <h2 className="section-title">Expense Detail</h2>
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
              </tr>
            </thead>
            <tbody>
              {monthRows.map((r) => {
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
