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

/** "Remind me later" comes back on the next sign-in, or after this long. */
export const REMIND_LATER_MS = 24 * 60 * 60 * 1000;

export type IncomePrompt = "onboarding" | "popup" | "none";

/**
 * What to ask a user who has no income yet. New users onboard first;
 * existing users get a popup until they skip it, and "later" brings it back
 * on the next sign-in (or after REMIND_LATER_MS, since sessions last weeks).
 */
export function incomePromptFor(
  user: { incomePrompt: string | null; incomePromptAt: Date | null; lastSignInAt: Date | null },
  hasIncome: boolean,
  now: Date,
): IncomePrompt {
  if (hasIncome) return "none";
  switch (user.incomePrompt) {
    case "onboarding":
      return "onboarding";
    case "skipped":
      return "none";
    case "later": {
      const at = user.incomePromptAt?.getTime() ?? 0;
      const signedInSince = (user.lastSignInAt?.getTime() ?? 0) > at;
      return signedInSince || now.getTime() - at >= REMIND_LATER_MS ? "popup" : "none";
    }
    default:
      return "popup";
  }
}

/** Months an income change can apply from: this month and the `count` before it, newest first. */
export function incomeMonthOptions(currentMonth: string, count = 24): string[] {
  const [y, m] = currentMonth.split("-").map(Number);
  return Array.from({ length: count + 1 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
