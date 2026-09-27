// Statement parser for HDFC Bank and ICICI Bank credit card statements.
//
// Input: lines per page, already passed through redact.ts. Output: one row
// per purchase, EMI or fee, with GST and forex markup folded into the row
// they belong to, so the table shows what each purchase really cost.
//
// The two banks differ mostly in layout, not in content, so one tolerant
// line grammar covers both:
//   <date> [serial] <description ...> [points] [foreign amount] <amount> [Cr]
// and the bank profile only decides defaults. Pure and dependency-light so it
// can run in the browser and in a Node test.

import { categorize } from "@/lib/receipt/categorize";
import { cleanDescription, isDateLed, isHeading, keepLine, redactLine } from "./redact";
import type { Bank, ForeignInfo, ParsedStatement, RowKind, RowPart, StatementRow } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const CURRENCIES = new Set([
  "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY", "CHF", "THB", "MYR",
  "HKD", "NZD", "SAR", "QAR", "LKR", "NPR", "BDT", "CNY", "KRW", "IDR", "VND",
  "PHP", "TRY", "ZAR", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RUB", "MXN",
  "BRL", "EGP", "KES", "MUR", "MVR", "OMR", "BHD", "KWD", "TWD", "ILS",
]);

const AMOUNT = /^(?:₹|Rs\.?|INR)?\(?(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?\)?$/;
const CREDIT_MARK = /^(cr|dr)\.?$/i;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${pad(m)}-${pad(d)}`;
}

/** Reads a date at tokens[i]. Returns the ISO date and how many tokens it used. */
function readDate(tokens: string[], i: number): { date: string; used: number } | null {
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

function readAmount(tok: string): { amount: number; credit: boolean } | null {
  let credit = false;
  let t = tok;
  const suffix = t.match(/^(.*?)(cr|dr)\.?$/i);
  if (suffix && AMOUNT.test(suffix[1])) {
    credit = suffix[2].toLowerCase() === "cr";
    t = suffix[1];
  }
  const m = t.match(AMOUNT);
  if (!m) return null;
  const whole = m[1].replace(/,/g, "");
  const amount = parseFloat(`${whole}.${m[2] ?? "00"}`);
  if (!Number.isFinite(amount)) return null;
  if (t.startsWith("(") && t.endsWith(")")) credit = true;
  return { amount, credit };
}

function readForeign(tokens: string[]): { currency: string; amount: number; used: number } | null {
  const n = tokens.length;
  const a = tokens[n - 2];
  const b = tokens[n - 1];
  if (a && b) {
    const A = a.toUpperCase();
    const B = b.toUpperCase();
    if (CURRENCIES.has(A) && readAmount(b)) return { currency: A, amount: readAmount(b)!.amount, used: 2 };
    if (CURRENCIES.has(B) && readAmount(a)) return { currency: B, amount: readAmount(a)!.amount, used: 2 };
  }
  if (b) {
    const m = b.toUpperCase().match(/^([A-Z]{3})(\d[\d,]*(?:\.\d{1,2})?)$/) ?? b.toUpperCase().match(/^(\d[\d,]*(?:\.\d{1,2})?)([A-Z]{3})$/);
    if (m) {
      const code = CURRENCIES.has(m[1]) ? m[1] : CURRENCIES.has(m[2]) ? m[2] : null;
      const amt = readAmount(CURRENCIES.has(m[1]) ? m[2] : m[1]);
      if (code && amt) return { currency: code, amount: amt.amount, used: 1 };
    }
  }
  return null;
}

interface Line {
  page: number;
  index: number;
  date: string;
  description: string;
  amount: number;
  credit: boolean;
  foreign: { currency: string; amount: number } | null;
  section: Section;
  text: string;
}

type Section = "unknown" | "domestic" | "international" | "emi";

/** One transaction line, or null when the line is not one. */
export function parseLine(text: string): Omit<Line, "page" | "index" | "section" | "text"> | null {
  const tokens = text.trim().split(/\s+/);
  const d = readDate(tokens, 0);
  if (!d) return null;
  const rest = tokens.slice(d.used);
  if (rest.length < 2) return null;

  let credit = false;
  if (CREDIT_MARK.test(rest[rest.length - 1])) {
    credit = /^cr/i.test(rest.pop()!);
  }
  const amt = readAmount(rest[rest.length - 1]);
  if (!amt) return null;
  rest.pop();
  credit = credit || amt.credit;

  const foreign = readForeign(rest);
  if (foreign) rest.splice(rest.length - foreign.used, foreign.used);

  // A trailing small integer is a reward-points column, not part of the name.
  if (rest.length >= 2 && /^-?\d{1,6}$/.test(rest[rest.length - 1])) rest.pop();
  // A leading reference is a serial number column (already redacted).
  while (rest.length > 1 && /^(\[ref\]|\d{6,})$/.test(rest[0])) rest.shift();

  const description = rest.join(" ").replace(/^[-:|]+\s*/, "");
  if (!description) return null;
  return {
    date: d.date,
    description,
    amount: amt.amount,
    credit,
    foreign: foreign ? { currency: foreign.currency, amount: foreign.amount } : null,
  };
}

function sectionOf(line: string): Section | null {
  if (!isHeading(line) || isDateLed(line)) return null;
  if (/\b(international|overseas)\b/i.test(line)) return "international";
  if (/\bdomestic\b/i.test(line)) return "domestic";
  if (/\b(emi|instal?lments?|loan)\b/i.test(line) && /\b(details?|summary|transactions?|outstanding|schedule|conversion)\b/i.test(line))
    return "emi";
  if (/\btransactions?\b/i.test(line) && /\b(details?|summary|list)\b/i.test(line)) return "domestic";
  return null;
}

export function detectBank(lines: string[]): Bank {
  const head = lines.slice(0, 80).join(" ");
  if (/\bHDFC\b/i.test(head)) return "hdfc";
  if (/\bICICI\b/i.test(head)) return "icici";
  const all = lines.join(" ");
  if (/\bHDFC\b/i.test(all)) return "hdfc";
  if (/\bICICI\b/i.test(all)) return "icici";
  return "unknown";
}

const GST_RE = /\b(?:i|c|s|ut)?gst\b/i;
const MARKUP_RE = /mark[ -]?up|forex|\bfx\b|cross[ -]?currency|currency conv|\bdcc\b|intl\.? ?(?:txn|transaction)? ?fee|international (?:txn|transaction) fee/i;
const FEE_RE = /\bfees?\b|\bcharges?\b|surcharge|late payment|over ?limit|finance charge|interest charge|annual membership|joining/i;
const EMI_RE = /\bemi\b|instal?lment/i;
const PRINCIPAL_RE = /principal/i;
const INTEREST_RE = /interest/i;

const MERCHANTS: [RegExp, string][] = [
  [/swiggy|zomato|domino|pizza|mcdonald|kfc|burger|starbucks|cafe|coffee|restaurant|eatsure|barbeque|biryani|dine/i, "Dining Out"],
  [/bigbasket|blinkit|zepto|instamart|dmart|d-mart|grofers|reliance fresh|more retail|kirana|supermarket|grocer/i, "Groceries"],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|croma|reliance digital|decathlon|ikea|tata cliq|shoppers stop|lifestyle|zara|h&m|uniqlo/i, "Shopping"],
  [/netflix|spotify|hotstar|prime video|youtube|apple\.com|apple bill|google \*|google play|openai|chatgpt|anthropic|claude|microsoft|adobe|notion|github|jio ?cinema|sony ?liv|zee5|canva|dropbox|icloud|kindle/i, "Subscriptions"],
  [/irctc|indigo|air india|vistara|akasa|spicejet|makemytrip|goibibo|redbus|\boyo\b|airbnb|booking\.com|agoda|hotel|yatra|cleartrip|ixigo|emirates|lufthansa|resort/i, "Travel"],
  [/\buber\b|\bola\b|rapido|petrol|hpcl|bpcl|indian oil|iocl|\bshell\b|fastag|metro|parking|\bbmtc\b|\bdmrc\b|namma|rail/i, "Transport"],
  [/pharm|apollo|medplus|1mg|netmeds|hospital|clinic|diagnostic|practo|dental|lab\b/i, "Healthcare"],
  [/electricity|bescom|tata power|adani|bses|msedcl|airtel|\bjio\b|vodafone|\bvi\b|bsnl|act fibernet|broadband|indane|\bgas\b|water|tneb|kseb/i, "Utilities"],
  [/\bpvr\b|inox|bookmyshow|cinepolis|gaming|steam|playstation|xbox|nintendo|cinema/i, "Entertainment"],
  [/cult\.?fit|gym|fitness|salon|spa\b|yoga|wellness/i, "Wellness"],
  [/\brent\b|nobroker|housing|maintenance|society/i, "Housing"],
];

function categoryFor(description: string, kind: RowKind): string {
  for (const [re, cat] of MERCHANTS) if (re.test(description)) return cat;
  if (kind === "emi") return "Other";
  return categorize(description) || "Other";
}

function installmentOf(description: string): string | null {
  const m = description.match(/\b(\d{1,2})\s*(?:of|\/)\s*(\d{1,3})\b/i);
  return m ? `${m[1]} of ${m[2]}` : null;
}

/** The description without the part words, so EMI lines can be grouped. */
function emiStem(description: string): string {
  return description
    .replace(/\b(principal|interest|amount|amt|igst|cgst|sgst|gst|on|emi)\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function ratioClose(a: number, b: number, tolerance: number): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / b <= tolerance;
}

function newRow(line: Line, kind: RowKind, part: RowPart): StatementRow {
  return {
    id: `${line.page}-${line.index}`,
    kind,
    date: line.date,
    description: cleanDescription(line.description),
    total: 0,
    credit: line.credit,
    parts: [part],
    foreign: null,
    installment: null,
    category: "Other",
    page: line.page,
  };
}

function statementDateOf(lines: string[]): string | null {
  for (const line of lines) {
    if (!/statement (date|period)/i.test(line)) continue;
    const tokens = line.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const d = readDate(tokens, i);
      if (d) return d.date;
    }
  }
  return null;
}

/**
 * Parses a statement. `pages` holds the raw lines of each page; redaction
 * happens here first, so callers can pass PDF text straight in.
 */
export function parseStatement(pages: string[][]): ParsedStatement {
  const redactedLines: string[] = [];
  const lines: Line[] = [];
  const unparsed: { page: number; text: string }[] = [];
  const warnings: string[] = [];
  const headings: string[] = [];
  let section: Section = "unknown";
  let index = 0;

  pages.forEach((rawLines, p) => {
    const page = p + 1;
    for (const raw of rawLines) {
      if (!keepLine(raw)) continue;
      const text = redactLine(raw);
      if (!text) continue;
      const s = sectionOf(text);
      if (s) {
        section = s;
        headings.push(text);
        // Only the section name is kept: a heading can share its line with
        // the header column next to it, which may hold the name or address.
        redactedLines.push(`## ${s}`);
        continue;
      }
      if (!isDateLed(text)) continue;
      redactedLines.push(text);
      const parsed = parseLine(text);
      if (!parsed) {
        unparsed.push({ page, text });
        continue;
      }
      lines.push({ ...parsed, page, index: index++, section, text });
    }
  });

  const bank = detectBank(pages.flat());
  const rows: StatementRow[] = [];
  let emiRow: StatementRow | null = null;
  let emiStemKey = "";
  let lastIndex = -1;

  const closeEmi = () => {
    emiRow = null;
    emiStemKey = "";
  };

  for (const line of lines) {
    const desc = line.description;
    // A GST line may name what it taxes ("IGST ON MARKUP FEE"), so GST wins.
    const isGst = GST_RE.test(desc);
    const isMarkup = MARKUP_RE.test(desc) && !isGst;
    const isEmi = line.section === "emi" || EMI_RE.test(desc);
    const isFee = FEE_RE.test(desc) && !isEmi;
    const adjacent = line.index === lastIndex + 1;
    lastIndex = line.index;

    // EMI: principal, interest and the GST on interest arrive as neighbours.
    if (isEmi && !line.credit) {
      const stem = emiStem(desc);
      const kind: RowPart["kind"] = isGst
        ? "gst"
        : PRINCIPAL_RE.test(desc)
          ? "principal"
          : INTEREST_RE.test(desc)
            ? "interest"
            : "base";
      const label =
        kind === "principal" ? "Principal" : kind === "interest" ? "Interest" : kind === "gst" ? "GST on interest" : "EMI";
      const sameEmi =
        emiRow && adjacent && (stem === emiStemKey || kind !== "base") && !emiRow.parts.some((x) => x.kind === kind);
      if (sameEmi && emiRow) {
        emiRow.parts.push({ kind, label, amount: line.amount });
      } else {
        emiRow = newRow(line, "emi", { kind, label, amount: line.amount });
        emiStemKey = stem;
        rows.push(emiRow);
      }
      emiRow.installment ??= installmentOf(desc);
      continue;
    }
    if (isGst && emiRow && adjacent && emiRow.date === line.date && !emiRow.parts.some((x) => x.kind === "gst")) {
      emiRow.parts.push({ kind: "gst", label: "GST on interest", amount: line.amount });
      continue;
    }
    closeEmi();

    const intl = line.foreign !== null || line.section === "international";

    if (isGst && !line.credit) {
      const target = findGstTarget(rows, line, adjacent);
      if (target) {
        const onMarkup = target.parts.some((x) => x.kind === "markup") || target.kind === "international";
        target.parts.push({ kind: "gst", label: onMarkup ? "GST on forex markup" : "GST", amount: line.amount });
        continue;
      }
      rows.push(newRow(line, intl ? "international" : "domestic", { kind: "gst", label: "GST", amount: line.amount }));
      continue;
    }

    if (isMarkup && !line.credit) {
      const target = findMarkupTarget(rows, line);
      if (target) {
        target.parts.push({ kind: "markup", label: "Forex markup", amount: line.amount });
        continue;
      }
      rows.push(newRow(line, intl ? "international" : "domestic", { kind: "markup", label: "Forex markup", amount: line.amount }));
      continue;
    }
    const kind: RowKind = intl ? "international" : "domestic";
    const row = newRow(line, kind, {
      kind: isFee ? "fee" : "base",
      label: isFee ? "Fee" : intl ? "Purchase (converted)" : "Purchase",
      amount: line.amount,
    });
    if (line.foreign) {
      row.foreign = { currency: line.foreign.currency, amount: line.foreign.amount, rate: 0, effectiveRate: 0 };
    }
    rows.push(row);
  }

  resolveOrphans(rows);

  for (const row of rows) {
    row.total = round2(row.parts.reduce((s, x) => s + x.amount, 0));
    row.category = categoryFor(row.description, row.kind);
    if (row.foreign && row.foreign.amount > 0) {
      const base = row.parts.find((x) => x.kind === "base")?.amount ?? row.total;
      row.foreign = {
        ...row.foreign,
        rate: round2(base / row.foreign.amount),
        effectiveRate: round2(row.total / row.foreign.amount),
      };
    }
  }

  const statementDate = statementDateOf(pages.flat().map(redactLine));
  const period = statementDate?.slice(0, 7) ?? commonMonth(rows);
  if (rows.length === 0) warnings.push("No transactions were found. The statement may be a scanned image or an unsupported layout.");
  if (unparsed.length > 0) warnings.push(`${unparsed.length} line(s) looked like transactions but could not be read.`);
  if (bank === "unknown") warnings.push("Could not tell whether this is an HDFC or ICICI statement; parsed with the generic rules.");
  if (headings.length === 0 && rows.length > 0) warnings.push("No section headings found; domestic and international were told apart by currency only.");

  return { bank, statementDate, period, rows, unparsed, redactedLines, warnings };
}

