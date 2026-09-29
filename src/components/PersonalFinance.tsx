"use client";

import { formatINR } from "@/lib/format";
import { AddIncomeButton } from "@/components/IncomePrompt";
import { round2 } from "@/lib/settlementMath";

/**
 * Savings for the Personal screen. The income itself is not here: it stays
 * on the server and is shown only behind the eye button on the profile page.
 */
export interface FinanceData {
  /** YYYY-MM -> your share of every group's expenses that month. */
  groupShares: Record<string, number>;
  /** YYYY-MM -> what was saved as a whole-number percent of that month's income. */
  savingsPct: Record<string, number>;
  /** Whether a monthly income is set at all. */
  incomeSet: boolean;
  /** Server's current month, YYYY-MM. */
  currentMonth: string;
}

/** One month's spend (personal + groups) and savings as a percent of income. */
export interface MonthView {
  personal: number;
  groups: number;
  spent: number;
  /** Null when no income applies to the month. */
  savingsPct: number | null;
}

export function financeFor(
  finance: FinanceData,
  rows: { date: string; amount: number }[],
  month: string,
): MonthView {
  const personal = round2(rows.filter((r) => r.date.slice(0, 7) === month).reduce((s, r) => s + r.amount, 0));
  const groups = round2(finance.groupShares[month] ?? 0);
  return { personal, groups, spent: round2(personal + groups), savingsPct: finance.savingsPct[month] ?? null };
}

/** Hero card: this month's spend and what share of income is left over. */
export function FinanceCard({ f, incomeSet }: { f: MonthView; incomeSet: boolean }) {
  const negative = f.savingsPct !== null && f.savingsPct < 0;
  return (
    <div className="card space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Figure label="Spent">{formatINR(f.spent)}</Figure>
        <Figure label={negative ? "Overspent" : "Savings"}>
          {f.savingsPct === null ? (
            <span className="text-muted">-</span>
          ) : (
            <span className={negative ? "text-red-400" : "text-emerald-400"}>
              {Math.abs(f.savingsPct)}%
              <span className="ml-1 text-xs font-normal text-muted">of income</span>
            </span>
          )}
        </Figure>
      </div>
      {/* The split only means something when some of it came from groups. */}
      {f.groups > 0 ? (
        <p className="text-xs text-muted">
          This month: {formatINR(f.personal)} personal + {formatINR(f.groups)} your share in groups.
        </p>
      ) : null}
      {!incomeSet ? (
        // Highlighted until set: the popup is skippable, this is the way back.
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
          <p className="text-sm text-amber-200">
            Add your monthly income to see what you save each month.
          </p>
          <AddIncomeButton className="btn-primary shrink-0 px-3 py-1.5 text-sm">
            Add income
          </AddIncomeButton>
        </div>
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
