import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getPendingInvitesForUser } from "@/lib/groups";
import { PendingInvites } from "@/components/PendingInvites";
import { HomeGroups } from "@/components/HomeGroups";
import {
  getGroupBalancesForUser,
  getPersonalMonthSpend,
} from "@/lib/balances";
import { SETTLE_EPS } from "@/lib/settlementMath";
import { formatINR, monthKey } from "@/lib/format";
import { PlusIcon } from "@/components/Icons";
import { AddExpenseButton } from "@/components/AddExpense";
import { getGroupSharesByMonth, getIncomeHistory } from "@/lib/income";
import { incomeForMonth, monthFinance, savingsPercent } from "@/lib/incomeMath";

// Splitwise-style dashboard: overall position, one card per group with
// per-member balances, a Personal card, and the Add-expense FAB.
export default async function HomePage() {
  const user = await requireUser();
  const thisMonth = monthKey(new Date());
  const [pending, balances, personal, incomeHistory, groupShares] = await Promise.all([
    getPendingInvitesForUser(user.email),
    getGroupBalancesForUser(user.email),
    getPersonalMonthSpend(user.email),
    getIncomeHistory(user.email),
    getGroupSharesByMonth(user.email, thisMonth),
  ]);
  const { overall, groups } = balances;
  const month = monthFinance(
    incomeForMonth(incomeHistory, thisMonth),
    personal.total,
    groupShares[thisMonth] ?? 0,
  );
  // Savings as a percent of income; the income itself is shown only on the
  // profile page, behind the eye button.
  const savedPct = savingsPercent(month.income, month.spent);
  const incomeSet = incomeHistory.length > 0;

  return (
    <div className="space-y-6 pb-24">
      <header className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {overall > SETTLE_EPS ? (
            <>
              Overall, you are owed{" "}
              <span className="text-emerald-400">{formatINR(overall)}</span>
            </>
          ) : overall < -SETTLE_EPS ? (
            <>
              Overall, you owe{" "}
              <span className="text-red-400">{formatINR(Math.abs(overall))}</span>
            </>
          ) : (
            "You are all settled up"
          )}
        </h1>
        <Link
          href="/groups"
          aria-label="Create or manage groups"
          title="Create or manage groups"
          className="icon-btn rounded-full border border-white/10"
        >
          <PlusIcon />
        </Link>
      </header>

      {pending.length > 0 ? <PendingInvites invites={pending} /> : null}

      <HomeGroups groups={groups} />

      <Link
        href="/g/personal"
        className="card block transition hover:border-white/20 hover:bg-white/5"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">Personal expenses</span>
          <span className="shrink-0 text-xs text-muted">{personal.month}</span>
        </div>
        <div className="mt-1 text-sm text-muted">
          {personal.count > 0 ? (
            <>
              <span className="font-medium text-ink">{formatINR(personal.total)}</span>{" "}
              spent this month across {personal.count} expense
              {personal.count === 1 ? "" : "s"}
            </>
          ) : (
            "Nothing spent this month yet"
          )}
        </div>
        <div className="mt-1 text-sm text-muted">
          {!incomeSet ? (
            "Add your monthly income on your profile to track savings"
          ) : savedPct === null ? null : (
            savedPct < 0 ? (
              <>
                Spent <span className="font-medium text-red-400">{-savedPct}% more</span> than your
                income this month, including {formatINR(month.groups)} in groups
              </>
            ) : (
              <>
                Saved <span className="font-medium text-emerald-400">{savedPct}%</span> of your income
                this month, after {formatINR(month.groups)} in groups
              </>
            )
          )}
        </div>
      </Link>

      {/* Floating Add-expense button, clear of the mobile bottom nav. */}
      <AddExpenseButton className="btn-primary fixed bottom-20 right-4 z-30 rounded-full px-5 py-3 shadow-lg shadow-black/40 md:bottom-8 md:right-8">
        + Add expense
      </AddExpenseButton>
    </div>
  );
}
