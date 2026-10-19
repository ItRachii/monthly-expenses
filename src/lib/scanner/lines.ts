// Turns the Docling scanner's text pieces into reading-order lines for the
// receipt parser. The scanner sends the OCR's own pieces (`cells`), where a
// price sits in its own piece to the right of the item name, so rows are
// rebuilt from the boxes with the same grouping the PDF statement reader
// uses. Docling's layout blocks (`items`) can run several rows into one, so
// they are only the fallback for a scanner that sends no cells. Pure, so it
// runs anywhere and is unit-testable.

import { itemsToLines, type PositionedText } from "../statements/lines";

export interface ScanItem {
  text: string;
  page: number;
  /** [left, top, right, bottom], top-left origin, in page units (pixels for images). */
  box: [number, number, number, number];
}

export interface ScanResult {
  pages: { page: number; width: number; height: number }[];
  /** Docling's layout blocks. */
  items: ScanItem[];
  /** The OCR's text pieces, one per word run (older scanners leave it out). */
  cells?: ScanItem[];
}

// A piece that is only a price: "₹106", "120", "54.0".
const PRICE_PIECE = /^(?:₹|rs\.?\s*)?\d[\d,]*(?:\.\d{1,2})?$/i;

/**
 * A struck-out price and the price paid, read as one run of digits:
 * "₹188 ₹174" comes back as "188174" because the strike line takes both
 * rupee signs with it. Gives the price paid (the right half) when the run
 * splits into two prices of near equal length, the second the lower one;
 * anything else is returned as it was.
 */
export function unstrikePrice(text: string): string {
  const t = text.trim();
  if (!/^\d{4,8}$/.test(t)) return text;
  const cut = Math.ceil(t.length / 2);
  const was = t.slice(0, cut);
  const paid = t.slice(cut);
  return paid[0] !== "0" && Number(paid) < Number(was) ? paid : text;
}

/**
 * Order screens print the original price struck out just below the price
 * paid (Zepto: "₹106" over "₹120"). OCR keeps both, and the lower one lands
 * on the item name's second line, where it reads as another item. Drops a
 * price piece sitting straight under another price piece, in the same
 * column, touching it and no larger. Prices of separate items are a line
 * or more apart, so they stay.
 */
export function dropStruckPrices(pieces: ScanItem[]): ScanItem[] {
  const prices = pieces.filter((p) => PRICE_PIECE.test(p.text.trim()));
  const struck = new Set<ScanItem>();
  for (const low of prices) {
    const [l, t, r, b] = low.box;
    const h = b - t;
    for (const high of prices) {
      if (high === low || high.page !== low.page) continue;
      const [hl, ht, hr, hb] = high.box;
      const overlap = Math.min(r, hr) - Math.max(l, hl);
      const gap = t - hb;
      if (overlap > 0.5 * Math.min(r - l, hr - hl) && gap > -0.25 * h && gap < 0.5 * h && h <= (hb - ht) * 1.1) {
        struck.add(low);
        break;
      }
    }
  }
  return pieces.filter((p) => !struck.has(p));
}

/**
 * The scan's text as lines in reading order, page after page. For an order
 * screenshot (`order`), struck-out original prices are left out first.
 */
export function scanToLines(result: ScanResult, opts: { order?: boolean } = {}): string[] {
  const heights = new Map(result.pages.map((p) => [p.page, p.height]));
  const byPage = new Map<number, PositionedText[]>();
  const all = result.cells?.length ? result.cells : result.items;
  const pieces = opts.order ? dropStruckPrices(all).map((p) => ({ ...p, text: unstrikePrice(p.text) })) : all;
  for (const it of pieces) {
    const [l, t, r, b] = it.box;
    const pageHeight = heights.get(it.page) ?? b;
    // The PDF grouping expects a baseline with y growing upwards.
    const piece: PositionedText = {
      str: it.text,
      transform: [1, 0, 0, Math.max(1, b - t), l, pageHeight - b],
      width: Math.max(0, r - l),
      height: Math.max(1, b - t),
    };
    const list = byPage.get(it.page) ?? [];
    list.push(piece);
    byPage.set(it.page, list);
  }
  return Array.from(byPage.keys())
    .sort((a, b) => a - b)
    .flatMap((page) => itemsToLines(byPage.get(page)!));
}
