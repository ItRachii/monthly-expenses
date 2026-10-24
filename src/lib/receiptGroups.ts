// Folds the line items of one scanned receipt into a single entry for the
// expenses list. Display only: each item stays its own expense in the
// database, so categories, splits and balances keep working per item.

import type { Placed } from "./landing";

export type ReceiptGroup<T> = { receiptId: string; items: T[] };

export type Listed<T, G> =
  | { row: T; ghost?: undefined; group?: undefined }
  | { ghost: G; row?: undefined; group?: undefined }
  | { group: ReceiptGroup<T>; row?: undefined; ghost?: undefined };

/**
 * Groups the rows on show by receipt, at the place of the receipt's first
 * row in the current order. A receipt with only one row on show (the rest
 * filtered out or deleted) stays a plain row.
 */
export function groupReceipts<T extends { receiptId: string | null }, G>(placed: Placed<T, G>[]): Listed<T, G>[] {
  const byReceipt = new Map<string, T[]>();
  for (const p of placed) {
    if (p.row?.receiptId) byReceipt.set(p.row.receiptId, [...(byReceipt.get(p.row.receiptId) ?? []), p.row]);
  }
  const out: Listed<T, G>[] = [];
  const done = new Set<string>();
  for (const p of placed) {
    const id = p.row?.receiptId;
    const items = id ? byReceipt.get(id)! : [];
    if (!id || items.length < 2) {
      out.push(p);
      continue;
    }
    if (done.has(id)) continue;
    done.add(id);
    out.push({ group: { receiptId: id, items } });
  }
  return out;
}
