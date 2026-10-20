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
// BigBasket's "Basket value" comes back from OCR run into its badge
// ("Basket valuesAvED 34.25 ₹211"), so it has no end boundary.
const ITEM_TOTAL = /\b(?:items?\s*total|items?\s*bill|sub\s*-?\s*total)\b|\bbasket\s*value/i;
const ORDER_TOTAL =
  /\b(grand\s*total|to\s*pay|bill\s*total|order\s*total|total\s*(?:amount|paid|bill|payable)|amount\s*(?:paid|payable)|net\s*payable|paid\s*(?:via|using|by))\b/i;
const DISCOUNT = /\b(discount|coupon|promo|offer|free\s*cash)\b/i;
const CHARGE =
  /\b(fees?|charges?|surcharge|packaging|packing|delivery|handling|platform|convenience|small\s*cart|tip|donation|gst|taxes|tax|cess)\b/i;
// A charge struck out and waived ("Delivery fee ₹25 FREE"), or GST that is
// already inside the item prices.
const WAIVED = /\b(free|waived|included|incl\.?)\b/i;
const AMOUNTS = /(-|−)?\s*(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d{1,2})?)/gi;
// Money taken off: "-₹75.00". No product is priced below zero. Written tight,
// so a product line like "Atta 5kg - ₹250" is not read as one.
const NEGATIVE = /[-−](?:₹|rs\.?\s*)\d/i;
const RUPEES = /(?:₹|rs\.?\s*)\d/i;

// Where an order screen's sections start. Swiggy boxes its items under
// "ITEM DETAILS" and its bill under "TOTAL ORDER BILL DETAILS"; others say
// "Bill details", "Bill summary", "Payment details", "Price details".
// Zepto says "3 items in order". OCR may read the icon before a heading as a
// stray symbol, hence the leading non-letters.
// BigBasket: "Product details 3 products · ₹211"; Blinkit: "1 item in this order".
const ITEMS_HEADER =
  /^[^a-z0-9]*(?:item\s*details|product\s*details|(?:\d+\s+)?items?\s+in\s+(?:this\s+|your\s+)?order)\b/i;
const BILL_HEADER = /^[^a-z0-9]*(?:total\s+)?(?:order\s+)?(?:bill|payment|price)\s*(?:details|summary)\b/i;
// The order's own heading, not a product: "Completed | 4 items, ₹177", "3 items • Ulsoor".
const ORDER_META = /\b\d+\s*(?:items?|products?)\b/i;

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
  return (
    INFO.test(text) || ITEM_TOTAL.test(text) || ORDER_TOTAL.test(text) || DISCOUNT.test(text) || CHARGE.test(text) || NEGATIVE.test(text)
  );
}

/** Which part of an order screenshot a row belongs to. */
export type RowPart =
  | "before-items" // above the items: order number, status, address, ETA
  | "items-heading"
  | "product"
  | "bill-wording" // reads like a fee, discount or total, so not a product
  | "order-heading" // "Completed | 4 items, ₹177"
  | "bill-heading"
  | "breakdown" // Blinkit's "MRP" and "Product discount" above the item total
  | "bill"; // inside the bill section

/**
 * Sorts one screenshot's rows into its parts. When the screen has a bill
 * section, nothing from its heading down is a product (Swiggy Instamart's
 * "Item Bill ₹206" included), and when it marks where the items start,
 * nothing above that is either. Two layouts put rows above the bill's item
 * total that are not charges:
 * - Swiggy food lists the dishes inside "BILL DETAILS", before "Item
 *   Total", with nothing priced above it: those rows are the products.
 * - Blinkit shows how the item total was reached ("MRP ₹300", "Product
 *   discount -₹3") when the items are already listed above: that is
 *   already in the item prices, so it is left out.
 * Without headings, bill rows are told apart by their wording.
 */
