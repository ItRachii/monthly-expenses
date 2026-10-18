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

/** The scan's text as lines in reading order, page after page. */
export function scanToLines(result: ScanResult): string[] {
  const heights = new Map(result.pages.map((p) => [p.page, p.height]));
  const byPage = new Map<number, PositionedText[]>();
  const pieces = result.cells?.length ? result.cells : result.items;
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
