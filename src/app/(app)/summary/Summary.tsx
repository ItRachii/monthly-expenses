"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, XIcon } from "@/components/Icons";
import type { ReactNode } from "react";
import type { ExpenseDTO } from "@/lib/expenses";
import { SPLIT_CUSTOM, SPLIT_EQUAL } from "@/lib/constants";
import { MonthSelect, monthLabel } from "@/components/MonthSelect";
import {
  ActiveFilters,
  DateRangeHeader,
  FilterHeader,
  SearchBox,
  SortHeader,
  Th,
  rangeLabel,
  sortRows,
  tableDate,
  useSort,
  type DateRange,
} from "@/components/table/Table";
import { PeopleIcon } from "@/components/Icons";
import { DateBadge } from "@/components/DateBadge";
import { PersonAvatar, PersonAvatars } from "@/components/Person";
import { paidFor, payersOf } from "@/lib/settlementMath";
import { formatINR } from "@/lib/format";
import { financeFor, type FinanceData } from "@/components/PersonalFinance";
import {
  CategoryBars,
  CategoryDonut,
  MonthlyTrend,
  OTHER,
  StatCard,
  buildPalette,
  categoryName,
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

interface Day {
  y: number;
  m: number;
  d: number;
}

function daysIn(month: string, today: Day): number {
  const [y, m] = month.split("-").map(Number);
  // The current month only counts the days that have happened so far.
  return today.y === y && today.m === m ? today.d : new Date(y, m, 0).getDate();
}

export function Summary({
  rows,
  finance = null,
  isPersonal,
  members,
  renderedAt,
}: {
  rows: ExpenseDTO[];
  /** Personal only: income and group shares, for the savings cards. */
  finance?: FinanceData | null;
  isPersonal: boolean;
  members: Member[];
  /** When the server rendered the page (ms), so the daily average is the same in its HTML and on the first render here. */
  renderedAt: number;
}) {
  // Which day it is: the server's (UTC) first, so hydration matches, then
  // this device's own, which can be a day later in India before 05:30.
  const [today, setToday] = useState<Day>(() => {
    const t = new Date(renderedAt);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  });
  useEffect(() => {
    const t = new Date();
    setToday({ y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() });
  }, []);
  // Personal also lists months with only group spending, and this month
  // once an income is set, so savings show before the first expense.
  const months = useMemo(() => {
    const set = new Set(rows.map((r) => r.date.slice(0, 7)));
    if (finance) {
      for (const m of Object.keys(finance.groupShares)) set.add(m);
      if (finance.incomeSet) set.add(finance.currentMonth);
    }
    return Array.from(set).sort().reverse();
  }, [rows, finance]);
  const palette = useMemo(() => buildPalette(rows), [rows]);

  const [month, setMonth] = useState(months[0] ?? "");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  if (months.length === 0) {
    return <div className="alert-info">No expenses recorded yet.</div>;
  }

  const selectedMonth = months.includes(month) ? month : months[0];
  const monthRows = rows.filter((r) => r.date.slice(0, 7) === selectedMonth);

  // Per-month series for the cards: the six months up to the selected one.
  const spark = monthsUpTo(months, selectedMonth, 6);
  const prevMonth = months[months.indexOf(selectedMonth) + 1] ?? null;
  // Sums a per-row value over a month: the amount, or one member's part of it.
  const sumWhere = (m: string, value: (r: ExpenseDTO) => number = (r) => r.amount) =>
    rows.filter((r) => r.date.slice(0, 7) === m).reduce((s, r) => s + value(r), 0);
  const series = (value?: (r: ExpenseDTO) => number) => ({
    value: sumWhere(selectedMonth, value),
    history: spark.map((m) => sumWhere(m, value)),
    previous: prevMonth ? sumWhere(prevMonth, value) : null,
  });
  const countIn = (m: string) => rows.filter((r) => r.date.slice(0, 7) === m).length;
  const dailyAvg = (m: string) => sumWhere(m) / daysIn(m, today);
  const fin = (m: string) => (finance ? financeFor(finance, rows, m) : null);
  const finSeries = (pick: (m: string) => number | null | undefined) => ({
    value: pick(selectedMonth) ?? 0,
    history: spark.map((m) => pick(m) ?? 0),
    previous: prevMonth ? pick(prevMonth) ?? 0 : null,
  });

  // A donut/legend selection filters the detail; "Other" means every
  // category outside the named seven.
  const matches = (r: ExpenseDTO) =>
    !selectedCategory || palette.bucket(r.category) === selectedCategory;
  const detailRows = monthRows.filter(matches);

  const splitLabel = (v: string) =>
    v === SPLIT_EQUAL ? "Equal Split" : v === SPLIT_CUSTOM ? "Unequal split" : <PersonAvatar id={v} />;

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

      {/* Quick summary cards: two per row even on phones, so the charts are
          not four full screens down. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
            {finance ? (
              <>
                {/* Only when there is group spending to show; a card of ₹0s is noise. */}
                {[selectedMonth, ...spark].some((m) => (fin(m)?.groups ?? 0) > 0) ? (
                  <StatCard
                    title="Your share in groups"
                    tone="spend"
                    {...finSeries((m) => fin(m)?.groups)}
                  />
                ) : null}
                {fin(selectedMonth)?.savingsPct != null ? (
                  <StatCard
                    title="Savings, % of income"
                    tone="gain"
                    unit="percent"
                    {...finSeries((m) => fin(m)?.savingsPct)}
                  />
                ) : finance.incomeSet ? null : (
                  <Link href="/profile" className="card col-span-2 flex items-center text-sm text-primary hover:underline lg:col-span-1">
                    Add your monthly income to see savings
                  </Link>
                )}
              </>
            ) : null}
          </>
        ) : (
          members.map((m) => (
            <StatCard
              key={m.key}
              title={`${m.displayName} paid`}
              tone="neutral"
              {...series((r) => paidFor(r, m.key))}
            />
          ))
        )}
      </div>

      {/* Personal months can hold only group spending: nothing to chart. */}
      {monthRows.length === 0 ? (
        <div className="alert-info">No personal expenses in {monthLabel(selectedMonth)}.</div>
      ) : (
        <>
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
                className="-my-2 flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 text-left"
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
                  {detailRows.length} in {monthLabel(selectedMonth)}
                </span>
              </button>
              {selectedCategory ? (
                <button
                  type="button"
                  onClick={() => setSelectedCategory(null)}
                  className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-1 py-2 text-sm text-muted hover:text-ink"
                >
                  Clear filter <XIcon className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            {detailOpen ? (
              <ExpenseDetail
                rows={monthRows}
                bucket={(r) => palette.bucket(r.category)}
                category={selectedCategory}
                onCategory={setSelectedCategory}
                isPersonal={isPersonal}
                members={members}
                splitLabel={splitLabel}
              />
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

type DetailKey = "date" | "item" | "category" | "amount";

/**
 * The month's expenses, styled and filtered like the expense list: count
 * and total of what is shown, a search, and filters in the column headings
 * (a date range, the category, who paid), each shown as a chip above the
 * table. The category filter is the donut's selection, so picking either
 * moves both. Read only: no edit or delete here. Desktop has the table;
 * phones the expense list's compact rows.
 */
function ExpenseDetail({
  rows,
  bucket,
  category,
  onCategory,
  isPersonal,
  members,
  splitLabel,
}: {
  rows: ExpenseDTO[];
  /** The chart's category for a row: a named one, or "Other". */
  bucket: (r: ExpenseDTO) => string;
  category: string | null;
  onCategory: (c: string | null) => void;
  isPersonal: boolean;
  members: Member[];
  splitLabel: (v: string) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [sort, onSort] = useSort<DetailKey>({ key: "date", dir: "desc" }, ["date", "amount"]);
  const [payer, setPayer] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);

  const days = rows.map((r) => r.date).sort();
  const nameOf = (k: string) => members.find((m) => m.key === k)?.displayName ?? k;
  const q = query.trim().toLowerCase();
  const shown = sortRows(
    rows.filter(
      (r) =>
        (!category || bucket(r) === category) &&
        (!payer || payersOf(r).includes(payer)) &&
        (!range?.from || r.date >= range.from) &&
        (!range?.to || r.date <= range.to) &&
        (!q ||
          r.item.toLowerCase().includes(q) ||
          categoryName(r.category).toLowerCase().includes(q) ||
          payersOf(r).some((k) => nameOf(k).toLowerCase().includes(q))),
    ),
    sort,
    (r, k) => (k === "date" ? r.date : k === "amount" ? r.amount : k === "category" ? categoryName(r.category) : r.item),
  );
  const total = shown.reduce((t, r) => t + r.amount, 0);
  const filtered = Boolean(category || payer || range);

  return (
    <div className="space-y-3 border-t border-ink/10 p-4">
      {/* Toolbar: count and total of what is shown, and the search. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-muted" aria-live="polite">
          {shown.length} expense{shown.length === 1 ? "" : "s"} · <span className="font-semibold text-ink">{formatINR(total)}</span>
        </span>
        <SearchBox value={query} onChange={setQuery} placeholder="Search expenses" className="w-full sm:ml-auto sm:w-64" />
      </div>

      <ActiveFilters
        filters={[
          range ? { label: `Date: ${rangeLabel(range)}`, onClear: () => setRange(null) } : null,
          category ? { label: `Category: ${category}`, onClear: () => onCategory(null) } : null,
          payer ? { label: `Paid by: ${nameOf(payer)}`, onClear: () => setPayer(null) } : null,
        ]}
        onClearAll={() => {
          setRange(null);
          onCategory(null);
          setPayer(null);
        }}
      />

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {q
            ? `No expenses match "${query.trim()}".`
            : filtered
              ? category === OTHER && !payer && !range
                ? "No expenses in other categories."
                : "No expenses match these filters."
              : "No expenses here."}
        </p>
      ) : (
        <>
          {/* Desktop: the table. */}
          <div className="hidden overflow-x-auto rounded-xl border border-ink/10 md:block">
            <table className="list-table">
              <thead>
                <tr>
                  <DateRangeHeader label="Date" value={range} onChange={setRange} min={days[0] ?? ""} max={days[days.length - 1] ?? ""} sort={{ sortKey: "date", sort, onSort }} className="w-28" />
                  <FilterHeader
                    label="Category"
                    allLabel="All categories"
                    options={Array.from(new Set(rows.map(bucket)))
                      .sort((a, b) => (a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b)))
                      .map((c) => ({ value: c, label: c }))}
                    value={category}
                    onChange={onCategory}
                    sort={{ sortKey: "category" as DetailKey, sort, onSort }}
                    className="w-36"
                  />
                  <SortHeader label="Item" sortKey="item" sort={sort} onSort={onSort} />
                  <SortHeader label="Amount" sortKey="amount" sort={sort} onSort={onSort} align="right" className="w-28" />
                  {isPersonal ? (
                    <Th className="w-28">Payer</Th>
                  ) : (
                    <FilterHeader
                      label="Payer"
                      allLabel="Everyone"
                      allIcon={
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink/[0.08] text-muted">
                          <PeopleIcon className="h-4 w-4" />
                        </span>
                      }
                      options={members.map((m) => ({ value: m.key, label: m.displayName, icon: <PersonAvatar id={m.key} interactive={false} /> }))}
                      value={payer}
                      onChange={setPayer}
                      className="w-28"
                    />
                  )}
                  <Th className="w-32">Split</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="hover:bg-ink/[0.03]">
                    <td className="whitespace-nowrap text-muted">{tableDate(r.date)}</td>
                    <td className="truncate text-muted">{categoryName(r.category)}</td>
                    <td className="max-w-0">
                      <span className="block truncate font-semibold" title={r.item}>
                        {r.item}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatINR(r.amount)}</td>
                    <td>
                      <PersonAvatars ids={payersOf(r)} />
                    </td>
                    <td className="text-muted">{splitLabel(r.split)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: the expense list's compact rows. */}
          <div className="divide-y divide-ink/5 rounded-xl border border-ink/10 md:hidden">
            {shown.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <DateBadge iso={r.date} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.item}</div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted">
                    <span className="min-w-0 truncate">{categoryName(r.category)}</span>
                    <span className="shrink-0">·</span>
                    <span className="shrink-0">{splitLabel(r.split)}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums">{formatINR(r.amount)}</div>
                  <div className="mt-0.5 flex justify-end">
                    <PersonAvatars ids={payersOf(r)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
