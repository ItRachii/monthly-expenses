// Server-side input validation shared by the server actions. All user input
// crosses these checks before it is persisted or echoed anywhere.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// Pragmatic email shape check; real validation happens via the invite flow.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Upper bound for money fields — rejects Infinity and absurd values. */
export const MAX_AMOUNT = 100_000_000;

export function isValidDateISO(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isValidMonth(s: string): boolean {
  return MONTH_RE.test(s);
}

export function isValidEmail(s: string): boolean {
  return s.length <= 254 && EMAIL_RE.test(s);
}

export function isValidAmount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT;
}

/** Replaces control characters with spaces, trims, and caps length. */
export function cleanText(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? " " : ch;
  }
  return out.trim().slice(0, max);
}
