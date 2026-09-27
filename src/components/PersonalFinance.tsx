"use client";

import Link from "next/link";
import { formatINR } from "@/lib/format";
import { incomeForMonth, monthFinance, type IncomeEntry, type MonthFinance } from "@/lib/incomeMath";

/** Income plus your share of group spending, for the Personal screen. */
export interface FinanceData {
  /** Income changes, oldest first. */
  incomeHistory: IncomeEntry[];
  /** YYYY-MM -> your share of every group's expenses that month. */
  groupShares: Record<string, number>;
  /** Server's current month, YYYY-MM. */
  currentMonth: string;
}

/** One month's income, spend (personal + groups) and savings. */
export function financeFor(
  finance: FinanceData,
  rows: { date: string; amount: number }[],
  month: string,
): MonthFinance {
  const personal = rows
    .filter((r) => r.date.slice(0, 7) === month)
    .reduce((s, r) => s + r.amount, 0);
  return monthFinance(
    incomeForMonth(finance.incomeHistory, month),
    personal,
    finance.groupShares[month] ?? 0,
  );
}

/** Hero card: this month's income, total spend and what is left over. */
export function FinanceCard({ f }: { f: MonthFinance }) {
  const negative = f.savings !== null && f.savings < 0;
  return (
    <div className="card space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Figure label="Income">
          {f.income !== null ? formatINR(f.income) : <span className="text-muted">Not set</span>}
        </Figure>
        <Figure label="Spent">{formatINR(f.spent)}</Figure>
        <Figure label={negative ? "Overspent" : "Savings"}>
          {f.savings === null ? (
            <span className="text-muted">-</span>
          ) : (
            <span className={negative ? "text-red-400" : "text-emerald-400"}>
              {formatINR(Math.abs(f.savings))}
            </span>
          )}
        </Figure>
      </div>
      <p className="text-xs text-muted">
        This month: {formatINR(f.personal)} personal + {formatINR(f.groups)} your share in groups.
      </p>
      {f.income === null ? (
        <Link href="/profile" className="block text-sm text-primary hover:underline">
          Add your monthly income to track savings
        </Link>
      ) : null}
    </div>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className="truncate text-base font-semibold tabular-nums sm:text-lg">{children}</div>
    </div>
  );
}
