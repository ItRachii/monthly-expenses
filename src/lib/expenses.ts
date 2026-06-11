import { prisma } from "./prisma";
import { formatDate, formatINR } from "./format";
import { SPLIT_EQUAL } from "./constants";
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

/** Distinct, non-empty categories already used in this context's expenses. */
export async function getUsedCategories(ctx: Context): Promise<string[]> {
  const rows = await prisma.expense.findMany({
    where: whereForContext(ctx),
    select: { category: true },
    distinct: ["category"],
  });
  return rows.map((r) => r.category).filter((c) => c && c.trim());
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

export async function updateExpense(
  id: number,
  data: {
    date: string;
    category: string;
    item: string;
    amount: number;
    payer: string;
    split: string;
  },
) {
  await prisma.expense.update({
    where: { id },
    data: {
      date: new Date(`${data.date}T00:00:00.000Z`),
      category: data.category,
      item: data.item,
      amount: data.amount,
      payer: data.payer,
      split: data.split,
    },
  });
}

export async function deleteExpense(id: number) {
  await prisma.expense.deleteMany({ where: { id } });
}

// ---- Change Data Capture ---------------------------------------------------
// Rows are written by the `expenses_capture_changes` Postgres trigger into the
// `expense_changes` audit table on every insert/update/delete of an expense.

export interface ExpenseChangeDTO {
  id: number;
  operation: "INSERT" | "UPDATE" | "DELETE";
  item: string;
  summary: string;
  when: string; // relative, e.g. "2h ago"
  changedAt: string; // ISO, for the tooltip
}

type ExpenseRowJson = {
  date: string;
  category: string;
  item: string;
  amount: number;
  payer: string;
  split: string;
  owner_email: string | null;
  group_id: string | null;
};

interface RawChange {
  id: bigint | number;
  operation: string;
  old_data: ExpenseRowJson | null;
  new_data: ExpenseRowJson | null;
  changed_at: Date;
}

function timeAgo(d: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

function changeSummary(
  op: string,
  oldRow: ExpenseRowJson | null,
  newRow: ExpenseRowJson | null,
  nameMap: Record<string, string>,
): { item: string; summary: string } {
  const nm = (v: string) => nameMap[v] ?? v;
  const splitLabel = (v: string) => (v === SPLIT_EQUAL ? "Equal Split" : nm(v));

  if (op === "INSERT" && newRow) {
    return {
      item: newRow.item,
      summary: `Added "${newRow.item}" (${formatINR(newRow.amount)})`,
    };
  }
  if (op === "DELETE" && oldRow) {
    return {
      item: oldRow.item,
      summary: `Deleted "${oldRow.item}" (${formatINR(oldRow.amount)})`,
    };
  }
  if (oldRow && newRow) {
    const parts: string[] = [];
    if (oldRow.item !== newRow.item)
      parts.push(`item "${oldRow.item}" → "${newRow.item}"`);
    if (oldRow.amount !== newRow.amount)
      parts.push(`amount ${formatINR(oldRow.amount)} → ${formatINR(newRow.amount)}`);
    if (oldRow.category !== newRow.category)
      parts.push(`category ${oldRow.category} → ${newRow.category}`);
    if (oldRow.date !== newRow.date)
      parts.push(`date ${oldRow.date} → ${newRow.date}`);
    if (oldRow.payer !== newRow.payer)
      parts.push(`payer ${nm(oldRow.payer)} → ${nm(newRow.payer)}`);
    if (oldRow.split !== newRow.split)
      parts.push(`split ${splitLabel(oldRow.split)} → ${splitLabel(newRow.split)}`);
    return {
      item: newRow.item,
      summary: parts.length
        ? `Edited "${newRow.item}": ${parts.join("; ")}`
        : `Edited "${newRow.item}"`,
    };
  }
  return { item: "", summary: "Changed" };
}

export async function getRecentExpenseChanges(
  ctx: Context,
  nameMap: Record<string, string>,
  limit = 8,
): Promise<ExpenseChangeDTO[]> {
  const rows =
    ctx.kind === "personal"
      ? await prisma.$queryRaw<RawChange[]>`
          select id, operation, old_data, new_data, changed_at
          from expense_changes
          where coalesce(new_data->>'owner_email', old_data->>'owner_email') = ${ctx.email}
            and coalesce(new_data->>'group_id', old_data->>'group_id') is null
          order by changed_at desc
          limit ${limit}`
      : await prisma.$queryRaw<RawChange[]>`
          select id, operation, old_data, new_data, changed_at
          from expense_changes
          where coalesce(new_data->>'group_id', old_data->>'group_id') = ${ctx.groupId}
          order by changed_at desc
          limit ${limit}`;

  return rows.map((r) => {
    const { item, summary } = changeSummary(
      r.operation,
      r.old_data,
      r.new_data,
      nameMap,
    );
    return {
      id: Number(r.id),
      operation: r.operation as ExpenseChangeDTO["operation"],
      item,
      summary,
      when: timeAgo(r.changed_at),
      changedAt: r.changed_at.toISOString(),
    };
  });
}
