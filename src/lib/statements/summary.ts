// The statement's summary box (dues, payments, purchases, limits, due date)
// and which card it belongs to. Layout-tolerant: labels and figures may sit
// on one line ("Total Amount Due: Rs. 33,691.60") or on a label row followed
// by a figure row (HDFC's blue box). Only labels and numbers are read, so
// nothing here can carry a name or address.

import { readDate } from "./dates";
import { isDateLed } from "./redact";
import { xAt, type TextRow } from "./lines";
import type { StatementSummary } from "./types";

type AmountKey = Exclude<keyof StatementSummary, "dueDate" | "statementDate">;

interface Label {
  key: keyof StatementSummary;
  kind: "amount" | "date";
  re: RegExp;
}

const LABELS: Label[] = [
  { key: "availableCredit", kind: "amount", re: /available credit(?: limit)?/gi },
  { key: "availableCash", kind: "amount", re: /available cash(?: limit)?/gi },
  { key: "creditLimit", kind: "amount", re: /(?:total )?credit limit/gi },
  // "PREVIOUS STATEMENT" alone: the label wraps onto two rows in a narrow column.
  { key: "previousDues", kind: "amount", re: /previous (?:statement )?(?:dues?|balance)|previous statement(?! date)|opening balance/gi },
  { key: "paymentsCredits", kind: "amount", re: /payments?\s*\/\s*credits?|payments? received|credits? received|payments?\s*&\s*credits?/gi },
  { key: "purchases", kind: "amount", re: /purchases?\s*\/\s*(?:debits?|charges?)|purchases?\s*(?:&|and) other debits|new purchases|other debits|purchases? \(current/gi },
  { key: "financeCharges", kind: "amount", re: /finance charges?|interest charged/gi },
  { key: "totalDue", kind: "amount", re: /total (?:amount |payment )?dues?|amount payable/gi },
  // "due" not "dues": HDFC's Past Dues table says "MINIMUM DUES".
  { key: "minimumDue", kind: "amount", re: /minimum (?:amount |payment )?due(?!s)|min\.? (?:amount )?due(?!s)/gi },
  { key: "statementDate", kind: "date", re: /statement date/gi },
  { key: "dueDate", kind: "date", re: /(?:payment )?due date/gi },
];

const AMOUNT = /^(?:₹|rs\.?|inr|c)?\(?(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?\)?(?:cr|dr)?$/i;
const CURRENCY = /^(?:₹|rs\.?|inr|c)$/i;
const OPERATOR = /^[+\-−=|:l]{1,2}$/;

function amountOf(tok: string): number | null {
  const m = tok.match(AMOUNT);
  if (!m) return null;
  const n = parseFloat(`${m[1].replace(/,/g, "")}.${m[2] ?? "00"}`);
  return Number.isFinite(n) ? n : null;
}

interface Found {
  key: keyof StatementSummary;
  kind: "amount" | "date";
  at: number;
  end: number;
}

/** Labels in a line, left to right. "credit limit" inside "available credit limit" is not counted twice. */
function labelsIn(line: string): Found[] {
  const found: Found[] = [];
  for (const l of LABELS) {
    l.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = l.re.exec(line))) {
      const at = m.index;
      const end = at + m[0].length;
      if (found.some((f) => at < f.end && end > f.at)) continue;
      found.push({ key: l.key, kind: l.kind, at, end });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

interface Token {
  text: string;
  at: number;
}

function tokensOf(line: string): Token[] {
  const out: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ text: m[0], at: m.index });
  return out;
}

interface Value<T> {
  value: T;
  /** Character range in the line. */
  at: number;
  end: number;
}

/** Amounts and dates in a line, with their character positions. */
function valuesIn(line: string): { amounts: Value<number>[]; dates: Value<string>[]; wordy: boolean } {
  const toks = tokensOf(line);
  const texts = toks.map((t) => t.text);
  const used = new Set<number>();
  const dates: Value<string>[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (used.has(i)) continue;
    const d = readDate(texts, i);
    if (d) {
      const last = toks[i + d.used - 1];
      dates.push({ value: d.date, at: toks[i].at, end: last.at + last.text.length });
      for (let k = 0; k < d.used; k++) used.add(i + k);
    }
  }
  const amounts: Value<number>[] = [];
  let wordy = false;
  for (let i = 0; i < toks.length; i++) {
    if (used.has(i)) continue;
    const t = toks[i].text;
    if (/%$/.test(t)) continue;
    const a = amountOf(t);
    if (a !== null) {
      amounts.push({ value: a, at: toks[i].at, end: toks[i].at + t.length });
      continue;
    }
    if (!CURRENCY.test(t) && !OPERATOR.test(t)) wordy = true;
  }
  return { amounts, dates, wordy };
}

type Setter = (f: Found, v: number | string) => void;

/**
 * Column-aware reading of positioned rows. In HDFC's 2026 box a two-line
 * label ("PAYMENTS/CREDITS" over "RECEIVED") sits above and below the
 * height of a one-line label next to it, so the labels of one visual row
 * arrive as two or three text rows, and the big total due is a row of its
 * own. Reading order alone then pairs figures with the wrong labels. Here
 * a label takes the first figure printed below it in its own column.
 */
function readRows(pages: TextRow[][], set: Setter, notes: string[]): boolean {
  let any = false;
  for (const rows of pages) {
    const claimed = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isDateLed(row.text)) continue;
      const labels = labelsIn(row.text);
      if (labels.length === 0) continue;
      any = true;
      const own = valuesIn(row.text);
      const pending: (Found & { x0: number; x1: number })[] = [];
      labels.forEach((l, k) => {
        const limit = labels[k + 1]?.at ?? Number.POSITIVE_INFINITY;
        const pool: Value<number | string>[] = l.kind === "amount" ? own.amounts : own.dates;
        const hit = pool.find((v) => v.at > l.at && v.at < limit);
        if (hit) {
          set(l, hit.value);
          notes.push(`${l.key} = ${hit.value} (same line)`);
        } else pending.push({ ...l, x0: xAt(row, l.at), x1: xAt(row, l.end - 1) });
      });
      // A figure belongs to the label above it: same column, nearest row.
      for (const l of pending) {
        const pad = Math.max(4, row.h * 0.6);
        for (let j = i + 1; j < rows.length && j <= i + 8; j++) {
          const r = rows[j];
          if (row.y - r.y > row.h * 12 || isDateLed(r.text)) break;
          const v = valuesIn(r.text);
          const pool: Value<number | string>[] = l.kind === "amount" ? v.amounts : v.dates;
          let best: { id: string; value: number | string } | null = null;
          let bestDistance = Number.POSITIVE_INFINITY;
          for (const c of pool) {
            const id = `${j}:${c.at}`;
            if (claimed.has(id)) continue;
            const cx0 = xAt(r, c.at);
            const cx1 = xAt(r, c.end - 1);
            if (cx1 < l.x0 - pad || cx0 > l.x1 + pad) continue;
            const distance = Math.abs((cx0 + cx1) / 2 - (l.x0 + l.x1) / 2);
            if (distance < bestDistance) {
              best = { id, value: c.value };
              bestDistance = distance;
            }
          }
          if (best) {
            claimed.add(best.id);
            set(l, best.value);
            notes.push(`${l.key} = ${best.value} (column below)`);
            break;
          }
        }
      }
    }
  }
  return any;
}

