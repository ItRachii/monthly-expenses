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

export function formatDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "Golu", "Golu and Peehu", "Golu, Peehu and Chintu". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
