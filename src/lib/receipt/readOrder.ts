// A quick-commerce order read from its screenshots' text, end to end: the
// product rows of each screenshot become items (quantity and status taken
// off the name, a category guessed, overlap repeats marked) and the bill is
// read on its own. The scan screen and the developer scan inspector both
// call this, so the inspector shows exactly what users get. Pure.

import { parseReceipt } from "./parse";
import { categorize } from "./categorize";
import { cleanOrderItem, repeatedRows } from "./quickCommerce";
import { orderProducts, readOrderBill, type OrderBill } from "./orderBill";

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

/** One order from the text of each of its screenshots. */
export function readOrder(texts: string[]): { items: OrderItem[]; bill: OrderBill } {
  const products = texts.map(orderProducts);
  const parsed = parseReceipt(products.join("\n"));
  const repeats = repeatedRows(
    products.map((t) => parseReceipt(t).items.map((it) => it.description)),
    parsed.items.map((it) => it.description),
  );
  const items = parsed.items.map((it, n) => {
    const clean = cleanOrderItem(it.description);
    return {
      read: it.description,
      description: clean.description,
      category: categorize(clean.description),
      qty: clean.qty ?? it.qty,
      amount: it.amount,
      repeat: repeats[n],
    };
  });
  return { items, bill: readOrderBill(texts) };
}