/**
 * Reads the summary figures out of a statement's lines. With positioned
 * rows the figures are paired to labels by column; from lines alone, by
 * reading order. Returns null when no figure at all was found.
 */
export function parseSummary(lines: string[], rowPages: TextRow[][] = []): { summary: StatementSummary | null; notes: string[] } {
  const s: StatementSummary = {
    previousDues: null,
    paymentsCredits: null,
    purchases: null,
    financeCharges: null,
    totalDue: null,
    minimumDue: null,
    creditLimit: null,
    availableCredit: null,
    availableCash: null,
    statementDate: null,
    dueDate: null,
  };
  const notes: string[] = [];
  const set: Setter = (f, v) => {
    if (f.kind === "amount" && typeof v === "number" && s[f.key as AmountKey] === null) s[f.key as AmountKey] = v;
    if (f.kind === "date" && typeof v === "string" && s[f.key as "dueDate" | "statementDate"] === null) s[f.key as "dueDate" | "statementDate"] = v;
  };

  if (readRows(rowPages, set, notes)) {
    const any = Object.values(s).some((v) => v !== null);
    return { summary: any ? s : null, notes };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Transaction lines start with a date and may say "PAYMENT RECEIVED".
    if (isDateLed(line)) continue;
    const labels = labelsIn(line);
    if (labels.length === 0) continue;
    const { amounts, dates } = valuesIn(line);
    notes.push(`labels: ${labels.map((l) => l.key).join(", ")}`);

    // Same line: the first value printed after each label and before the next.
    const pending: Found[] = [];
    labels.forEach((l, k) => {
      const limit = labels[k + 1]?.at ?? Number.POSITIVE_INFINITY;
      const pool = l.kind === "amount" ? amounts : dates;
      const hit = pool.find((v) => v.at > l.at && v.at < limit);
      if (hit) set(l, hit.value);
      else pending.push(l);
    });
    if (pending.length === 0) continue;

    // Label row: the figures are on a following row, in the same order.
    // Continuation rows of the labels ("RECEIVED", "(Including Cash)") sit in
    // between and hold neither labels nor figures.
    for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
      const next = lines[j];
      if (labelsIn(next).length > 0) break;
      const v = valuesIn(next);
      if (v.amounts.length === 0 && v.dates.length === 0) continue;
      if (v.wordy) continue;
      notes.push(`figures: ${next.trim()}`);
      let a = 0;
      let d = 0;
      for (const l of pending) {
        if (l.kind === "amount" && a < v.amounts.length) set(l, v.amounts[a++].value);
        else if (l.kind === "date" && d < v.dates.length) set(l, v.dates[d++].value);
      }
      break;
    }
  }

  const any = Object.values(s).some((v) => v !== null);
  return { summary: any ? s : null, notes };
}

