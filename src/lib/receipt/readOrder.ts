// A quick-commerce order read from its screenshots' text, end to end: the
// product rows of each screenshot become items (quantity and status taken
// off the name, a category guessed, overlap repeats marked) and the bill is
// read on its own. The scan screen and the developer scan inspector both
// call this, so the inspector shows exactly what users get. Pure.

import { parseReceipt } from "./parse";
import { categorize } from "./categorize";
import { FOOD_APPS, cleanOrderItem, repeatedRows } from "./quickCommerce";
import type { ParsedReceipt } from "./types";
import { TOLERANCE, orderRows, orderedCount, readOrderBill, type OrderBill } from "./orderBill";
import { stitch, type ShotRow, type Stitched } from "./stitch";

// A row that is only the pack size and count: "6 x 330 ml x 1", "1 pack (1 kg) · 1 unit".
const PACK = /^\d+(?:\.\d+)?\s*(?:[x×]\s*\d+(?:\.\d+)?\s*)?(?:ml|l|ltr|litre|g|gm|gms|kg|pcs?|packs?|units?)\b/i;
const PACK_COUNT = /[x×]\s*(\d{1,3})\s*$|(\d{1,3})\s*units?\b/i;
// "Chatpata Double Egg Roll x 1 ₹119": the parser takes "x 1" for a column.
const ROW_COUNT = /\s[x×]\s*(\d{1,3})\s+(?:₹|rs\.?\s*)?\d[\d,]*(?:\.\d{1,2})?\s*$/i;

export interface OrderItem {
  /** The name as the parser read it, before clean-up. */
  read: string;
  description: string;
  category: string;
  qty: number | null;
  amount: number;
  /** Read again from an overlapping screenshot. */
  repeat: boolean;
}

/** One order from the text of each of its screenshots; `app` is where it was ordered from. */
export function readOrder(texts: string[], app?: string): { items: OrderItem[]; bill: OrderBill } {
  const rows = texts.map((t) => orderRows(t).filter((r) => r.part === "product").map((r) => r.line.trim()));
  const products = rows.map((r) => r.join("\n"));
  const parsed = parseReceipt(products.join("\n"));
  const repeats = repeatedRows(
    products.map((t) => parseReceipt(t).items.map((it) => it.description)),
    parsed.items.map((it) => it.description),
  );
  // Blinkit prints the price on the pack-size row under the name
  // ("Coca-Cola Diet-Coke" / "6 x 330 ml x 1 ₹297"): the name is the row above.
  const flat = rows.flat();
  let at = 0;
  const items = parsed.items.map((it, n) => {
    const row = flat.findIndex((r, i) => i >= at && r.startsWith(it.description));
    const above = row > 0 && row - 1 >= at ? flat[row - 1] : null;
    if (row !== -1) at = row + 1;
    const pack = PACK.test(it.description) && above && !parseReceipt(above).items.length ? it.description : null;
    const clean = cleanOrderItem(pack ? above! : it.description);
    const count = pack?.match(PACK_COUNT) ?? (row !== -1 ? flat[row].match(ROW_COUNT) : null);
    return {
      read: it.description,
      description: clean.description,
      category: FOOD_APPS.includes(app ?? "") ? "Dining Out" : categorize(clean.description),
      qty: clean.qty ?? (count ? Number(count[1] ?? count[2]) : null) ?? it.qty,
      amount: it.amount,
      repeat: repeats[n],
    };
  });
  return { items, bill: readOrderBill(texts) };
}

/** Whether the screenshots hold the whole order, as far as the order itself says. */
export interface Completeness {
  /** Items the order says it has ("9 products"), if it says. */
  expected: number | null;
  /** Item lines read (repeats left out). */
  found: number;
  /** Rupees the items come to less than the bill's item total, if they do. */
  short: number | null;
  /** No bill total was read: the screenshot with the bill is missing. */
  noTotal: boolean;
  /** The order gives a count or an item total to check the items against. */
  checked: boolean;
  /** Some of the order was not in the screenshots. */
  missing: boolean;
}

/**
 * Checks the items read against the order's own count and the bill's item
 * total. The count may be lines ("4 items in order") or units (Instamart's
 * "4 items" for 2 x Sprite + 2 more), so only fewer than both is missing.
 */
export function orderCompleteness(text: string, read: { items: OrderItem[]; bill: OrderBill }): Completeness {
  const items = read.items.filter((it) => !it.repeat);
  const expected = orderedCount(text);
  const units = items.reduce((n, it) => n + (it.qty ?? 1), 0);
  const sum = Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100;
  const itemTotal = read.bill.itemTotal;
  const short = itemTotal != null && itemTotal - sum > TOLERANCE ? Math.round((itemTotal - sum) * 100) / 100 : null;
  const fewer = expected != null && items.length < expected && units < expected;
  const noTotal = read.bill.orderTotal == null;
  return { expected, found: items.length, short, noTotal, checked: expected != null || itemTotal != null, missing: fewer || short != null || noTotal };
}

/**
 * An order from its screenshots, end to end: put back together (see
 * stitch), read, and checked for missing parts. Add Expense and the
 * developer scan inspector both call this, so they cannot read an order
 * differently. `taken` is each file's time.
 */
export function readOrderShots(
  shots: ShotRow[][],
  app: string,
  taken?: number[],
): { stitched: Stitched; order: { items: OrderItem[]; bill: OrderBill }; complete: Completeness } {
  const stitched = stitch(shots, taken);
  const order = readOrder([stitched.text], app);
  return { stitched, order, complete: orderCompleteness(stitched.text, order) };
}

/**
 * A receipt (not an app order) from the text of each of its images: read as
 * one, with the rows an overlapping photo repeats marked. Add Expense and
 * the developer scan inspector both call this.
 */
export function readReceiptShots(texts: string[]): { parsed: ParsedReceipt; repeats: boolean[] } {
  const parsed = parseReceipt(texts.join("\n"));
  const repeats = repeatedRows(
    texts.map((t) => parseReceipt(t).items.map((it) => it.description)),
    parsed.items.map((it) => it.description),
  );
  return { parsed, repeats };
}
