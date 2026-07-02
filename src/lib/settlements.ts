import { prisma } from "./prisma";
import type { Context } from "./context";
import {
  applyPayments,
  computeNets,
  simplifyDebts,
  type Transfer,
} from "./settlementMath";

export interface SettlementDTO {
  id: number;
  month: string;
  settledAt: string; // ISO
  settledBy: string;
  /** Who received the payment; null on legacy rows recorded without one. */
  settledTo: string | null;
  amount: number;
  note: string | null;
}

export async function getSettlements(ctx: Context): Promise<SettlementDTO[]> {
  const where =
    ctx.kind === "personal" ? { ownerEmail: ctx.email } : { groupId: ctx.groupId };
  const rows = await prisma.settlement.findMany({
    where,
    orderBy: { settledAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    month: r.month,
    settledAt: r.settledAt.toISOString(),
    settledBy: r.settledBy,
    settledTo: r.settledTo ?? null,
    amount: r.amount,
    note: r.note,
  }));
}

export async function createSettlement(data: {
  month: string;
  settledBy: string;
  settledTo: string | null;
  amount: number;
  note: string | null;
  ownerEmail: string | null;
  groupId: string | null;
}) {
  await prisma.settlement.create({
    data: {
      month: data.month,
      settledAt: new Date(),
      settledBy: data.settledBy,
      settledTo: data.settledTo,
      amount: data.amount,
      note: data.note,
      ownerEmail: data.ownerEmail,
      groupId: data.groupId,
    },
  });
}

/**
 * What is still owed, pair-wise, for a group's month: expense-derived
 * transfers minus every settlement payment recorded so far. Used by the
 * settle action to reject overpayments server-side.
 */
export async function getOutstandingTransfers(
  groupId: string,
  month: string, // YYYY-MM
  memberEmails: string[],
): Promise<Transfer[]> {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));

  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId, date: { gte: start, lt: end } },
      select: { payer: true, split: true, amount: true },
    }),
    prisma.settlement.findMany({
      where: { groupId, month },
      orderBy: { settledAt: "asc" },
    }),
  ]);

  const transfers = simplifyDebts(computeNets(expenses, memberEmails));
  return applyPayments(
    transfers,
    settlements.map((s) => ({
      from: s.settledBy,
      to: s.settledTo ?? null,
      amount: s.amount,
    })),
  );
}
