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
  /** The items on show, in the receipt's own (scan) order, whatever the list is sorted by. */
  items: T[];
  /** How many items the receipt has in all: more than `items` when a filter hides some. */
  of: number;
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
 * The rows as list entries, a receipt's rows folded into one at the place of
 * its first row. The receipt is read from all its rows, and `keep` (the
 * filters and search) then picks what shows, so a receipt a filter cuts down
 * still knows how many items it has in all. A receipt with fewer than two
 * rows on show stays a plain row.
 */
export function groupReceipts<T extends GroupableExpense>(all: T[], keep: (r: T) => boolean = () => true): Entry<T>[] {
  const byReceipt = new Map<string, T[]>();
  for (const r of all) {
    if (!r.receiptId) continue;
    const items = byReceipt.get(r.receiptId);
    if (items) items.push(r);
    else byReceipt.set(r.receiptId, [r]);
  }
  const out: Entry<T>[] = [];
  const done = new Set<string>();
  for (const r of all) {
    if (!keep(r)) continue;
    const full = r.receiptId ? byReceipt.get(r.receiptId)! : [];
    const items = full.filter(keep);
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
      of: full.length,
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
