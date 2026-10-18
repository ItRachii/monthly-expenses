// The bill summary of a quick-commerce order: the extra charges on top of
// the items (handling, delivery, platform fees and the like), discounts,
// and the total actually paid. The order is checked by
//   items + charges (discounts negative) = order total,
// and only once that holds are the charges spread over the items, so each
// item's expense is what it really cost. Pure, so it is unit-tested.

export interface Charge {
  label: string;
  /** Rupees; negative for a discount. */
  amount: number;
}

export interface OrderBill {
  charges: Charge[];
  /** "Item Total" on the bill, to check no item was missed. */
  itemTotal: number | null;
  /** What was paid: "Grand Total", "To Pay", "Bill Total", ... */
  orderTotal: number | null;
}

// Shown for information only: "You saved ₹45" is not taken off the total.
const INFO = /\b(saved|savings|you save|cashback|mrp total)\b/i;
const ITEM_TOTAL = /\b(items?\s*total|sub\s*-?\s*total)\b/i;
const ORDER_TOTAL =
  /\b(grand\s*total|to\s*pay|bill\s*total|order\s*total|total\s*(?:amount|paid|bill|payable)|amount\s*(?:paid|payable)|net\s*payable|paid\s*(?:via|using|by))\b/i;
const DISCOUNT = /\b(discount|coupon|promo|offer)\b/i;
const CHARGE =
  /\b(fees?|charges?|surcharge|packaging|packing|delivery|handling|platform|convenience|small\s*cart|tip|donation|gst|taxes|tax|cess)\b/i;
// A charge struck out and waived ("Delivery fee ₹25 FREE"), or GST that is
// already inside the item prices.
const WAIVED = /\b(free|waived|included|incl\.?)\b/i;
const AMOUNTS = /(-|−)?\s*(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d{1,2})?)/gi;

/** The last amount on a line, negative when written "-₹30". */
function lastAmount(line: string): number | null {
  let last: number | null = null;
  for (const m of line.matchAll(AMOUNTS)) {
    const v = parseFloat(m[2].replace(/,/g, ""));
    if (Number.isFinite(v)) last = m[1] ? -v : v;
  }
  return last;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Is this line (or an item read from it) part of the bill summary rather than a product? */
export function isBillLine(text: string): boolean {
  return INFO.test(text) || ITEM_TOTAL.test(text) || ORDER_TOTAL.test(text) || DISCOUNT.test(text) || CHARGE.test(text);
}

/** Reads the bill summary out of an order's text lines. */
export function readOrderBill(text: string): OrderBill {
  const charges: Charge[] = [];
  let itemTotal: number | null = null;
  let orderTotal: number | null = null;
  let plainTotal: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || INFO.test(line)) continue;
    const amount = lastAmount(line);
    if (amount == null) continue;
    const label = line.replace(AMOUNTS, " ").replace(/\s+/g, " ").replace(/[:\s|-]+$/, "").trim();
    if (ITEM_TOTAL.test(line)) itemTotal = Math.abs(amount);
    else if (ORDER_TOTAL.test(line)) orderTotal = Math.abs(amount);
    else if (DISCOUNT.test(line)) charges.push({ label: label || "Discount", amount: -Math.abs(amount) });
    else if (CHARGE.test(line)) {
      if (!WAIVED.test(line)) charges.push({ label: label || "Charge", amount });
    } else if (/\btotal\b/i.test(line)) plainTotal = Math.abs(amount);
  }
  // Overlapping screenshots repeat the bill summary: count each charge once.
  const seen = new Set<string>();
  const unique = charges.filter((c) => {
    const key = `${c.label.toLowerCase()}|${c.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { charges: unique, itemTotal, orderTotal: orderTotal ?? plainTotal };
}

export type Reconciliation =
  | { status: "no-total"; items: number; charges: number }
  | { status: "mismatch" | "matched"; items: number; charges: number; total: number; diff: number };

/** Apps round, so a rupee either way still counts as adding up. */
export const TOLERANCE = 1;

/** Do the items and charges add up to the order total? */
export function reconcile(itemAmounts: number[], charges: number[], orderTotal: number | null): Reconciliation {
  const items = round2(itemAmounts.reduce((s, a) => s + a, 0));
  const extra = round2(charges.reduce((s, a) => s + a, 0));
  if (orderTotal == null || !Number.isFinite(orderTotal)) return { status: "no-total", items, charges: extra };
  const diff = round2(orderTotal - (items + extra));
  return { status: Math.abs(diff) <= TOLERANCE ? "matched" : "mismatch", items, charges: extra, total: orderTotal, diff };
}

/**
 * Splits `extra` rupees over items in proportion to their amounts, in whole
 * paise that add up to exactly `extra` (largest remainder). Equal shares when
 * every amount is zero.
 */
export function distribute(amounts: number[], extra: number): number[] {
  if (amounts.length === 0) return [];
  const extraP = Math.round(extra * 100);
  const base = amounts.reduce((s, a) => s + a, 0);
  const raw = amounts.map((a) => (base > 0 ? (extraP * a) / base : extraP / amounts.length));
  const floors = raw.map(Math.floor);
  let left = extraP - floors.reduce((s, f) => s + f, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors.map((p) => p / 100);
}
