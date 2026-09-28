// PII redaction for statement text. Runs on every line before anything is
// parsed, kept or shown, so the rest of the pipeline never sees a card
// number, phone number, email, PAN or transaction reference.
//
// Two layers:
//  1. keepLine(): an allow-list. Only section headings and lines that start
//     with a date survive. The name and address block, contact details and
//     account summary never enter the pipeline at all.
//  2. redactLine(): a deny-list applied to the survivors, for anything a
//     merchant description might still carry.

export const PLACEHOLDER = /\[(?:card|ref(?::[0-9a-f]{4})?|phone|email|pan)\]/g;

/** Replaces a run of digits; see makeRefTagger. */
export type RefTagger = (digits: string) => string;

export interface RefTagging {
  tag: RefTagger;
  /** The digits behind a token, for the loan key computed in the browser. */
  digitsOf: (token: string) => string | undefined;
}

/**
 * Pseudonyms for reference numbers within one statement. Equal numbers get
 * the same "[ref:xxxx]" token, so lines that belong together (an EMI's
 * principal and interest carry the same loan number) can still be paired.
 * The token is a salted hash: it cannot be turned back into the number, and
 * the salt is new for every parse, so tokens never match across uploads.
 */
export function makeRefTagger(): RefTagging {
  const salt = `${Date.now()}:${Math.random()}`;
  const digitsByToken = new Map<string, string>();
  const tag: RefTagger = (digits) => {
    let h = 0x811c9dc5;
    for (const ch of salt + digits) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    const token = `[ref:${(h & 0xffff).toString(16).padStart(4, "0")}]`;
    digitsByToken.set(token, digits);
    return token;
  };
  return { tag, digitsOf: (token) => digitsByToken.get(token) };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// "4695 XXXX XXXX 1234", "4695XXXXXXXX1234", "XXXXXXXXXXXX1234", "**** 1234".
// Grouped forms need their separators, and unspaced forms need a mask
// character, so a year next to a serial number is never read as a card.
const MASKED_CARD = /\b(?:[\dXx*]{4}[ -]){2,3}\d{4}\b|\b(?=[\dXx*]*[Xx*])[\dXx*]{8,15}\d{4}\b|\b[Xx*]{4,12}[ -]?\d{4}\b/g;
// Card numbers printed in groups: "4695 1234 5678 1234", Amex "3782 822463 10005".
const SPACED_CARD = /\b(?:\d{4}[ -]){2,4}\d{2,4}\b|\b\d{4}[ -]\d{6}[ -]\d{5}\b/g;
// Any unbroken run of 8 or more digits, even glued to letters ("VPS2607…"):
// account numbers, Aadhaar, serial and reference numbers. Spaces are not
// bridged, so a year followed by a serial number stays two tokens.
const LONG_DIGITS = /(?<!\d)\d{8,}(?!\d)/g;
const PHONE = /(?:\+91[ -]?|\b0)?[6-9]\d{4}[ -]?\d{5}\b/g;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

export function redactLine(line: string, tagRef: RefTagger = () => "[ref]"): string {
  return line
    .replace(EMAIL, "[email]")
    .replace(MASKED_CARD, "[card]")
    .replace(SPACED_CARD, "[card]")
    .replace(PHONE, "[phone]")
    .replace(LONG_DIGITS, tagRef)
    .replace(PAN, "[pan]")
    .replace(/\s+/g, " ")
    .trim();
}

const DATE_START =
  /^(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}[\/\-. ]?[A-Za-z]{3}[a-z]*[\/\-. ,]+\d{2,4})\b/;

/** True for lines that begin with a date, the shape of every transaction line. */
export function isDateLed(line: string): boolean {
  return DATE_START.test(line.trim());
}

/** Short lines that name a section of the statement. */
export function isHeading(line: string): boolean {
  const words = line.trim().split(/\s+/);
  if (words.length === 0 || words.length > 7) return false;
  return /\b(domestic|international|overseas|emi|instal?lments?|loan|transactions?|fees?|charges)\b/i.test(line);
}

/** The allow-list: what the parser is permitted to see. */
export function keepLine(line: string): boolean {
  return isDateLed(line) || isHeading(line);
}

/**
 * Description text for display and storage: placeholders removed, along with
 * the empty "(Ref# )" and dangling commas they leave behind.
 */
export function cleanDescription(desc: string): string {
  return desc
    .replace(PLACEHOLDER, "")
    .replace(/\(\s*ref\s*#?\s*[A-Z]{0,3}\s*\)/gi, "")
    .replace(/,\s*(?=,|\)|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
