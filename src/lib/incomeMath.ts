// Pure income/savings math shared by server pages and client components.
// Must stay free of server-only and client-only imports.

import { round2 } from "./settlementMath";

/** One income change: `amount` applies from `month` (YYYY-MM) onwards. */
export interface IncomeEntry {
  month: string;
  amount: number;
}

/**
 * Income for a month: the latest entry on or before it. Months before the
 * first entry use the first amount, so setting an income for the first time
 * also covers the history already in the app. Null when no income is set.
 * `history` must be sorted oldest first.
 */
export function incomeForMonth(history: IncomeEntry[], month: string): number | null {
  if (history.length === 0) return null;
  let amount = history[0].amount;
  for (const e of history) {
    if (e.month > month) break;
    amount = e.amount;
  }
  return amount;
}

export interface MonthFinance {
  income: number | null;
  /** Personal expenses in the month. */
  personal: number;
  /** Your share of every group's expenses in the month. */
  groups: number;
  spent: number;
  /** income - spent; null when no income is set. */
  savings: number | null;
}

export function monthFinance(income: number | null, personal: number, groups: number): MonthFinance {
  const spent = round2(personal + groups);
  return {
    income,
    personal: round2(personal),
    groups: round2(groups),
    spent,
    savings: income === null ? null : round2(income - spent),
  };
}