/** The international purchase a markup line belongs to. */
function findMarkupTarget(rows: StatementRow[], line: Line): StatementRow | null {
  const candidates = rows.filter(
    (r) => r.kind === "international" && !r.credit && !r.parts.some((x) => x.kind === "markup"),
  );
  // Nearest earlier purchase whose 1% to 5% is this amount.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const base = candidates[i].parts.find((x) => x.kind === "base")?.amount ?? 0;
    const pct = base > 0 ? line.amount / base : 0;
    if (pct >= 0.01 && pct <= 0.055) return candidates[i];
  }
  // Otherwise the purchase right before it.
  const prev = rows[rows.length - 1];
  return prev && prev.kind === "international" && !prev.credit && `${prev.page}-${line.index - 1}` === prev.id ? prev : null;
}

/** The row a GST line belongs to: a markup, a fee, or a forex purchase. */
function findGstTarget(rows: StatementRow[], line: Line, adjacent: boolean): StatementRow | null {
  const prev = rows[rows.length - 1];
  const prevIsNeighbour = prev && adjacent && prev.id === `${prev.page}-${line.index - 1}`;
  // GST on a markup: 18% of the markup part.
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.credit || r.parts.some((x) => x.kind === "gst")) continue;
    const markup = r.parts.find((x) => x.kind === "markup")?.amount;
    if (markup && ratioClose(line.amount, markup * 0.18, 0.05)) return r;
  }
  // GST on a fee printed right before it.
  if (prevIsNeighbour && prev.parts.some((x) => x.kind === "fee") && !prev.parts.some((x) => x.kind === "gst")) return prev;
  // GST on a forex markup the bank folded into the rate: 18% of 3.5%.
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.kind !== "international" || r.credit || r.parts.some((x) => x.kind === "gst" || x.kind === "markup")) continue;
    const base = r.parts.find((x) => x.kind === "base")?.amount ?? 0;
    if (ratioClose(line.amount, base * 0.035 * 0.18, 0.08)) return r;
  }
  // An interest or fee line right before it in the same section.
  if (prevIsNeighbour && prev.kind !== "emi" && !prev.credit && !prev.parts.some((x) => x.kind === "gst") && FEE_RE.test(prev.description))
    return prev;
  return null;
}

