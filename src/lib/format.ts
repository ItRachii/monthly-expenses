export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatINR(n: number): string {
  return `₹${(n ?? 0).toFixed(2)}`;
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
