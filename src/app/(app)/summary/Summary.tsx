"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, XIcon } from "@/components/Icons";
import type { ExpenseDTO } from "@/lib/expenses";
import { SPLIT_EQUAL } from "@/lib/constants";
import { MonthSelect } from "@/components/MonthSelect";
import {
  CategoryBars,
  CategoryDonut,
  MonthlyTrend,
  OTHER,
  StatCard,
  buildPalette,
  categoryName,
  monthShort,
} from "@/components/charts/Charts";

interface Member {
  /** Opaque member key — matches the masked payer/split values in rows. */
  key: string;
  displayName: string;
}


/** Months present in the data, oldest first, up to and including `end`. */
function monthsUpTo(all: string[], end: string, count: number): string[] {
  return [...all].reverse().filter((m) => m <= end).slice(-count);
}

function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number);
  const today = new Date();
  const isCurrent = today.getFullYear() === y && today.getMonth() + 1 === m;
  // The current month only counts the days that have happened so far.
  return isCurrent ? today.getDate() : new Date(y, m, 0).getDate();
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
  const palette = useMemo(() => buildPalette(rows), [rows]);

  const [month, setMonth] = useState(months[0] ?? "");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  if (rows.length === 0) {
    return <div className="alert-info">No expenses recorded yet.</div>;
  }

  const selectedMonth = months.includes(month) ? month : months[0];
  const monthRows = rows.filter((r) => r.date.slice(0, 7) === selectedMonth);

  // Per-month series for the cards: the six months up to the selected one.
  const spark = monthsUpTo(months, selectedMonth, 6);
  const prevMonth = months[months.indexOf(selectedMonth) + 1] ?? null;
  const sumWhere = (m: string, pred: (r: ExpenseDTO) => boolean = () => true) =>
    rows.filter((r) => r.date.slice(0, 7) === m && pred(r)).reduce((s, r) => s + r.amount, 0);
  const series = (pred?: (r: ExpenseDTO) => boolean) => ({
    value: sumWhere(selectedMonth, pred),
    history: spark.map((m) => sumWhere(m, pred)),
    previous: prevMonth ? sumWhere(prevMonth, pred) : null,
  });
  const countIn = (m: string) => rows.filter((r) => r.date.slice(0, 7) === m).length;
  const dailyAvg = (m: string) => sumWhere(m) / daysIn(m);

  // A donut/legend selection filters the detail; "Other" means every
  // category outside the named seven.
  const matches = (r: ExpenseDTO) =>
    !selectedCategory || palette.bucket(r.category) === selectedCategory;
  const detailRows = monthRows.filter(matches);

  const payerLabel = (v: string) => nameMap[v] ?? v;
  const splitLabel = (v: string) => (v === SPLIT_EQUAL ? "Equal Split" : nameMap[v] ?? v);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">Overview</h2>
        <MonthSelect
          months={months}
          value={selectedMonth}
          onChange={(m) => {
            setMonth(m);
            setSelectedCategory(null);
          }}
        />
      </div>

      {/* Quick summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total spent" tone="spend" {...series()} />
        {isPersonal ? (
          <>
            <StatCard
              title="Daily average"
              tone="spend"
              value={dailyAvg(selectedMonth)}
              history={spark.map(dailyAvg)}
              previous={prevMonth ? dailyAvg(prevMonth) : null}
            />
            <StatCard
              title="Expenses"
              tone="neutral"
              money={false}
              value={countIn(selectedMonth)}
              history={spark.map(countIn)}
              previous={prevMonth ? countIn(prevMonth) : null}
            />
          </>
        ) : (
          members.map((m) => (
            <StatCard
              key={m.key}
              title={`${m.displayName} paid`}
              tone="neutral"
              {...series((r) => r.payer === m.key)}
            />
          ))
        )}
      </div>

      {/* All charts at once: trend full width, then donut + bars. */}
      <MonthlyTrend rows={rows} palette={palette} />
      <div className="grid gap-5 lg:grid-cols-2">
        <CategoryDonut
          rows={monthRows}
          palette={palette}
          selected={selectedCategory}
          onSelect={(c) => {
            const next = selectedCategory === c ? null : c;
            setSelectedCategory(next);
            // Picking a category is a request to see those expenses.
            if (next) setDetailOpen(true);
          }}
          onClear={() => setSelectedCategory(null)}
        />
        <CategoryBars rows={monthRows} palette={palette} />
      </div>

      {/* Expense detail: collapsed until asked for. */}
      <section className="card p-0">
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            aria-expanded={detailOpen}
            onClick={() => setDetailOpen((v) => !v)}
          >
            <ChevronDownIcon
              className={`h-4 w-4 shrink-0 text-muted transition-transform ${detailOpen ? "" : "-rotate-90"}`}
            />
            <span className="truncate font-semibold">
              Expense detail
              {selectedCategory ? `: ${selectedCategory}` : ""}
            </span>
            <span className="shrink-0 text-sm text-muted">
              {detailRows.length} in {monthShort(selectedMonth)}
            </span>
          </button>
          {selectedCategory ? (
            <button
              type="button"
              onClick={() => setSelectedCategory(null)}
              className="inline-flex shrink-0 items-center gap-1 text-sm text-muted hover:text-ink"
            >
              Clear filter <XIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {detailOpen ? (
          <div className="overflow-x-auto border-t border-white/10">
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
                    <td className="whitespace-nowrap">{r.date}</td>
                    <td>{categoryName(r.category)}</td>
                    <td>{r.item}</td>
                    <td className="text-right tabular-nums">{r.amount.toFixed(2)}</td>
                    <td>{payerLabel(r.payer)}</td>
                    <td>{splitLabel(r.split)}</td>
                  </tr>
                ))}
                {detailRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted">
                      No expenses in {selectedCategory === OTHER ? "other categories" : "this category"}.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
