// Date tokens as statements print them: "12/08/2026", "12-Aug-2026",
// "12 Aug 2026", "August 12, 2026", "12 Oct, 2026".

export const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${pad(m)}-${pad(d)}`;
}

/** Reads a date at tokens[i]. Returns the ISO date and how many tokens it used. */
export function readDate(tokens: string[], i: number): { date: string; used: number } | null {
  const t = tokens[i];
  if (!t) return null;
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const d = iso(+m[3], +m[2], +m[1]);
    return d ? { date: d, used: 1 } : null;
  }
  m = t.match(/^(\d{1,2})[\/\-.]?([A-Za-z]{3})[A-Za-z]*[\/\-.,]?(\d{2,4})?$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    if (m[3]) {
      const d = iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
      return d ? { date: d, used: 1 } : null;
    }
    // "12 Aug 2025" or "12-Aug 2025": the year is the next token.
    const y = tokens[i + 1]?.match(/^(\d{4}),?$/);
    if (y) {
      const d = iso(+y[1], MONTHS[m[2].toLowerCase()], +m[1]);
      return d ? { date: d, used: 2 } : null;
    }
    return null;
  }
  const mon = tokens[i + 1]?.replace(/[,.]$/, "").toLowerCase();
  const year = tokens[i + 2]?.match(/^(\d{4}),?$/);
  if (/^\d{1,2},?$/.test(t) && mon && MONTHS[mon] && year) {
    const d = iso(+year[1], MONTHS[mon], parseInt(t, 10));
    return d ? { date: d, used: 3 } : null;
  }
  // "August 12, 2026"
  const monthFirst = MONTHS[t.toLowerCase().slice(0, 3)];
  const day = tokens[i + 1]?.match(/^(\d{1,2}),?$/);
  if (monthFirst && /^[A-Za-z]{3,9}$/.test(t) && day && year) {
    const d = iso(+year[1], monthFirst, +day[1]);
    return d ? { date: d, used: 3 } : null;
  }
  return null;
}
