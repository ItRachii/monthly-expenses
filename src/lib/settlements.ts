import { prisma } from "./prisma";
import type { Context } from "./context";

export interface SettlementDTO {
  id: number;
  month: string;
  settledAt: string; // ISO
  settledBy: string;
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
    amount: r.amount,
    note: r.note,
  }));
}

export async function createSettlement(data: {
  month: string;
  settledBy: string;
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
      amount: data.amount,
      note: data.note,
      ownerEmail: data.ownerEmail,
      groupId: data.groupId,
    },
  });
}