const PRODUCT_NAMES =
  "millennia|regalia|diners club|infinia|moneyback|money back|tata neu|swiggy|pixel|freedom|amazon pay|coral|sapphiro|rubyx|emeralde|platinum|titanium|indianoil|indian oil|marriott|6e rewards|business|biz|shoppers stop|times|easy ?emi|mine|flipkart|myntra|paytm|makemytrip|hpcl|bpcl";
// The product name only counts next to the word "card" in the header, so a
// merchant of the same name in the transactions (Swiggy, Flipkart) is not
// mistaken for it.
const PRODUCT_NEAR_CARD = new RegExp(`\\b(${PRODUCT_NAMES})\\b[^.]{0,30}\\bcards?\\b|\\bcards?\\b[^.]{0,30}\\b(${PRODUCT_NAMES})\\b`, "i");

/**
 * Which card the statement is for: the last four digits only, never more,
 * plus the product name when printed. The digits come from the masked
 * number in the text, or from the file name HDFC uses ("…_7043_…").
 */
export function cardIdentity(rawLines: string[], filename?: string): { last4: string; product: string | null; source: "text" | "filename" } | null {
  const patterns = [
    /\b\d{4}[ -]?(?:[Xx*]{4}[ -]?){2}(\d{4})\b/,
    /\b(?:[Xx*]{4}[ -]?){1,3}(\d{4})\b/,
    /\b\d{4}[Xx*]{8}(\d{4})\b/,
    /(?:ending|ends)\s+(?:with|in)?\s*:?\s*(\d{4})\b/i,
    /card\s*(?:no|number|#)\.?\s*:?\s*[\dXx*][\dXx* -]{6,18}?(\d{4})\b/i,
  ];
  let last4: string | null = null;
  let source: "text" | "filename" = "text";
  for (const line of rawLines) {
    for (const re of patterns) {
      const m = line.match(re);
      if (m) {
        last4 = m[1];
        break;
      }
    }
    if (last4) break;
  }
  if (!last4 && filename) {
    const m = filename.match(/statements?[_-](\d{4})[_-]/i) ?? filename.match(/(?:^|[_-])(\d{4})(?:[_-]\d{2}-\d{2}-\d{2,4})/);
    if (m) {
      last4 = m[1];
      source = "filename";
    }
  }
  if (!last4) return null;
  const text = rawLines.filter((l) => !isDateLed(l)).slice(0, 40).join(" ");
  const pm = text.match(PRODUCT_NEAR_CARD);
  const name = pm ? pm[1] ?? pm[2] : null;
  const product = name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  return { last4, product, source };
}
