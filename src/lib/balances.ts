// Server-side "who owes whom, overall" computation for the Splitwise-style
// home screen and the group hero header. Outstanding = expense-derived debts
// minus recorded settlement payments, computed per month with the shared
// settlementMath and aggregated pair-wise across ALL months.

import { prisma } from "./prisma";
import { getUserGroups, getGroupParticipants } from "./groups";
import { buildWire, type Wire } from "./wire";
import { monthKey } from "./format";
import {
  SETTLE_EPS,
  applyPayments,
  computeNets,
  parseShares,
  round2,
  simplifyDebts,
  type ExpenseLike,
  type Transfer,
} from "./settlementMath";

/** One "X owes you ₹A" / "You owe X ₹A" line, client-safe (no emails). */
export interface BalanceLine {
  /** Wire key of the other member. */
  key: string;
  /** Display name of the other member. */
  name: string;
  amount: number;
  direction: "owes_you" | "you_owe";
}

export interface GroupBalance {
  id: string;
  name: string;
  memberCount: number;
  /** Your net across all months: positive = you are owed. */
  net: number;
  lines: BalanceLine[];
  settled: boolean;
}

/**
 * Outstanding transfers for a group across every month, aggregated per
 * (from, to) pair. Emails as ids — server-side only.
 */
export async function getOutstandingAllMonths(
  groupId: string,
  memberEmails: string[],
): Promise<Transfer[]> {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId },
      select: { date: true, payer: true, split: true, amount: true, shares: true },
    }),
    prisma.settlement.findMany({
      where: { groupId },
      orderBy: { settledAt: "asc" },
    }),
  ]);

  const byMonth = new Map<string, ExpenseLike[]>();
  for (const e of expenses) {
    const m = monthKey(e.date);
    const row = { ...e, shares: parseShares(e.shares) };
    const list = byMonth.get(m);
    if (list) list.push(row);
    else byMonth.set(m, [row]);
  }

  const remaining: Transfer[] = [];
  for (const [m, rows] of Array.from(byMonth.entries())) {
    const transfers = simplifyDebts(computeNets(rows, memberEmails));
    const pays = settlements
      .filter((s) => s.month === m)
      .map((s) => ({ from: s.settledBy, to: s.settledTo ?? null, amount: s.amount }));
    remaining.push(...applyPayments(transfers, pays));
  }

  // Aggregate the per-month leftovers into one line per debtor→creditor pair.
  const agg = new Map<string, Transfer>();
  for (const t of remaining) {
    const k = `${t.from}\n${t.to}`;
    const cur = agg.get(k);
    if (cur) cur.amount = round2(cur.amount + t.amount);
    else agg.set(k, { ...t });
  }
  return Array.from(agg.values()).filter((t) => t.amount > SETTLE_EPS);
}

/** Reduces outstanding transfers to lines relative to one user, masked. */
export function linesForUser(
  transfers: Transfer[],
  email: string,
  wire: Wire,
): { net: number; lines: BalanceLine[] } {
  const lines: BalanceLine[] = [];
  let net = 0;
  for (const t of transfers) {
    if (t.to === email) {
      net = round2(net + t.amount);
      const key = wire.toKey(t.from);
      lines.push({ key, name: wire.nameMap[key], amount: t.amount, direction: "owes_you" });
    } else if (t.from === email) {
      net = round2(net - t.amount);
      const key = wire.toKey(t.to);
      lines.push({ key, name: wire.nameMap[key], amount: t.amount, direction: "you_owe" });
    }
  }
  // Owed-to-you first, largest first — matches the home screen ordering.
  lines.sort((a, b) =>
    a.direction === b.direction ? b.amount - a.amount : a.direction === "owes_you" ? -1 : 1,
  );
  return { net, lines };
}

/** Every group of the user with their all-months balance, plus the overall net. */
export async function getGroupBalancesForUser(
  email: string,
): Promise<{ overall: number; groups: GroupBalance[] }> {
  const groups = await getUserGroups(email);
  const out: GroupBalance[] = [];
  let overall = 0;
  for (const g of groups) {
    const participants = await getGroupParticipants(g.id);
    const wire = buildWire(g.id, participants, email);
    const transfers = await getOutstandingAllMonths(
      g.id,
      participants.map((p) => p.email),
    );
    const { net, lines } = linesForUser(transfers, email, wire);
    overall = round2(overall + net);
    out.push({
      id: g.id,
      name: g.name,
      memberCount: participants.length,
      net,
      lines,
      settled: lines.length === 0,
    });
  }
  // Unsettled groups first, biggest balances on top.
  out.sort((a, b) =>
    a.settled === b.settled ? Math.abs(b.net) - Math.abs(a.net) : a.settled ? 1 : -1,
  );
  return { overall, groups: out };
}

/** Current-month personal spend, for the Personal card on the home screen. */
export async function getPersonalMonthSpend(
  email: string,
): Promise<{ month: string; total: number; count: number }> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const agg = await prisma.expense.aggregate({
    where: { ownerEmail: email, date: { gte: start, lt: end } },
    _sum: { amount: true },
    _count: true,
  });
  return {
    month: monthKey(now),
    total: round2(agg._sum.amount ?? 0),
    count: agg._count,
  };
}