/**
 * Second pass for charges printed away from what they belong to. HDFC lists
 * the IGST on forex markup under Domestic Transactions, before the
 * International section, so on the first pass its purchase did not exist yet.
 */
function resolveOrphans(rows: StatementRow[]): void {
  const isOrphan = (r: StatementRow, kind: RowPart["kind"]) =>
    r.parts.length === 1 && r.parts[0].kind === kind && !r.credit;

  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!isOrphan(r, "markup")) continue;
    const amount = r.parts[0].amount;
    const target = rows.find((t) => {
      if (t === r || t.kind !== "international" || t.credit || t.parts.some((x) => x.kind === "markup")) return false;
      const base = t.parts.find((x) => x.kind === "base")?.amount ?? 0;
      const pct = base > 0 ? amount / base : 0;
      return pct >= 0.01 && pct <= 0.055;
    });
    if (target) {
      target.parts.push({ kind: "markup", label: "Forex markup", amount });
      rows.splice(i, 1);
    }
  }

  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!isOrphan(r, "gst")) continue;
    const amount = r.parts[0].amount;
    const byMarkup = rows.find((t) => {
      if (t === r || t.credit || t.parts.some((x) => x.kind === "gst")) return false;
      const markup = t.parts.find((x) => x.kind === "markup")?.amount;
      return !!markup && ratioClose(amount, markup * 0.18, 0.05);
    });
    const target =
      byMarkup ??
      rows.find((t) => {
        if (t === r || t.kind !== "international" || t.credit || t.parts.some((x) => x.kind === "gst" || x.kind === "markup"))
          return false;
        const base = t.parts.find((x) => x.kind === "base")?.amount ?? 0;
        return ratioClose(amount, base * 0.035 * 0.18, 0.08);
      });
    if (target) {
      target.parts.push({ kind: "gst", label: "GST on forex markup", amount });
      rows.splice(i, 1);
    }
  }
}

function commonMonth(rows: StatementRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = r.date.slice(0, 7);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}
