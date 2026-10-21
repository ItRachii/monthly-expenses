export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rupees with Indian grouping and paise: ₹1,23,456.78, and -₹50.00 when negative. */
export function formatINR(n: number): string {
  const v = round2(n ?? 0);
  return `${v < 0 ? "-" : ""}₹${inr.format(Math.abs(v))}`;
}

// Prisma returns @db.Date values as UTC-midnight Date objects, so read the
// date in UTC to avoid timezone drift.
export function monthKey(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Month names as the app prints them, everywhere: "Sep", never "Sept".
 * Dates are built from these by hand rather than with the locale's
 * formatter, which prints "Sept" for en-IN on some systems and "Sep" on
 * others, so the server and every browser show the same.
 */
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" to "Sep 2026". */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTH_SHORT[m - 1]} ${y}` : key;
}

/** "2026-09-05" to "05 Sep 2026"; without the year, "05 Sep"; unpadded, "5 Sep 2026". */
export function shortDate(iso: string, { year = true, padDay = true }: { year?: boolean; padDay?: boolean } = {}): string {
  const [y, m, d] = iso.split("-").map(Number);
  const day = padDay ? String(d).padStart(2, "0") : String(d);
  return `${day} ${MONTH_SHORT[m - 1]}${year ? ` ${y}` : ""}`;
}

export function formatDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Today in UTC. The server renders forms in UTC, so this is the value that
 * matches the server's HTML on the first render; forms then switch to
 * localISO() once mounted (in India the UTC day is still yesterday until
 * 05:30).
 */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The day in the browser's own time zone, as YYYY-MM-DD. */
export function localISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Golu", "Golu and Peehu", "Golu, Peehu and Chintu". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
