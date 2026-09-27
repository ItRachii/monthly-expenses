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

export function itemsToLines(items: PositionedText[]): string[] {
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
    for (const c of row.cells) {
      const gap = c.x - end;
      if (out && (gap > c.h * 0.25 || out.endsWith(" ") === false && gap > 1)) out += " ";
      out += c.str;
      end = c.x + c.w;
    }
    return out.replace(/\s+/g, " ").trim();
  });
}
