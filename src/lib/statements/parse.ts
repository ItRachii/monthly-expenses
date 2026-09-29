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
import { cleanDescription, isDateLed, isHeading, keepLine, makeRefTagger, redactLine, type RefTagging } from "./redact";
import { readDate } from "./dates";
import { cardIdentity, parseSummary } from "./summary";
import type { PageText } from "./lines";
import type { Bank, CardIdentity, ForeignInfo, ParsedStatement, RowKind, RowPart, StatementLoan, StatementRow, StatementSummary } from "./types";

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

export function readForeign(tokens: string[]): { currency: string; amount: number; used: number } | null {
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

export interface Line {
  page: number;
  index: number;
  date: string;
  description: string;
  /** Token of the "(Ref# …)" transaction reference printed on the line. */
  ref: string | null;
  amount: number;
  credit: boolean;
  foreign: { currency: string; amount: number } | null;
  section: Section;
  text: string;
}

export type Section = "unknown" | "domestic" | "international" | "emi";

/**
 * HDFC tags purchases that could be converted with an "EMI" badge. That is
 * an offer, not an EMI: drop it unless the line really is an instalment.
 */
export function dropEmiBadge(words: string[]): void {
  if (words.length > 1 && /^emi$/i.test(words[0]) && !/^(?:prin|int|instal|amt|amount|i?gst|conv|proc|fee)/i.test(words[1])) words.shift();
}

/** The per-parse token of the "(Ref# …)" reference in a redacted description. */
export function citedRef(description: string): string | null {
  return description.match(/\(\s*ref\s*#?\s*[A-Z]{0,3}\s*\[ref:([0-9a-f]{4})\]\s*\)/i)?.[1] ?? null;
}

/** One transaction line, or null when the line is not one. */
export function parseLine(text: string): Omit<Line, "page" | "index" | "section" | "text"> | null {
  const tokens = text.trim().split(/\s+/);
  // The date column may end with its separator: "22/08/2026|".
  tokens[0] = tokens[0].replace(/\|+$/, "");
  const d = readDate(tokens, 0);
  if (!d) return null;
  const rest = tokens.slice(d.used);
  // Column separators and a time-of-day column ("| 03:51") after the date.
  while (rest.length && (rest[0] === "|" || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(rest[0]))) rest.shift();
  if (rest.length < 2) return null;

  // Stray glyphs after the amount: HDFC's font prints the rupee sign as "C"
  // before the number and leaves an "l" after it.
  let junk = 0;
  while (
    rest.length > 1 &&
    junk < 2 &&
    !readAmount(rest[rest.length - 1]) &&
    !CREDIT_MARK.test(rest[rest.length - 1]) &&
    /^[^\d₹]{1,2}$/.test(rest[rest.length - 1])
  ) {
    rest.pop();
    junk++;
  }

  let credit = false;
  if (CREDIT_MARK.test(rest[rest.length - 1])) {
    credit = /^cr/i.test(rest.pop()!);
  }
  const amt = readAmount(rest[rest.length - 1]);
  if (!amt) return null;
  rest.pop();
  credit = credit || amt.credit;
  // A currency symbol printed as its own token, then a sign column.
  if (rest.length && /^(?:₹|rs\.?|inr|c)$/i.test(rest[rest.length - 1])) rest.pop();
  if (rest.length && rest[rest.length - 1] === "+") {
    credit = true;
    rest.pop();
  } else if (rest.length && rest[rest.length - 1] === "-") {
    rest.pop();
  }

  const foreign = readForeign(rest);
  if (foreign) rest.splice(rest.length - foreign.used, foreign.used);

  // A trailing small integer is a reward-points column, not part of the name.
  if (rest.length >= 2 && /^-?\d{1,6}$/.test(rest[rest.length - 1])) rest.pop();
  // A leading reference is a serial number column (already redacted).
  while (rest.length > 1 && /^(\[ref(?::[0-9a-f]{4})?\]|\d{6,})$/.test(rest[0])) rest.shift();
  dropEmiBadge(rest);

  const description = rest.join(" ").replace(/^[-:|]+\s*/, "");
  if (!description) return null;
  const ref = citedRef(description);
  return {
    date: d.date,
    description,
    ref,
    amount: amt.amount,
    credit,
    foreign: foreign ? { currency: foreign.currency, amount: foreign.amount } : null,
  };
}

export function sectionOf(line: string): Section | null {
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
const MARKUP_RE = /mark[ -]?u ?p\b|forex|\bfx\b|\bfcy\b|cross[ -]?currency|currency conv|\bdcc\b|intl\.? ?(?:txn|transaction)? ?fee|international (?:txn|transaction) fee/i;
const FEE_RE = /\bfees?\b|\bcharges?\b|surcharge|late payment|over ?limit|finance charge|interest charge|annual membership|joining/i;
const EMI_RE = /\bemi\b|instal?lment/i;
// "EMI PRINCIPAL AMT", "OFFUS EMI,PRIN NB:02", "EMI INTEREST", "EMI,INT NBR:02"
const PRINCIPAL_RE = /\bprin(?:cipal)?\b/i;
const INTEREST_RE = /\bint(?:erest)?\b/i;

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
  if (m) return `${m[1]} of ${m[2]}`;
  // HDFC: "NB:02" / "NBR:02" is the instalment number.
  const n = description.match(/\bNBR?\s*:\s*0*(\d{1,2})\b/i);
  return n ? `#${n[1]}` : null;
}

/** The description without the part words, so EMI lines can be grouped. */
function emiStem(description: string): string {
  return description
    .replace(/\b(principal|prin|interest|int|amount|amt|igst|cgst|sgst|gst|on|emi|nbr?|ref)\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

/**
 * The loan number pseudonym on an EMI line: a reference token outside the
 * "(Ref# …)" group, which holds the per-line transaction reference instead.
 */
function loanKeyOf(description: string): string | null {
  const outside = description.replace(/\([^)]*\)/g, " ");
  return outside.match(/\[ref:([0-9a-f]{4})\]/)?.[1] ?? null;
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
    loan: null,
    gstFor: null,
    untraced: false,
    taxRef: null,
    taxRefKey: null,
    category: "Other",
    page: line.page,
  };
}

/** The GST label for the part it taxes. */
function gstLabelFor(kind: RowPart["kind"]): string {
  return kind === "interest" ? "GST on interest" : kind === "markup" ? "GST on forex markup" : kind === "fee" ? "GST on fee" : "GST";
}

function instalmentNumber(installment: string | null): number | null {
  const m = installment?.match(/^#?(\d{1,3})/);
  return m ? Number(m[1]) : null;
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
export function parseStatement(input: (string[] | PageText)[], opts: { filename?: string } = {}): ParsedStatement {
  // Plain lines, or lines with positions. Positions are used only to read
  // the summary box, whose labels and figures are laid out in columns.
  const pages = input.map((p) => (Array.isArray(p) ? p : p.lines));
  const rowPages = input.flatMap((p) => (Array.isArray(p) ? [] : [p.rows]));
  const redactedLines: string[] = [];
  const lines: Line[] = [];
  const unparsed: { page: number; text: string }[] = [];
  const headings: string[] = [];
  let section: Section = "unknown";
  let index = 0;
  const tagger = makeRefTagger();

  pages.forEach((rawLines, p) => {
    const page = p + 1;
    for (const raw of rawLines) {
      if (!keepLine(raw)) continue;
      const text = redactLine(raw, tagger.tag);
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
  const { rows, tokenDigits } = buildRows(lines, tagger);
  const allRedacted = pages.flat().map((l) => redactLine(l));
  const { summary, notes } = parseSummary(allRedacted, rowPages);
  return assembleStatement({
    bank,
    rows,
    tokenDigits,
    summary,
    summaryNotes: notes,
    statementDateFallback: statementDateOf(allRedacted),
    identity: cardIdentity(pages.flat(), opts.filename),
    unparsed,
    redactedLines,
    sectioned: headings.length > 0,
    loans: [],
    gstBilled: null,
  });
}

/**
 * Rows from transaction lines, with GST, forex markup and EMI parts folded
 * into what they belong to. Shared by PDF text and spreadsheets, so both
 * follow exactly the same rules.
 */
export function buildRows(lines: Line[], tagger: RefTagging): { rows: StatementRow[]; tokenDigits: Record<string, string> } {
  const rows: StatementRow[] = [];
  let emiRow: StatementRow | null = null;
  let emiStemKey = "";
  // EMI rows by loan number pseudonym and instalment, for statements that
  // print several loans' lines apart from each other.
  const emiByLoan = new Map<string, StatementRow>();
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
    // "OFFUS EMI,PROCNG FEE" is a fee on the loan, not an instalment.
    const emiFee = EMI_RE.test(desc) && /\bfees?\b/i.test(desc);
    const isEmi = (line.section === "emi" || EMI_RE.test(desc)) && !emiFee;
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
      const installment = installmentOf(desc);
      const loan = loanKeyOf(desc);
      const loanKey = loan ? `${loan}|${installment ?? ""}` : null;
      const byLoan = loanKey ? emiByLoan.get(loanKey) : undefined;
      if (byLoan && !byLoan.parts.some((x) => x.kind === kind)) {
        // Same loan number and instalment: pair it, wherever it was printed.
        byLoan.parts.push({ kind, label, amount: line.amount, ref: line.ref });
        emiRow = byLoan;
      } else {
        const sameEmi =
          !loanKey && emiRow && adjacent && (stem === emiStemKey || kind !== "base") && !emiRow.parts.some((x) => x.kind === kind);
        if (sameEmi && emiRow) {
          emiRow.parts.push({ kind, label, amount: line.amount, ref: line.ref });
        } else {
          emiRow = newRow(line, "emi", { kind, label, amount: line.amount, ref: line.ref });
          emiStemKey = stem;
          rows.push(emiRow);
          if (loanKey) emiByLoan.set(loanKey, emiRow);
        }
      }
      emiRow.installment ??= installment;
      if (loan && !emiRow.loan?.token) {
        const digits = tagger.digitsOf(`[ref:${loan}]`);
        emiRow.loan = { token: loan, key: null, last4: digits ? digits.slice(-4) : null, instalmentNo: instalmentNumber(emiRow.installment) };
      }
      emiRow.loan ??= { token: null, key: null, last4: null, instalmentNo: instalmentNumber(emiRow.installment) };
      continue;
    }
    // A GST line that cites the reference of the line it taxes: exact.
    if (isGst && line.ref && !line.credit) {
      const cited = rows.find((t) => !t.credit && !t.parts.some((x) => x.kind === "gst") && t.parts.some((x) => x.ref === line.ref && x.kind !== "gst"));
      if (cited) {
        const taxed = cited.parts.find((x) => x.ref === line.ref)!;
        cited.parts.push({ kind: "gst", label: gstLabelFor(taxed.kind), amount: line.amount, ref: line.ref });
        continue;
      }
    }
    if (isGst && emiRow && adjacent && emiRow.date === line.date && !emiRow.parts.some((x) => x.kind === "gst")) {
      emiRow.parts.push({ kind: "gst", label: "GST on interest", amount: line.amount, ref: line.ref });
      continue;
    }
    closeEmi();

    const intl = line.foreign !== null || line.section === "international";

    if (isGst && !line.credit) {
      const target = findGstTarget(rows, line, adjacent);
      if (target) {
        const onMarkup = target.parts.some((x) => x.kind === "markup") || target.kind === "international";
        target.parts.push({ kind: "gst", label: onMarkup ? "GST on forex markup" : "GST", amount: line.amount, ref: line.ref });
        continue;
      }
      const lone = newRow(line, intl ? "international" : "domestic", { kind: "gst", label: "GST", amount: line.amount, ref: line.ref });
      lone.taxRef = line.ref;
      rows.push(lone);
      continue;
    }

    if (isMarkup && !line.credit) {
      const target = findMarkupTarget(rows, line);
      if (target) {
        target.parts.push({ kind: "markup", label: "Forex markup", amount: line.amount, ref: line.ref });
        continue;
      }
      rows.push(newRow(line, intl ? "international" : "domestic", { kind: "markup", label: "Forex markup", amount: line.amount, ref: line.ref }));
      continue;
    }
    const kind: RowKind = intl ? "international" : "domestic";
    const row = newRow(line, kind, {
      kind: isFee ? "fee" : "base",
      label: isFee ? (emiFee ? "EMI processing fee" : "Fee") : intl ? "Purchase (converted)" : "Purchase",
      amount: line.amount,
      ref: line.ref,
    });
    if (line.foreign) {
      row.foreign = { currency: line.foreign.currency, amount: line.foreign.amount, rate: 0, effectiveRate: 0 };
    }
    rows.push(row);
  }

  resolveOrphans(rows);
  // What is left alone is a charge nothing in this statement explains. The
  // browser may still trace it to an instalment on record (lineage.ts).
  for (const r of rows) {
    if (!r.credit && r.parts.length === 1 && r.parts[0].kind === "gst") r.untraced = true;
  }
  const tokenDigits: Record<string, string> = {};
  const remember = (token: string | null | undefined) => {
    const d = token ? tagger.digitsOf(`[ref:${token}]`) : undefined;
    if (token && d) tokenDigits[token] = d;
  };
  for (const r of rows) {
    remember(r.loan?.token);
    remember(r.taxRef);
    for (const p of r.parts) remember(p.ref);
  }

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

  return { rows, tokenDigits };
}

export interface AssembleInput {
  bank: Bank;
  rows: StatementRow[];
  tokenDigits: Record<string, string>;
  summary: StatementSummary | null;
  summaryNotes: string[];
  statementDateFallback: string | null;
  identity: { last4: string; product: string | null; source: "text" | "filename" } | null;
  unparsed: { page: number; text: string }[];
  redactedLines: string[];
  /** Whether rows were told apart by section headings or a type column. */
  sectioned: boolean;
  loans: StatementLoan[];
  /** GST the statement's own GST summary says was billed, when it has one. */
  gstBilled: number | null;
}

/** Period, card, notes and warnings: the last step for every source. */
export function assembleStatement(a: AssembleInput): ParsedStatement {
  const { bank, rows, tokenDigits, summary, unparsed, redactedLines, loans, gstBilled } = a;
  const warnings: string[] = [];
  const statementDate = summary?.statementDate ?? a.statementDateFallback;
  if (summary && !summary.statementDate) summary.statementDate = statementDate;
  const period = statementDate?.slice(0, 7) ?? commonMonth(rows);
  const identity = a.identity;
  const card: CardIdentity | null = identity ? { last4: identity.last4, product: identity.product } : null;
  if (a.summaryNotes.length > 0) redactedLines.push("## summary", ...a.summaryNotes);
  for (const l of loans) {
    redactedLines.push(
      `## loan …${l.last4 ?? "?"}: ${l.type ?? "loan"}, booked ${l.bookedOn ?? "?"}, amount ${l.amount ?? "?"}, tenure ${l.tenureMonths ?? "?"}, rate ${l.ratePct ?? "?"}%, principal left ${l.principalOutstanding ?? "?"}, interest left ${l.interestPayable ?? "?"}, months left ${l.remainingMonths ?? "?"}`,
    );
  }
  if (gstBilled !== null) {
    const read = round2(rows.flatMap((r) => r.parts).filter((x) => x.kind === "gst").reduce((sum, x) => sum + x.amount, 0));
    redactedLines.push(`## gst: statement says ${gstBilled.toFixed(2)}, lines read add up to ${read.toFixed(2)}`);
    if (Math.abs(read - gstBilled) > 0.01)
      warnings.push(`The statement's GST summary says ₹${gstBilled.toFixed(2)} of GST was billed, but the GST lines read add up to ₹${read.toFixed(2)}. A line may have been missed.`);
  }
  redactedLines.push(`## card: ${identity ? `last4 from ${identity.source}${identity.product ? `, ${identity.product}` : ""}` : "not found"}`);
  if (!summary) warnings.push("No summary figures (dues, limits, due date) were found, so nothing can be saved for the card.");
  if (!card) warnings.push("No card number found, so the summary cannot be filed under a card.");
  if (rows.length === 0) warnings.push("No transactions were found. The statement may be a scanned image or an unsupported layout.");
  if (unparsed.length > 0) warnings.push(`${unparsed.length} line(s) looked like transactions but could not be read.`);
  if (bank === "unknown") warnings.push("Could not tell whether this is an HDFC or ICICI statement; parsed with the generic rules.");
  if (!a.sectioned && rows.length > 0) warnings.push("No section headings found; domestic and international were told apart by currency only.");

  return { bank, summary, card, statementDate, period, rows, unparsed, tokenDigits, redactedLines, warnings, loans, gstBilled };
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

  // A GST charge citing the reference of a line printed after it: exact.
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!isOrphan(r, "gst") || !r.taxRef) continue;
    const cited = rows.find((t) => t !== r && !t.credit && !t.parts.some((x) => x.kind === "gst") && t.parts.some((x) => x.ref === r.taxRef && x.kind !== "gst"));
    if (cited) {
      const taxed = cited.parts.find((x) => x.ref === r.taxRef)!;
      cited.parts.push({ kind: "gst", label: gstLabelFor(taxed.kind), amount: r.parts[0].amount, ref: r.taxRef });
      rows.splice(i, 1);
    }
  }

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

  // GST on an instalment's interest billed the same day, printed apart:
  // 18% of the interest, on the instalment's date.
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!isOrphan(r, "gst")) continue;
    const amount = r.parts[0].amount;
    const target = rows.find((t) => {
      if (t === r || t.kind !== "emi" || t.date !== r.date || t.parts.some((x) => x.kind === "gst")) return false;
      const interest = t.parts.find((x) => x.kind === "interest")?.amount ?? 0;
      return ratioClose(amount, interest * 0.18, 0.02);
    });
    if (target) {
      target.parts.push({ kind: "gst", label: "GST on interest", amount });
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
