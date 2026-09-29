// Credit card statements exported as a spreadsheet (.xlsx) or CSV.
//
// A spreadsheet is a grid, not a stream of text, so nothing has to be
// guessed from a line's shape: the transaction table is found by its header
// names, each value is read from its own column, and the summary is read
// from labelled cells. The rows then go through the same builder as PDF
// text (parse.ts buildRows), so EMI pairing, GST joins and forex markup
// follow exactly the same rules.
//
// Privacy, as for PDFs: this runs on the device. Only these cells are read
// into the pipeline:
//  - the date, description, amount, debit/credit and type columns of the
//    transaction table (never the name, rewards or reference columns);
//  - cells holding a summary label, and the figure next to or below it;
//  - the loan summary and GST summary tables;
//  - cells mentioning "card", for the last four digits only.
// Descriptions pass through the same deny-list redaction as PDF lines. The
// name, address, CKYC ID and account numbers in the header are never read.

import { readDate } from "./dates";
import { makeRefTagger, redactLine } from "./redact";
import { assembleStatement, buildRows, citedRef, detectBank, dropEmiBadge, readForeign, sectionOf, type Line, type Section } from "./parse";
import { amountOf, cardIdentity, labelsIn, type Found } from "./summary";
import type { ParsedStatement, StatementLoan, StatementSummary } from "./types";

export type CellValue = string | number | Date | null;

/** One worksheet as rows of cells. A merged area holds its value in its first cell only. */
export type Grid = CellValue[][];

// ---- CSV --------------------------------------------------------------

/** Splits CSV text into a grid. Quoted fields, doubled quotes, CRLF, and comma, semicolon or tab delimiters. */
export function parseCsv(text: string): Grid {
  const src = text.replace(/^﻿/, "");
  const sample = src.split(/\r?\n/).slice(0, 20).join("\n");
  const count = (ch: string) => sample.split(ch).length - 1;
  const delim = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: Grid = [];
  let row: CellValue[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field === "" ? null : field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field === "" ? null : field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field === "" ? null : field);
    rows.push(row);
  }
  return rows;
}

// ---- Cells -------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

