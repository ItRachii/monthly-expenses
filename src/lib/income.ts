// Monthly income storage and the "what you spent across groups" side of the
// savings figure. Server-side only (ids are user ids, never sent to clients).

import { prisma } from "./prisma";
import { getGroupParticipants, getUserGroups } from "./groups";
import { monthKey } from "./format";
import { parseShares, round2, shareFor } from "./settlementMath";
import { incomeForMonth, type IncomeEntry } from "./incomeMath";

/** Every income change for the user, oldest first. */
export async function getIncomeHistory(email: string): Promise<IncomeEntry[]> {
  const rows = await prisma.userIncome.findMany({
    where: { userEmail: email },
    orderBy: { effectiveMonth: "asc" },
    select: { effectiveMonth: true, amount: true },
  });
  return rows.map((r) => ({ month: r.effectiveMonth, amount: r.amount }));
}

/**
 * Sets the fixed monthly income from the current month on. Earlier months
 * keep the amount they had, so a raise never rewrites past savings.
 */
export async function setMonthlyIncome(email: string, amount: number): Promise<void> {
  const month = monthKey(new Date());
  const history = await getIncomeHistory(email);
  if (incomeForMonth(history, month) === amount) return;
  await prisma.userIncome.upsert({
    where: { userEmail_effectiveMonth: { userEmail: email, effectiveMonth: month } },
    create: { userEmail: email, effectiveMonth: month, amount },
    update: { amount },
  });
}

/**
 * Your share of group expenses per month (YYYY-MM -> rupees), across every
 * group you are in. The share is what you owe for each expense, not what you
 * paid: money you front for others comes back through settlements.
 */
export async function getGroupSharesByMonth(
  email: string,
  /** Limit to one month (YYYY-MM), e.g. the home screen's current month. */
  onlyMonth?: string,
): Promise<Record<string, number>> {
  let dateRange: { gte: Date; lt: Date } | undefined;
  if (onlyMonth) {
    const [y, m] = onlyMonth.split("-").map(Number);
    dateRange = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
  }
  const groups = await getUserGroups(email);
  const out: Record<string, number> = {};
  await Promise.all(
    groups.map(async (g) => {
      const [participants, expenses] = await Promise.all([
        getGroupParticipants(g.id),
        prisma.expense.findMany({
          where: { groupId: g.id, date: dateRange },
          select: { date: true, payer: true, split: true, amount: true, shares: true },
        }),
      ]);
      for (const e of expenses) {
        const share = shareFor(
          { ...e, shares: parseShares(e.shares) },
          email,
          participants.length,
        );
        if (share <= 0) continue;
        const m = monthKey(e.date);
        out[m] = (out[m] ?? 0) + share;
      }
    }),
  );
  for (const m of Object.keys(out)) out[m] = round2(out[m]);
  return out;
}
