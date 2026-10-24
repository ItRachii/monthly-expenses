import { randomUUID } from "crypto";
import { prisma, type Db } from "./prisma";

export interface NewReceiptItem {
  description: string;
  category: string;
  amount: number;
  gstRate: number | null;
  gstAmount: number | null;
}

/**
 * Creates a receipt header plus one expense row per line item, in a single
 * transaction. The line items are ordinary expenses (so they count in every
 * report); the receipt row is just the grouping header and carries no money.
 */
export async function createReceiptWithItems(data: {
  merchant: string;
  purchasedOn: string; // YYYY-MM-DD
  total: number;
  ownerEmail: string | null;
  groupId: string | null;
  createdBy: string;
  payer: string;
  split: string;
  items: NewReceiptItem[];
}): Promise<string> {
  const id = randomUUID();
  const date = new Date(`${data.purchasedOn}T00:00:00.000Z`);
  await prisma.$transaction([
    prisma.receipt.create({
      data: {
        id,
        merchant: data.merchant,
        total: data.total,
        purchasedOn: date,
        ownerEmail: data.ownerEmail,
        groupId: data.groupId,
        createdBy: data.createdBy,
      },
    }),
    prisma.expense.createMany({
      data: data.items.map((it) => ({
        date,
        category: it.category,
        item: it.description,
        amount: it.amount,
        payer: data.payer,
        split: data.split,
        ownerEmail: data.ownerEmail,
        groupId: data.groupId,
        receiptId: id,
        gstRate: it.gstRate,
        gstAmount: it.gstAmount,
      })),
    }),
  ]);
  return id;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Keeps receipt headers in line after their items change. `changes` maps a
 * receipt id to how much its saved items moved (negative for a delete). A
 * header with no items left is removed; the others have their total moved by
 * the same amount, so it stays the printed total less what was dropped.
 */
export async function settleReceipts(db: Db, changes: Map<string, number>): Promise<void> {
  for (const [id, delta] of changes) {
    if ((await db.expense.count({ where: { receiptId: id } })) === 0) {
      await db.receipt.deleteMany({ where: { id } });
      continue;
    }
    if (!delta) continue;
    const header = await db.receipt.findUnique({ where: { id }, select: { total: true } });
    if (header) await db.receipt.update({ where: { id }, data: { total: Math.max(0, round2(header.total + delta)) } });
  }
}

/**
 * Renames a receipt and moves it to another day: the header, and every item
 * under it, so the receipt reads as one purchase. Returns whether anything
 * changed, and the ids of its items.
 */
export async function updateReceiptDetails(
  id: string,
  merchant: string,
  date: string, // YYYY-MM-DD
): Promise<{ changed: boolean; itemIds: number[] }> {
  const day = new Date(`${date}T00:00:00.000Z`);
  return prisma.$transaction(async (tx) => {
    const header = await tx.receipt.findUnique({ where: { id }, select: { merchant: true, purchasedOn: true } });
    const items = await tx.expense.findMany({ where: { receiptId: id }, select: { id: true, date: true } });
    const same =
      header?.merchant === merchant &&
      header.purchasedOn?.getTime() === day.getTime() &&
      items.every((i) => i.date.getTime() === day.getTime());
    if (!same) {
      await tx.receipt.update({ where: { id }, data: { merchant, purchasedOn: day } });
      await tx.expense.updateMany({ where: { receiptId: id }, data: { date: day } });
    }
    return { changed: !same, itemIds: items.map((i) => i.id) };
  });
}
