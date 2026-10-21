import { Prisma } from "@prisma/client";
import { prisma, type Db } from "./prisma";
import { formatDate } from "./format";
import { PAYER_MULTIPLE, SPLIT_CUSTOM, canonicalCategory, mergeCategories } from "./constants";
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
  /** Keyed hash of that statement row (see statementDuplicates). */
  importKey?: string | null;
}, db: Db = prisma): Promise<{ id: number }> {
  return db.expense.create({
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
      importKey: data.importKey ?? null,
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
