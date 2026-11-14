import { prisma, type Db } from "./prisma";
import type { Context } from "./context";
import { outstandingAllTime, parseShares, type Transfer } from "./settlementMath";

export interface SettlementDTO {
  id: number;
  /** The month it was recorded against, on payments from before balances
   * went all-time; null on newer ones. */
  month: string | null;
  settledAt: string; // ISO
  settledBy: string;
  /** Who received the payment; null on legacy rows recorded without one. */
  settledTo: string | null;
  amount: number;
  note: string | null;
}

/** The day (YYYY-MM-DD, India time) a payment was recorded. */
export function settledDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
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
  month: string | null;
  settledBy: string;
  settledTo: string | null;
  amount: number;
  note: string | null;
  ownerEmail: string | null;
  groupId: string | null;
}, db: Db = prisma): Promise<{ id: number }> {
  return db.settlement.create({
    select: { id: true },
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
 * What is still owed, pair-wise, across the group's whole history: every
 * expense minus every payment, netted per person (outstandingAllTime). The
 * same figure the group header, the home screen and the Balances tab show;
 * the settle action checks payments against it.
 */
export async function getOutstandingTransfers(
  groupId: string,
  memberEmails: string[],
  db: Db = prisma,
): Promise<Transfer[]> {
  const [expenses, settlements] = await Promise.all([
    db.expense.findMany({
      where: { groupId },
      select: { payer: true, split: true, amount: true, shares: true, payers: true },
    }),
    db.settlement.findMany({
      where: { groupId },
      orderBy: { settledAt: "asc" },
    }),
  ]);
  return outstandingAllTime(
    expenses.map((e) => ({ ...e, shares: parseShares(e.shares), payers: parseShares(e.payers) })),
    memberEmails,
    settlements.map((s) => ({ from: s.settledBy, to: s.settledTo ?? null, amount: s.amount })),
  );
}
