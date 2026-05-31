import { prisma } from "./prisma";
import { formatDate } from "./format";
import type { Context } from "./context";

export interface ExpenseDTO {
  id: number;
  date: string; // YYYY-MM-DD
  category: string;
  item: string;
  amount: number;
  payer: string;
  split: string;
}

function whereForContext(ctx: Context) {
  return ctx.kind === "personal"
    ? { ownerEmail: ctx.email }
    : { groupId: ctx.groupId };
}

export async function getExpenses(
  ctx: Context,
  order: "asc" | "desc" = "desc",
): Promise<ExpenseDTO[]> {
  const rows = await prisma.expense.findMany({
    where: whereForContext(ctx),
    orderBy: [{ date: order }, { id: order }],
  });
  return rows.map((r) => ({
    id: r.id,
    date: formatDate(r.date),
    category: r.category,
    item: r.item,
    amount: r.amount,
    payer: r.payer,
    split: r.split,
  }));
}

export async function createExpense(data: {
  date: string;
  category: string;
  item: string;
  amount: number;
  payer: string;
  split: string;
  ownerEmail: string | null;
  groupId: string | null;
}) {
  await prisma.expense.create({
    data: {
      date: new Date(`${data.date}T00:00:00.000Z`),
      category: data.category,
      item: data.item,
      amount: data.amount,
      payer: data.payer,
      split: data.split,
      ownerEmail: data.ownerEmail,
      groupId: data.groupId,
    },
  });
}

export async function deleteExpense(id: number) {
  await prisma.expense.deleteMany({ where: { id } });
}