export function orderRows(text: string): { line: string; part: RowPart }[] {
  const lines = text.split(/\r?\n/);
  const bill = lines.findIndex((l) => BILL_HEADER.test(l.trim()));
  const head = lines.findIndex((l) => ITEMS_HEADER.test(l.trim()));
  const from = head !== -1 && (bill === -1 || head < bill) ? head : -1;
  const itemTotal = bill === -1 ? -1 : lines.findIndex((l, i) => i > bill && ITEM_TOTAL.test(l));
  const priced = (l: string) => RUPEES.test(l) && !isBillLine(l) && !ORDER_META.test(l);
  const pricedAbove = lines.slice(from + 1, bill === -1 ? undefined : bill).some(priced);
  const itemsInBill = from === -1 && itemTotal !== -1 && !pricedAbove && lines.slice(bill + 1, itemTotal).some(priced);
  return lines.map((line, i): { line: string; part: RowPart } => {
    if (i === bill) return { line, part: "bill-heading" };
    if (bill !== -1 && i > bill) {
      if (itemTotal === -1 || i >= itemTotal) return { line, part: "bill" };
      if (!itemsInBill) return { line, part: "breakdown" };
      return { line, part: isBillLine(line) ? "bill-wording" : "product" };
    }
    if (i === from) return { line, part: "items-heading" };
    if (i < from || itemsInBill) return { line, part: "before-items" };
    if (isBillLine(line)) return { line, part: "bill-wording" };
    if (ORDER_META.test(line)) return { line, part: "order-heading" };
    return { line, part: "product" };
  });
}

/** One screenshot's product rows, as text for the receipt parser. */
export function orderProducts(text: string): string {
  return orderRows(text)
    .filter((r) => r.part === "product")
    .map((r) => r.line)
    .join("\n");
}

/** What a row of the bill came to. */
export type BillReading =
  | { kind: "item-total" | "order-total" | "total"; amount: number }
  | { kind: "charge" | "discount"; amount: number; label: string }
  | { kind: "waived" | "info" | "after-total" | "breakdown" | "not-bill" | "no-amount" };

/**
 * How each row of one screenshot reads as part of a bill. Inside a bill
 * section (below its heading, up to the total) any rupee amount is a charge
 * whatever it is called, and a negative one is a discount; elsewhere a row
 * has to read like a fee or discount. Nothing after the order total counts
 * ("Inclusive of all taxes and charges ₹222.52" is the struck-out total).
 */
export function billRows(screen: string): { line: string; reading: BillReading }[] {
  let totalSeen = false;
  return orderRows(screen).map(({ line: raw, part }) => {
    const line = raw.trim();
    const read = (reading: BillReading) => ({ line: raw, reading });
    if (part === "product" || part === "before-items" || part === "order-heading") return read({ kind: "not-bill" });
    if (part === "breakdown") return read({ kind: "breakdown" });
    if (!line) return read({ kind: "no-amount" });
    const amount = lastAmount(line);
    if (amount == null) return read({ kind: INFO.test(line) ? "info" : "no-amount" });
    if (totalSeen) return read({ kind: "after-total" });
    if (ITEM_TOTAL.test(line)) return read({ kind: "item-total", amount: Math.abs(amount) });
    if (INFO.test(line)) return read({ kind: "info" });
    if (ORDER_TOTAL.test(line)) {
      totalSeen = true;
      return read({ kind: "order-total", amount: Math.abs(amount) });
    }
    if (DISCOUNT.test(line) || NEGATIVE.test(line)) return read({ kind: "discount", amount: -Math.abs(amount), label: label(line) || "Discount" });
    if (CHARGE.test(line) || (part === "bill" && RUPEES.test(line)))
      return read(WAIVED.test(line) ? { kind: "waived" } : { kind: "charge", amount, label: label(line) || "Charge" });
    if (/\btotal\b/i.test(line)) return read({ kind: "total", amount: Math.abs(amount) });
    return read({ kind: "not-bill" });
  });
}

const label = (line: string) => line.replace(AMOUNTS, " ").replace(/\s+/g, " ").replace(/[:\s|+-]+$/, "").trim();

/** Reads the bill summary out of an order's text: one screenshot's, or a list of them. */
export function readOrderBill(text: string | string[]): OrderBill {
  const charges: Charge[] = [];
  let itemTotal: number | null = null;
  let orderTotal: number | null = null;
  let plainTotal: number | null = null;
  for (const screen of Array.isArray(text) ? text : [text]) {
    for (const { reading: r } of billRows(screen)) {
      if (r.kind === "item-total") itemTotal = r.amount;
      else if (r.kind === "order-total") orderTotal = r.amount;
      else if (r.kind === "total") plainTotal = r.amount;
      else if (r.kind === "charge" || r.kind === "discount") charges.push({ label: r.label, amount: r.amount });
    }
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

/**
 * Checks the order adds up and, once it does, how much of the charges (or
 * whatever the total says beyond the items) each item carries.
 */
export function settleOrder(
  prices: number[],
  charges: number[],
  orderTotal: number | null,
): { check: Reconciliation; shares: number[] | null } {
  const check = reconcile(prices, charges, orderTotal);
  return { check, shares: check.status === "matched" ? distribute(prices, round2(check.total - check.items)) : null };
}
