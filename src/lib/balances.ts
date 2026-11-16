// Server-side "who owes whom, overall" for the Splitwise-style home screen
// and the group hero header: every expense minus every recorded payment,
// netted across the group's whole history (getOutstandingTransfers).

import { prisma } from "./prisma";
import { getUserGroups, getGroupParticipants } from "./groups";
import { buildWire, type Wire } from "./wire";
import { monthKey } from "./format";
import { getOutstandingTransfers } from "./settlements";
import { round2, type Transfer } from "./settlementMath";

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

/** Outstanding transfers for a group, all time. Emails as ids: server-side only. */
export function getOutstandingAllMonths(groupId: string, memberEmails: string[]): Promise<Transfer[]> {
  return getOutstandingTransfers(groupId, memberEmails);
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
