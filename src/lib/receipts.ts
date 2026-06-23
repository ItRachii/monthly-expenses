import { randomUUID } from "crypto";
import { prisma } from "./prisma";

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
