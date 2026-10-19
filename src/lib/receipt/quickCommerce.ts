// Quick-commerce order screenshots (Blinkit, Zepto, Instamart, ...). The
// receipt parser reads them like any receipt; this tidies what is particular
// to these apps: the quantity written in front ("2 x Sprite Zero") and the
// delivery status the app prints after the name. Pure, so it is unit-tested.

export const ORDER_APPS = [
  "Blinkit",
  "Zepto",
  "Swiggy Instamart",
  "BigBasket",
  "Flipkart Minutes",
  "Amazon Now",
  "JioMart",
] as const;

/** Not one of the apps above: the merchant is whatever the screenshot says. */
export const OTHER_APP = "Other";

// "2 x Item", "2x Item", "1x[Combo] Item" (OCR often drops the space), "2 × Item",
// "Qty 2 Item". Not "4x4 Cable": a digit straight after the x is part of the name.
const LEADING_QTY = /^(?:qty\s*)?(\d{1,3})\s*[x×*]\s*(?=[^\d\s])|^qty\s*(\d{1,3})\s+/i;
// Status words these apps print after an item's name.
const TRAILING_STATUS = /\s+(?:delivered|refunded|replaced|cancelled|canceled|out of stock|unavailable)$/i;

/** An order line's name without the quantity and status around it, and the quantity. */
export function cleanOrderItem(description: string): { description: string; qty: number | null } {
  let d = description.trim();
  let qty: number | null = null;
  const m = d.match(LEADING_QTY);
  if (m) {
    const n = Number(m[1] ?? m[2]);
    if (n > 0) {
      qty = n;
      d = d.slice(m[0].length);
    }
  }
  d = d.replace(TRAILING_STATUS, "").replace(/^[\s|:\-•]+|[\s|:\-•]+$/g, "");
  return { description: d || description.trim(), qty };
}

const nameKey = (d: string) => d.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Screenshots of one long order overlap, so the rows in the overlap are read
 * twice. Given each image's item names and the names of all items in order,
 * says which rows are repeats from an earlier screenshot: a name may appear
 * as often as it does on any single image (two identical items on one
 * screenshot are two items), and copies beyond that are repeats.
 */
export function repeatedRows(perImage: string[][], all: string[]): boolean[] {
  const allowed = new Map<string, number>();
  for (const names of perImage) {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(nameKey(n), (counts.get(nameKey(n)) ?? 0) + 1);
    for (const [k, c] of counts) allowed.set(k, Math.max(allowed.get(k) ?? 0, c));
  }
  const seen = new Map<string, number>();
  return all.map((n) => {
    const k = nameKey(n);
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c > (allowed.get(k) ?? 1);
  });
}