function isoOf(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** A cell as text: whitespace collapsed, dates as dd/mm/yyyy. */
export function cellText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return `${pad2(v.getUTCDate())}/${pad2(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  return String(v).replace(/\s+/g, " ").trim();
}

function dateOf(v: CellValue): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : isoOf(v);
  const t = cellText(v);
  if (!t) return null;
  // ISO dates, common in generic CSV exports: 2026-07-18.
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const tokens = t.split(" ");
  tokens[0] = tokens[0].replace(/\|+$/, "");
  return readDate(tokens, 0)?.date ?? null;
}

/**
 * An amount cell: "63,817.00", 63817, "₹ 1,234.00", "1,234.00 Cr", "-199.00"
 * or "(199.00)". `credit` is true or false when the cell says so, else null.
 */
export function amountCell(v: CellValue): { amount: number; credit: boolean | null } | null {
  if (typeof v === "number") return Number.isFinite(v) ? { amount: Math.abs(v), credit: v < 0 ? true : null } : null;
  let t = cellText(v).replace(/^(?:₹|rs\.?|inr)\s*/i, "").replace(/\s+/g, "");
  if (!t) return null;
  let credit: boolean | null = null;
  const mark = t.match(/^(.*?)(cr|dr)\.?$/i);
  if (mark) {
    credit = mark[2].toLowerCase() === "cr";
    t = mark[1];
  }
  if (t.startsWith("-")) {
    credit = true;
    t = t.slice(1);
  } else if (t.startsWith("+")) t = t.slice(1);
  if (/^\(.*\)$/.test(t)) {
    credit = true;
    t = t.slice(1, -1);
  }
  const n = amountOf(t);
  return n === null ? null : { amount: n, credit };
}

interface Cell {
  c: number;
  v: CellValue;
  t: string;
}

function cellsOf(row: CellValue[] | undefined): Cell[] {
  const out: Cell[] = [];
  (row ?? []).forEach((v, c) => {
    const t = cellText(v);
    if (t) out.push({ c, v, t });
  });
  return out;
}

/** The first non-empty cell in [from, to). */
function inRange(cells: Cell[], from: number, to: number): Cell | null {
  return cells.find((x) => x.c >= from && x.c < to) ?? null;
}

// ---- Transaction table ----------------------------------------------------

type Field = "ignore" | "drcr" | "debit" | "credit" | "type" | "foreign" | "date" | "description" | "amount";

// First match wins, so the specific names come before the general ones.
const HEADERS: [Field, RegExp][] = [
  ["ignore", /name|customer|card ?holder|reward|points|serial|sr\.? ?no|^ref(erence)?\.?\s*(no\.?|number|#)?$/i],
  ["drcr", /^(debit|dr)\.?\s*\/\s*(credit|cr)\.?$|^(credit|cr)\.?\s*\/\s*(debit|dr)\.?$|^dr\.?\s*cr\.?$/i],
  ["debit", /^debit(\s+amount)?(\s*\(.*\))?$|^withdrawals?(\s+amt\.?)?$/i],
  ["credit", /^credit(\s+amount)?(\s*\(.*\))?$|^deposits?(\s+amt\.?)?$/i],
  ["type", /^(transaction|txn)\.?\s+type$|^type$/i],
  ["foreign", /foreign|\bfcy\b|intl\.?\s*#?\s*(amount|amt)|original\s+(amount|currency)|currency\s+amount/i],
  ["date", /^(transaction\s+|txn\.?\s+|posting\s+|value\s+)?date(\s*(&|and)\s*time)?$|^date\s*\/\s*time$/i],
  ["description", /description|details|narration|particulars|merchant|remarks/i],
  ["amount", /^(amt|amount)\b|amount\s*\(|^(inr|rs\.?)$/i],
];

interface Column {
  field: Field;
  from: number;
  to: number;
}

function fieldOf(t: string): Field | null {
  for (const [f, re] of HEADERS) if (re.test(t)) return f;
  return null;
}

/** The column map when a row is a transaction table's header row. */
function transactionHeader(cells: Cell[]): Column[] | null {
  if (cells.length < 3) return null;
  const fields = cells.map((x) => fieldOf(x.t));
  const has = (f: Field) => fields.includes(f);
  if (!has("date") || !has("description") || !(has("amount") || has("debit") || has("credit"))) return null;
  // Every header cell must be a known column, or the row is prose.
  if (fields.some((f) => f === null)) return null;
  return cells.map((x, i) => ({ field: fields[i]!, from: x.c, to: cells[i + 1]?.c ?? Number.POSITIVE_INFINITY }));
}

// ---- Loan and GST summaries ----------------------------------------------

type LoanField = "type" | "number" | "booked" | "principalLeft" | "interestLeft" | "remaining" | "amount" | "tenure" | "rate";

const LOAN_HEADERS: [LoanField, RegExp][] = [
  ["number", /loan\s*(number|no\.?|a\/?c|account)/i],
  ["type", /loan\s*type|type\s*of\s*loan|product/i],
  ["booked", /booked|booking|start|disburs/i],
  ["principalLeft", /(balance|outstanding).*principal|principal.*(outstanding|balance)/i],
  ["interestLeft", /(balance|outstanding).*interest|interest.*(payable|outstanding)/i],
  ["remaining", /balance\s*tenure|remaining|months?\s*left/i],
  ["rate", /rate|\broi\b/i],
  ["amount", /loan\s*amount|principal\s*amount|^amount$/i],
  ["tenure", /tenure/i],
];

function loanHeader(cells: Cell[]): { field: LoanField; from: number; to: number }[] | null {
  if (!cells.some((x) => LOAN_HEADERS[0][1].test(x.t))) return null;
  const cols: { field: LoanField; from: number; to: number }[] = [];
  cells.forEach((x, i) => {
    const f = LOAN_HEADERS.find(([, re]) => re.test(x.t))?.[0];
    if (f) cols.push({ field: f, from: x.c, to: cells[i + 1]?.c ?? Number.POSITIVE_INFINITY });
  });
  return cols.length >= 3 ? cols : null;
}

function intOf(t: string): number | null {
  const m = t.match(/\d+/);
  return m ? Number(m[0]) : null;
}

function loanRow(cells: Cell[], cols: { field: LoanField; from: number; to: number }[]): StatementLoan | null {
  const get = (f: LoanField) => {
    const col = cols.find((x) => x.field === f);
    return col ? inRange(cells, col.from, col.to) : null;
  };
  const number = get("number");
  const digits = number ? cellText(number.v).replace(/\D/g, "") : "";
  if (digits.length < 4) return null;
  const amt = (f: LoanField) => {
    const c = get(f);
    return c ? amountCell(c.v)?.amount ?? null : null;
  };
  const rate = get("rate");
  const tenure = get("tenure");
  const remaining = get("remaining");
  const booked = get("booked");
  return {
    type: get("type")?.t ?? null,
    // The last four digits only: the loan number itself is never kept.
    last4: digits.slice(-4),
    bookedOn: booked ? dateOf(booked.v) : null,
    amount: amt("amount"),
    tenureMonths: tenure ? intOf(tenure.t) : null,
    ratePct: rate ? parseFloat(rate.t.replace(/[^\d.]/g, "")) || null : null,
    principalOutstanding: amt("principalLeft"),
    interestPayable: amt("interestLeft"),
    remainingMonths: remaining ? intOf(remaining.t) : null,
  };
}

/** The total of a GST summary table ("IGST CGST SGST … Total" over a row of figures). */
function gstTotalBelow(grid: Grid, r: number, cells: Cell[]): number | null {
  if (!cells.some((x) => /^igst$/i.test(x.t)) || !cells.some((x) => /^total$/i.test(x.t))) return null;
  const totalCol = cells.find((x) => /^total$/i.test(x.t))!;
  const next = cells[cells.indexOf(totalCol) + 1]?.c ?? Number.POSITIVE_INFINITY;
  for (let j = r + 1; j <= r + 3 && j < grid.length; j++) {
    const v = inRange(cellsOf(grid[j]), totalCol.c, next);
    if (v) return amountCell(v.v)?.amount ?? null;
  }
  return null;
}

// ---- Summary labels -----------------------------------------------------------

type Setter = (f: Found, v: number | string, how: string) => void;

/** A cell that is a summary label, not a sentence that happens to contain one. */
function labelOf(t: string): Found | null {
  const bare = t.replace(/[:\s]+$/, "");
  const found = labelsIn(bare);
  if (found.length !== 1) return null;
  const f = found[0];
  return f.end - f.at >= bare.length * 0.6 ? f : null;
}

function valueOf(f: Found, v: CellValue): number | string | null {
  if (f.kind === "date") return dateOf(v);
  const a = amountCell(v);
  return a ? a.amount : null;
}

/** Labelled figures: the value to the right of the label, else the one below it. */
function readLabels(grid: Grid, r: number, cells: Cell[], set: Setter): void {
  const labelled = cells.map((x) => ({ cell: x, label: labelOf(x.t) }));
  labelled.forEach(({ cell, label }, i) => {
    if (!label) return;
    const nextLabel = labelled.slice(i + 1).find((x) => x.label)?.cell.c ?? Number.POSITIVE_INFINITY;
    for (const x of cells) {
      if (x.c <= cell.c || x.c >= nextLabel) continue;
      const v = valueOf(label, x.v);
      if (v !== null) {
        set(label, v, "cell right");
        return;
      }
    }
    const to = cells[i + 1]?.c ?? Number.POSITIVE_INFINITY;
    for (let j = r + 1; j <= r + 3 && j < grid.length; j++) {
      const below = cellsOf(grid[j]);
      if (below.length === 0) continue;
      const hit = inRange(below, cell.c, to);
      const v = hit ? valueOf(label, hit.v) : null;
      if (v !== null) set(label, v, "cell below");
      return;
    }
  });
}

// ---- The statement ------------------------------------------------------------

function sectionFromType(t: string): Section | null {
  if (/international|overseas|foreign/i.test(t)) return "international";
  if (/domestic/i.test(t)) return "domestic";
  if (/\bemi\b|loan|instal/i.test(t)) return "emi";
  return null;
}

/**
 * Parses a statement exported as a spreadsheet: one grid per worksheet.
 * Returns the same shape as the PDF parser, so the review screen, lineage
 * and import work unchanged.
 */
export function parseSheet(grids: Grid[], opts: { filename?: string } = {}): ParsedStatement {
  const tagger = makeRefTagger();
  const lines: Line[] = [];
  const redactedLines: string[] = [];
  const unparsed: { page: number; text: string }[] = [];
  const loans: StatementLoan[] = [];
  const cardCells: string[] = [];
  const bankText: string[] = [];
  const notes: string[] = [];
  let gstBilled: number | null = null;
  let sectioned = false;
  let index = 0;

  const summary: StatementSummary = {
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
  const set: Setter = (f, v, how) => {
    if (f.kind === "amount" && typeof v === "number" && summary[f.key as Exclude<keyof StatementSummary, "dueDate" | "statementDate">] === null) {
      summary[f.key as Exclude<keyof StatementSummary, "dueDate" | "statementDate">] = v;
      notes.push(`${f.key} = ${v} (${how})`);
    }
    if (f.kind === "date" && typeof v === "string" && summary[f.key as "dueDate" | "statementDate"] === null) {
      summary[f.key as "dueDate" | "statementDate"] = v;
      notes.push(`${f.key} = ${v} (${how})`);
    }
  };

  grids.forEach((grid, g) => {
    const page = g + 1;
    let table: Column[] | null = null;
    let loanCols: ReturnType<typeof loanHeader> = null;
    let section: Section = "unknown";
    let lastSection: Section | null = null;
    // Summary labels are not read inside reward-point, loan or GST blocks,
    // whose "Opening Balance" or "Total" mean something else.
    let labelsAllowed = true;

    for (let r = 0; r < grid.length; r++) {
      const cells = cellsOf(grid[r]);
      if (cells.length === 0) continue;

      const header = transactionHeader(cells);
      if (header) {
        table = header;
        loanCols = null;
        continue;
      }
      const lh = loanHeader(cells);
      if (lh) {
        table = null;
        loanCols = lh;
        labelsAllowed = false;
        continue;
      }

      // A lone cell is a title: a section of the transaction table, or the
      // start of another block, which ends the table.
      if (cells.length === 1) {
        const t = cells[0].t;
        const s = /summary/i.test(t) ? null : sectionOf(t);
        if (s && s !== "emi") {
          section = s;
          sectioned = true;
          continue;
        }
        // A label whose value cell is blank ("Customer GSTN") is not a title.
        if (!labelOf(t)) {
          table = null;
          loanCols = null;
          labelsAllowed = !/\b(rewards?|points?|loans?|gst|tax|emi)\b/i.test(t);
          bankText.push(t);
        }
        continue;
      }

      if (table) {
        const get = (f: Field) => {
          const col = table!.find((x) => x.field === f);
          return col ? inRange(cells, col.from, col.to) : null;
        };
        const dateCell = get("date");
        const date = dateCell ? dateOf(dateCell.v) : null;
        if (date) {
          const descCell = get("description");
          const typeCell = get("type");
          const drcr = get("drcr");
          let amount: { amount: number; credit: boolean | null } | null = null;
          const creditCell = get("credit");
          const debitCell = get("debit");
          const amountCol = get("amount");
          if (amountCol) amount = amountCell(amountCol.v);
          if (!amount && creditCell) {
            const a = amountCell(creditCell.v);
            if (a && a.amount > 0) amount = { amount: a.amount, credit: true };
          }
          if (!amount && debitCell) {
            const a = amountCell(debitCell.v);
            if (a && a.amount > 0) amount = { amount: a.amount, credit: a.credit ?? false };
          }
          // Redact first: nothing else of the description is ever looked at.
          // "…,0 0000266258470" is one loan number split by a cell wrap.
          const raw = (descCell?.t ?? "").replace(/(,|^)(\d{1,4}) (\d{8,})\b/g, "$1$2$3");
          const words = redactLine(raw, tagger.tag).split(" ").filter(Boolean);
          dropEmiBadge(words);
          const description = words.join(" ");
          if (!amount || !description) {
            unparsed.push({ page, text: `${cellText(dateCell!.v)} ${description}`.trim() });
            continue;
          }
          let credit = amount.credit ?? false;
          const typeText = typeCell?.t ?? "";
          if (/^(cr|credit)\.?$/i.test(typeText)) credit = true;
          if (drcr) credit = /^c/i.test(drcr.t);
          const rowSection = sectionFromType(typeText) ?? section;
          if (typeCell && sectionFromType(typeText)) sectioned = true;
          const foreignCell = get("foreign");
          const foreign = foreignCell ? readForeign(foreignCell.t.split(" ")) : null;
          if (rowSection !== lastSection && rowSection !== "unknown") {
            redactedLines.push(`## ${rowSection}`);
            lastSection = rowSection;
          }
          const [y, m, d] = date.split("-");
          const text = `${d}/${m}/${y} ${description}${foreign ? ` ${foreign.currency} ${foreign.amount.toFixed(2)}` : ""} ${amount.amount.toFixed(2)}${credit ? " Cr" : ""}`;
          redactedLines.push(text);
          lines.push({
            page,
            index: index++,
            date,
            description,
            ref: citedRef(description),
            amount: amount.amount,
            credit,
            foreign: foreign ? { currency: foreign.currency, amount: foreign.amount } : null,
            section: rowSection,
            text,
          });
          continue;
        }
        // Several cells and no date: another block has begun.
        table = null;
      }

      if (loanCols) {
        const loan = loanRow(cells, loanCols);
        if (loan) {
          loans.push(loan);
          continue;
        }
        loanCols = null;
      }

      const gst = gstTotalBelow(grid, r, cells);
      if (gst !== null) {
        gstBilled ??= gst;
        labelsAllowed = false;
        continue;
      }
      if (labelsAllowed) readLabels(grid, r, cells, set);
      for (const x of cells) {
        if (/card/i.test(x.t)) cardCells.push(x.t);
        if (/\b(hdfc|icici)\b/i.test(x.t)) bankText.push(x.t);
      }
    }
  });

  const { rows, tokenDigits } = buildRows(lines, tagger);
  let bank = detectBank(bankText);
  // HDFC names its downloads "Sep2026_BilledStatements_7043_….xlsx".
  if (bank === "unknown" && /billedstatements/i.test(opts.filename ?? "")) bank = "hdfc";
  const any = Object.values(summary).some((v) => v !== null);
  return assembleStatement({
    bank,
    rows,
    tokenDigits,
    summary: any ? summary : null,
    summaryNotes: notes,
    statementDateFallback: null,
    identity: cardIdentity(cardCells, opts.filename),
    unparsed,
    redactedLines,
    sectioned,
    loans,
    gstBilled,
  });
}
