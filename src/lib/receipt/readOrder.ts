// A quick-commerce order read from its screenshots' text, end to end: the
// product rows of each screenshot become items (quantity and status taken
// off the name, a category guessed, overlap repeats marked) and the bill is
// read on its own. The scan screen and the developer scan inspector both
// call this, so the inspector shows exactly what users get. Pure.

import { parseReceipt } from "./parse";
import { categorize } from "./categorize";
import { FOOD_APPS, cleanOrderItem, repeatedRows } from "./quickCommerce";
import { orderRows, readOrderBill, type OrderBill } from "./orderBill";

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
