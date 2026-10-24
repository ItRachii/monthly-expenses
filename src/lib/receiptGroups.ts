// Folds the line items of one scanned receipt into a single entry for the
// expenses list. Display only: each item stays its own expense in the
// database, so categories, splits and balances keep working per item.
//
// Grouping happens before sorting: a group has its own date, total, category
// and name, and sorts by those, so the row reads in the order it is placed.

export interface GroupableExpense {
  id: number;
  date: string;
  amount: number;
  item: string;
  category: string;
  receiptId: string | null;
  receiptMerchant: string | null;
}

export type ReceiptGroup<T> = {
  receiptId: string;
  /** In the receipt's own (scan) order, whatever the list is sorted by. */
  items: T[];
  merchant: string;
  /** The latest of its items' dates: shown, and sorted by. */
  date: string;
  total: number;
  /** The one category, or "N categories". */
  category: string;
};

export type Entry<T> =
  | { date: string; amount: number; row: T; group?: undefined }
  | { date: string; amount: number; group: ReceiptGroup<T>; row?: undefined };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The rows on show as list entries, a receipt's rows folded into one at the
 * place of its first row. A receipt with only one row on show (the rest
 * filtered out or deleted) stays a plain row.
 */
export function groupReceipts<T extends GroupableExpense>(rows: T[]): Entry<T>[] {
  const byReceipt = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.receiptId) continue;
    const items = byReceipt.get(r.receiptId);
    if (items) items.push(r);
    else byReceipt.set(r.receiptId, [r]);
  }
  const out: Entry<T>[] = [];
  const done = new Set<string>();
  for (const r of rows) {
    const items = r.receiptId ? byReceipt.get(r.receiptId)! : [];
    if (!r.receiptId || items.length < 2) {
      out.push({ date: r.date, amount: r.amount, row: r });
      continue;
    }
    if (done.has(r.receiptId)) continue;
    done.add(r.receiptId);
    const sorted = [...items].sort((a, b) => a.id - b.id);
    const categories = Array.from(new Set(sorted.map((i) => i.category || "Uncategorised")));
    const group: ReceiptGroup<T> = {
      receiptId: r.receiptId,
      items: sorted,
      merchant: sorted[0].receiptMerchant || "Scanned receipt",
      date: sorted.reduce((d, i) => (i.date > d ? i.date : d), sorted[0].date),
      total: round2(sorted.reduce((s, i) => s + i.amount, 0)),
      category: categories.length === 1 ? categories[0] : `${categories.length} categories`,
    };
    out.push({ date: group.date, amount: group.total, group });
  }
  return out;
}

/** What a column sorts a list entry by: a group by its own date, total, category and name. */
export function entryValue<T extends GroupableExpense>(e: Entry<T>, key: "date" | "item" | "category" | "amount"): string | number {
  if (key === "date") return e.date;
  if (key === "amount") return e.amount;
  if (e.group) return key === "category" ? e.group.category : e.group.merchant;
  return key === "category" ? e.row.category || "Uncategorised" : e.row.item;
}
