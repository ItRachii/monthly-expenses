// Turns positioned PDF text items into reading-order lines. PDF text has no
// lines of its own: items arrive in drawing order with coordinates, so rows
// are rebuilt from the y position and words joined by their x gaps.

export interface PositionedText {
  str: string;
  /** PDF transform: [a, b, c, d, x, y]; y grows upwards. */
  transform: number[];
  width: number;
  height: number;
}

interface Cell {
  x: number;
  w: number;
  h: number;
  str: string;
}

interface Row {
  y: number;
  cells: Cell[];
}

/** Where a run of characters in a row's text sits on the page. */
export interface TextSpan {
  at: number;
  end: number;
  x0: number;
  x1: number;
}

/** One reading-order row: its text, its position, and where each part of the text sits. */
export interface TextRow {
  y: number;
  /** Font height of the row's tallest item. */
  h: number;
  text: string;
  spans: TextSpan[];
}

/** A page: its lines, and the same lines with positions for column-aware reading. */
export interface PageText {
  lines: string[];
  rows: TextRow[];
}

/** The x position of a character of a row's text, interpolated within its item. */
export function xAt(row: TextRow, index: number): number {
  const span = row.spans.find((s) => index >= s.at && index < s.end) ?? row.spans.find((s) => s.at > index) ?? row.spans[row.spans.length - 1];
  if (!span) return 0;
  const n = Math.max(1, span.end - span.at);
  const k = Math.min(Math.max(index - span.at, 0), n);
  return span.x0 + ((span.x1 - span.x0) * k) / n;
}

export function itemsToRows(items: PositionedText[]): TextRow[] {
  const rows: Row[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 10;
    const tolerance = Math.max(2, h * 0.35);
    let row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
    if (!row) {
      row = { y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, w: it.width, h, str: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((row) => {
    row.cells.sort((a, b) => a.x - b.x);
    let out = "";
    let end = Number.NEGATIVE_INFINITY;
    const spans: TextSpan[] = [];
    for (const c of row.cells) {
      const str = c.str.replace(/\s+/g, " ");
      const gap = c.x - end;
      if (out && (gap > c.h * 0.25 || out.endsWith(" ") === false && gap > 1)) out += " ";
      if (out.endsWith(" ") && str.startsWith(" ")) out = out.slice(0, -1);
      const at = out.length;
      out += str;
      spans.push({ at, end: out.length, x0: c.x, x1: c.x + c.w });
      end = c.x + c.w;
    }
    const text = out.trimEnd();
    return { y: row.y, h: Math.max(...row.cells.map((c) => c.h)), text, spans };
  });
}

/** Lines per page, in reading order. */
export function itemsToLines(items: PositionedText[]): string[] {
  return itemsToRows(items).map((r) => r.text);
}

/** Lines and positioned rows of a page. */
export function itemsToPage(items: PositionedText[]): PageText {
  const rows = itemsToRows(items);
  return { lines: rows.map((r) => r.text), rows };
}
