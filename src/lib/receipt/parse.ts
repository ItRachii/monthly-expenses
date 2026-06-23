// Heuristic receipt parser: turns raw OCR text into structured line items with
// best-effort GST handling. OCR + real-world receipts are messy, so this aims
// for "a good first draft the user then corrects in the review screen", not
// perfection. Pure and dependency-light so it is unit-testable in isolation.

import { categorize } from "./categorize";
import { GST_SLABS, type ParsedLineItem, type ParsedReceipt } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Words that mark a line as a total / tax / metadata row rather than an item.
const SUMMARY_RE =
  /\b(sub\s*total|subtotal|grand\s*total|total|amount|payable|balance|tender|cash|card|upi|change|round|discount|savings|taxable|net|qty|invoice|gstin|gst\s*no|bill\s*no|cgst|sgst|igst|gst|tax|vat|cess|gross|gratuity|service\s*charge)\b/i;

function cleanNum(s: string): number {
  return parseFloat(s.replace(/[₹,\s]/g, "").replace(/rs\.?/i, ""));
}

const NUM = /\d[\d,]*(?:\.\d{1,2})?/g;

function snapToSlab(rate: number): number {
  let best: number = GST_SLABS[0];
  let bestDiff = Infinity;
  for (const s of GST_SLABS) {
    const d = Math.abs(s - rate);
    if (d < bestDiff) {
      bestDiff = d;
      best = s;
    }
  }
  return best;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Is a whitespace-delimited token a number / currency / column separator? */
function isClusterToken(tok: string): boolean {
  return /^(?:₹|rs\.?|inr|@|x|×|\*|-)?\d[\d,]*(?:\.\d{1,2})?%?$/i.test(tok) ||
    /^(?:x|×|\*|@)$/i.test(tok);
}

/**
 * Splits an item line into a description and the trailing numeric "columns"
 * (qty / rate / amount). Keeps in-name numbers like "Milk 1L" attached to the
 * description because they are immediately followed by a non-numeric token.
 */
function splitItemLine(line: string): { desc: string; nums: number[] } | null {
  const words = line.trim().split(/\s+/);
  let i = words.length;
  while (i > 0 && isClusterToken(words[i - 1])) i--;
  if (i === words.length) return null; // no trailing number → not an item line
  const desc = words.slice(0, i).join(" ").replace(/[:•\-–]+$/, "").trim();
  const nums: number[] = [];
  for (const tok of words.slice(i)) {
    const m = tok.match(/\d[\d,]*(?:\.\d{1,2})?/);
    if (m) nums.push(cleanNum(m[0]));
  }
  return { desc, nums };
}

function extractDate(text: string): string | null {
  const dmy = text.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (dmy) {
    let [, d, m, y] = dmy.map(Number) as unknown as number[];
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return iso(y, m, d);
  }
  const ymd = text.match(/\b(20\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/);
  if (ymd) {
    const [, y, m, d] = ymd.map(Number) as unknown as number[];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return iso(y, m, d);
  }
  const named = text.match(/\b(\d{1,2})\s*([A-Za-z]{3,})\s*,?\s*(\d{2,4})\b/);
  if (named) {
    const d = Number(named[1]);
    const m = MONTHS[named[2].slice(0, 3).toLowerCase()];
    let y = Number(named[3]);
    if (y < 100) y += 2000;
    if (m && d >= 1 && d <= 31) return iso(y, m, d);
  }
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function extractMerchant(lines: string[]): string {
  for (const line of lines.slice(0, 6)) {
    const t = line.trim();
    if (t.length < 2 || t.length > 40) continue;
    if (/\d{3,}/.test(t)) continue; // phone / GSTIN / address line
    if (/(invoice|receipt|gstin|tax|bill|date|tel|ph|cash|memo)/i.test(t)) continue;
    if (/[A-Za-z]{2,}/.test(t)) return t.replace(/[^\w&'.\- ]/g, "").trim();
  }
  return "Receipt";
}

interface TaxInfo {
  total: number | null;
  subtotal: number | null;
  tax: number | null;
  /** Single overall GST rate (e.g. 5 for CGST 2.5 + SGST 2.5), if unambiguous. */
  rate: number | null;
}

function parseTotals(lines: string[]): TaxInfo {
  let subtotal: number | null = null;
  let total: number | null = null;
  let grand: number | null = null;
  const taxAmounts: number[] = [];
  const rates: number[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    const nums = line.match(NUM);
    if (!nums) continue;
    const last = cleanNum(nums[nums.length - 1]);

    if (/(c?gst|sgst|igst|vat)\b/.test(lower) && !/gstin|gst\s*no/.test(lower)) {
      taxAmounts.push(last);
      const r = lower.match(/(\d{1,2}(?:\.\d)?)\s*%/);
      if (r) rates.push(parseFloat(r[1]));
    } else if (/(taxable|sub\s*total|subtotal)/.test(lower)) {
      subtotal = last;
    } else if (/(grand\s*total|amount\s*payable|net\s*payable|net\s*amount)/.test(lower)) {
      grand = last;
    } else if (/\btotal\b/.test(lower)) {
      total = last;
    }
  }

  const tax = taxAmounts.length ? round2(taxAmounts.reduce((a, b) => a + b, 0)) : null;
  // CGST + SGST of the same slab are printed separately; their rates add up to
  // the GST rate. A single distinct slab → unambiguous overall rate.
  const uniqueRates = Array.from(new Set(rates));
  let rate: number | null = null;
  if (uniqueRates.length === 1) rate = uniqueRates[0] * (rates.length >= 2 ? 2 : 1);
  else if (uniqueRates.length === 2 && Math.abs(uniqueRates[0] - uniqueRates[1]) < 0.01)
    rate = uniqueRates[0] * 2;

  return { total: grand ?? total, subtotal, tax, rate };
}

function applyGst(
  items: ParsedLineItem[],
  info: TaxInfo,
): ParsedLineItem[] {
  const itemSum = round2(items.reduce((s, it) => s + it.amount, 0));
  const tax = info.tax;
  if (!tax || tax <= 0 || itemSum <= 0) return items;

  const subtotal = info.subtotal ?? itemSum;
  // Items are "exclusive" when the printed total ≈ items + tax (tax added on
  // top); "inclusive" when the total ≈ the item sum (tax already inside).
  const total = info.total ?? subtotal + tax;
  const exclusive =
    Math.abs(itemSum + tax - total) <= Math.abs(itemSum - total) + 0.01;

  return items.map((it) => {
    const share = it.amount / itemSum; // proportional fallback for multi-slab
    const itemTax = round2(info.rate != null
      ? (exclusive ? it.amount * (info.rate / 100) : it.amount - it.amount / (1 + info.rate / 100))
      : tax * share);
    const amount = exclusive ? round2(it.amount + itemTax) : it.amount;
    const base = amount - itemTax;
    const rate = info.rate ?? (base > 0 ? snapToSlab((itemTax / base) * 100) : null);
    return { ...it, amount, gstAmount: itemTax, gstRate: rate };
  });
}

export function parseReceipt(rawText: string): ParsedReceipt {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const merchant = extractMerchant(lines);
  const purchasedOn = extractDate(rawText);
  const totals = parseTotals(lines);

  const items: ParsedLineItem[] = [];
  for (const line of lines) {
    if (SUMMARY_RE.test(line)) continue;
    if (extractDate(line)) continue; // a date row, not an item (e.g. "05 Jun 2026")
    const split = splitItemLine(line);
    if (!split) continue;
    const { desc, nums } = split;
    if (desc.replace(/[^a-z]/gi, "").length < 2) continue; // need a real name
    const amount = nums[nums.length - 1];
    if (!(amount > 0) || amount > 1_000_000) continue;

    // qty: an explicit "qty × rate = amount" column triple, validated by math.
    let qty: number | null = null;
    if (nums.length >= 3) {
      const [q, rate] = nums;
      if (Number.isInteger(q) && q > 0 && q <= 999 && Math.abs(q * rate - amount) <= 1)
        qty = q;
    }

    items.push({
      description: desc,
      category: categorize(desc),
      qty,
      amount: round2(amount),
      gstRate: null,
      gstAmount: null,
    });
  }

  return {
    merchant,
    purchasedOn,
    items: applyGst(items, totals),
    detectedTotal: totals.total,
    detectedTax: totals.tax,
    rawText,
  };
}
