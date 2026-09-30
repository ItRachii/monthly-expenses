import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { formatDate, formatINR } from "./format";
import { PAYER_MULTIPLE, SPLIT_CUSTOM, SPLIT_EQUAL, canonicalCategory, mergeCategories } from "./constants";
import { parseShares, type Shares } from "./settlementMath";
import type { Context } from "./context";
import { pendingFlagsFor } from "./loans";

export interface ExpenseDTO {
  id: number;
  date: string; // YYYY-MM-DD
  category: string;
  item: string;
  amount: number;
  payer: string;
  split: string;
  /** Per-participant amounts when split = SPLIT_CUSTOM, else null. */
  shares: Shares | null;
  /** What each person put in when payer = PAYER_MULTIPLE, else null. */
  payers: Shares | null;
  // Receipt-scan metadata (null for manually added expenses).
  receiptId: string | null;
  receiptMerchant: string | null;
  gstRate: number | null;
  gstAmount: number | null;
  /**
   * Why the row needs attention, in plain words, or null. Set while a GST
   * charge from a card statement cites an instalment not yet on record.
   */
  flag: string | null;
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

/**
 * Maps user-entered categories onto the ones already in use in this context
 * (plus the standard set), so a differently cased or pluralised variant can
 * never be stored as a new category.
 */
export async function canonicalCategoriesFor(
  ctx: Context,
  names: string[],
): Promise<string[]> {
  const known = mergeCategories(await getUsedCategories(ctx));
  return names.map((n) => canonicalCategory(n, known));
}

export async function getExpenses(
  ctx: Context,
  order: "asc" | "desc" = "desc",
): Promise<ExpenseDTO[]> {
  const rows = await prisma.expense.findMany({
    where: whereForContext(ctx),
    orderBy: [{ date: order }, { id: order }],
    include: { receipt: { select: { merchant: true } } },
  });
  const flags = await pendingFlagsFor(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    date: formatDate(r.date),
    category: r.category,
    item: r.item,
    amount: r.amount,
    payer: r.payer,
    split: r.split,
    shares: r.split === SPLIT_CUSTOM ? parseShares(r.shares) : null,
    payers: r.payer === PAYER_MULTIPLE ? parseShares(r.payers) : null,
    receiptId: r.receiptId,
    receiptMerchant: r.receipt?.merchant ?? null,
    gstRate: r.gstRate,
    gstAmount: r.gstAmount,
    flag: flags.get(r.id) ?? null,
  }));
}

export async function createExpense(data: {
  date: string;
  category: string;
  item: string;
  amount: number;
  payer: string;
  split: string;
  shares: Shares | null;
  payers?: Shares | null;
  ownerEmail: string | null;
  groupId: string | null;
  /** The card statement the row was imported from. */
  statementId?: number | null;
}): Promise<{ id: number }> {
  return prisma.expense.create({
    select: { id: true },
    data: {
      date: new Date(`${data.date}T00:00:00.000Z`),
      category: data.category,
      item: data.item,
      amount: data.amount,
      payer: data.payer,
      split: data.split,
      shares: data.shares ?? Prisma.DbNull,
      payers: data.payers ?? Prisma.DbNull,
      ownerEmail: data.ownerEmail,
      groupId: data.groupId,
      statementId: data.statementId ?? null,
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
    shares: Shares | null;
    payers: Shares | null;
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
      shares: data.shares ?? Prisma.DbNull,
      payers: data.payers ?? Prisma.DbNull,
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
  shares?: unknown;
  payers?: unknown;
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
  const nm = (v: string) => (v === PAYER_MULTIPLE ? "several people" : nameMap[v] ?? v);
  const splitLabel = (v: string) =>
    v === SPLIT_EQUAL ? "Equal Split" : v === SPLIT_CUSTOM ? "Unequal split" : nm(v);

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
    else if (
      newRow.payer === PAYER_MULTIPLE &&
      JSON.stringify(oldRow.payers ?? null) !== JSON.stringify(newRow.payers ?? null)
    )
      parts.push("who paid what changed");
    if (oldRow.split !== newRow.split)
      parts.push(`split ${splitLabel(oldRow.split)} → ${splitLabel(newRow.split)}`);
    else if (
      newRow.split === SPLIT_CUSTOM &&
      JSON.stringify(oldRow.shares ?? null) !== JSON.stringify(newRow.shares ?? null)
    )
      parts.push("unequal shares changed");
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
