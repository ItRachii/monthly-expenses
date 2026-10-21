// Personal details on order screenshots: the buyer's phone number, delivery
// address and name, the delivery partner's name, email and UPI ids. They are
// found on the OCR's pieces and taken out before anything reads the text, so
// they are never parsed, shown or saved. Each decision keeps its reason, and
// the developer scan inspector draws them, masked.
//
// Context decides, not the digits alone: "7440461706" under a name is a
// phone; "9876543210" beside "Order ID", or inside "BNN-9876543210-20260607",
// is an order number and stays. Pure, so it is unit-tested.

import type { ScanItem, ScanResult } from "./lines";

export type PiiKind = "phone" | "address" | "name" | "email";

/** What a piece was found to be, and why. Order numbers are tagged but kept. */
export interface Tag {
  kind: PiiKind | "order-id";
  why: string;
}

interface Row {
  page: number;
  top: number;
  bottom: number;
  cells: ScanItem[];
  text: string;
}

const ORDER_LABEL =
  /\b(?:order\s*(?:id|no\.?|number|#)|order\s*#|invoice\s*(?:no\.?|number|id)?|txn|transaction\s*id|ref(?:erence)?\s*(?:no\.?|id)|awb|tracking\s*(?:id|no\.?)|booking\s*id)(?![a-z])|^\s*#/i;
const PHONE_LABEL = /\b(?:phone|mobile|mob|contact|call|tel|whatsapp)\b/i;
const ADDRESS_LABEL = /\b(?:deliver(?:ed)?\s*to|delivery\s*(?:address|details|location)|shipping\s*address|billing\s*address|address)\b/i;
// Words found in Indian addresses (not on product rows: a row with a price is never an address).
const ADDRESS_WORD =
  /\b(?:road|rd|street|st|nagar|colony|colonie|layout|sector|block|floor|flat|apt|apartments?|residency|society|cross|main|near|opp|behind|lane|marg|towers?|enclave|phase|plot|house|h\.?\s?no|village|district|dist|gardens?|spaces|villa|chowk|bazaar|extension|stage|cantonment|taluk|mandir|pin(?:code)?)\b/i;
const PLACE =
  /\b(?:india|bengaluru|bangalore|mumbai|delhi|new delhi|noida|gurugram|gurgaon|hyderabad|chennai|pune|kolkata|ahmedabad|jaipur|bhopal|indore|lucknow|kochi|chandigarh|nagpur|surat|karnataka|maharashtra|telangana|tamil nadu|kerala|gujarat|rajasthan|madhya pradesh|uttar pradesh|west bengal|haryana|punjab)\b/i;
const PIN = /(?<![\d.])[1-9]\d{5}(?![\d.])/;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*/;
// A mobile number: 10 digits from 6 to 9, perhaps after +91 or 0, perhaps spaced.
const PHONE = /(?<![\w-])(?:\+?91[\s-]?|0)?([6-9]\d{4}[\s-]?\d{5})(?![\w-])/;
// A long run of digits glued to letters or hyphens: an order or reference number.
const REFERENCE = /[A-Za-z]+[-#]?\d{6,}|\d{6,}-[\dA-Za-z-]+|[A-Za-z0-9]+-\d{6,}/;
const NAME = /^(?:by\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z.]*){0,3}$/;

function rowsOf(pieces: ScanItem[]): Row[] {
  const sorted = [...pieces].sort((a, b) => a.page - b.page || (a.box[1] + a.box[3]) / 2 - (b.box[1] + b.box[3]) / 2);
  const rows: Row[] = [];
  for (const p of sorted) {
    const mid = (p.box[1] + p.box[3]) / 2;
    const row = rows.find((r) => r.page === p.page && mid >= r.top && mid <= r.bottom);
    if (row) {
      row.cells.push(p);
      row.top = Math.min(row.top, p.box[1]);
      row.bottom = Math.max(row.bottom, p.box[3]);
    } else rows.push({ page: p.page, top: p.box[1], bottom: p.box[3], cells: [p], text: "" });
  }
  for (const r of rows) r.text = r.cells.sort((a, b) => a.box[0] - b.box[0]).map((c) => c.text).join(" ");
  return rows;
}

/** The rows just above and below, close enough to belong together. */
function near(rows: Row[], i: number): Row[] {
  const r = rows[i];
  const h = r.bottom - r.top;
  return [rows[i - 1], rows[i + 1]].filter((o): o is Row => !!o && o.page === r.page && Math.min(Math.abs(o.top - r.bottom), Math.abs(r.top - o.bottom)) < 2.5 * h);
}

const addressScore = (text: string) =>
  (ADDRESS_WORD.test(text) ? 1 : 0) + (PLACE.test(text) ? 1 : 0) + (PIN.test(text) ? 1 : 0) + ((text.match(/,/g) ?? []).length >= 2 ? 1 : 0);

/** Finds the personal details (and the order numbers that look like them) among a scan's pieces. */
export function findPii(result: ScanResult): Map<ScanItem, Tag> {
  const all = result.cells?.length ? result.cells : result.items;
  const pieces = all.filter((p) => !p.struck);
  const rows = rowsOf(pieces);
  const tags = new Map<ScanItem, Tag>();
  const isPhoneRow = new Set<number>();
  const orderNearRow = (i: number) =>
    ORDER_LABEL.test(rows[i].text) || near(rows, i).some((o) => ORDER_LABEL.test(o.text) && !PHONE.test(o.text));

  rows.forEach((r, i) => {
    const around = near(rows, i);
    const orderNear = orderNearRow(i);
    for (const c of r.cells) {
      if (EMAIL.test(c.text)) {
        tags.set(c, { kind: "email", why: c.text.includes(".") ? "email address" : "UPI id (name@bank)" });
        continue;
      }
      const ref = c.text.match(REFERENCE);
      const phone = c.text.match(PHONE);
      if (ref && (!phone || ref[0].includes(phone[1].replace(/[\s-]/g, "")))) {
        tags.set(c, { kind: "order-id", why: `digits glued to letters or hyphens ("${ref[0].replace(/\d/g, "#")}"): a reference, not a phone` });
        continue;
      }
      if (phone) {
        if (orderNear) {
          const label = [r, ...around].find((o) => ORDER_LABEL.test(o.text))!;
          tags.set(c, { kind: "order-id", why: `10 digits, but next to "${label.text.match(ORDER_LABEL)![0].trim()}": an order number` });
        } else {
          const labelled = [r, ...around].find((o) => PHONE_LABEL.test(o.text));
          tags.set(c, {
            kind: "phone",
            why: labelled ? `10 digits from 6-9, labelled "${labelled.text.match(PHONE_LABEL)![0]}"` : "10 digits starting 6 to 9, no order label near it",
          });
          isPhoneRow.add(i);
        }
      } else if (ORDER_LABEL.test(r.text) && /\d{6,}|[A-Z0-9]{8,}/.test(c.text) && !/₹/.test(c.text)) {
        tags.set(c, { kind: "order-id", why: `on the "${r.text.match(ORDER_LABEL)![0].trim()}" row` });
      }
    }
  });

  // A piece the scanner split at a strike line is judged as it was first
  // read: a line wrongly seen through "9123456780" leaves "91234" struck and
  // "56780" kept, neither a phone number on its own. Every part of a split
  // piece takes the tag the whole would get, and the struck part, never
  // read otherwise, takes its sibling's.
  const splits: ScanItem[][] = [];
  const midOf = (p: ScanItem) => (p.box[1] + p.box[3]) / 2;
  for (const p of all) {
    if (p.from == null) continue;
    const group = splits.find(([first]) => first.page === p.page && first.from === p.from && midOf(p) >= first.box[1] && midOf(p) <= first.box[3]);
    if (group) group.push(p);
    else splits.push([p]);
  }
  for (const parts of splits) {
    const whole = parts[0].from!;
    let tag = parts.map((p) => tags.get(p)).find((t) => t != null) ?? null;
    if (!tag && EMAIL.test(whole)) tag = { kind: "email", why: "email address, split at a line the scanner took for a strike" };
    const phone = tag ? null : whole.match(PHONE);
    const ref = whole.match(REFERENCE);
    if (phone && !(ref && ref[0].includes(phone[1].replace(/[\s-]/g, "")))) {
      const kept = parts.find((p) => !p.struck);
      const at = rows.findIndex((r) => (kept ? r.cells.includes(kept) : r.page === parts[0].page && midOf(parts[0]) >= r.top && midOf(parts[0]) <= r.bottom));
      tag =
        at >= 0 && orderNearRow(at)
          ? { kind: "order-id", why: "10 digits next to an order label, split at a line the scanner took for a strike" }
          : { kind: "phone", why: "10 digits starting 6 to 9, split at a line the scanner took for a strike" };
      if (tag.kind === "phone" && at >= 0) isPhoneRow.add(at);
    }
    if (tag) for (const p of parts) tags.set(p, tag);
  }

  // Addresses: rows that read like one (two signs: a place word, a city, a
  // PIN, a comma list) or one sign next to an address label or another
  // address row. Never a row with a price on it.
  const isAddress = rows.map((r) => !/₹/.test(r.text) && addressScore(r.text) >= 2);
  for (let pass = 0; pass < 3; pass++)
    rows.forEach((r, i) => {
      if (isAddress[i] || /₹/.test(r.text) || ADDRESS_LABEL.test(r.text) || isPhoneRow.has(i)) return;
      const around = near(rows, i).map((o) => rows.indexOf(o));
      const touching = around.some((k) => isAddress[k] || ADDRESS_LABEL.test(rows[k].text));
      // A comma list alone does not count here: "Faasos Wraps, Rolls & Shawarma" heads its address.
      if (touching && (ADDRESS_WORD.test(r.text) || PLACE.test(r.text) || PIN.test(r.text) || /^\s*\d{1,4}\s*[,/-]/.test(r.text))) isAddress[i] = true;
    });
  rows.forEach((r, i) => {
    if (!isAddress[i]) return;
    const signs = [ADDRESS_WORD.test(r.text) && "place word", PLACE.test(r.text) && "city or state", PIN.test(r.text) && "PIN code", (r.text.match(/,/g) ?? []).length >= 2 && "comma list"].filter(Boolean);
    const why = signs.length >= 2 ? `reads like an address: ${signs.join(", ")}` : `next to an address${signs.length ? ` (${signs.join(", ")})` : ""}`;
    // Not the location icon beside it, read as a stray symbol.
    r.cells.forEach((c) => !tags.has(c) && /[\p{L}\p{N}]{2}/u.test(c.text) && tags.set(c, { kind: "address", why }));
  });

  // Names: the row right above or below a phone number, or "by <Name>" (the
  // delivery partner), when it reads like a name.
  rows.forEach((r, i) => {
    // A contact icon beside the name comes back as a stray symbol ("日"): not part of it.
    const words = r.cells.filter((c) => /[a-z]{2}/i.test(c.text));
    const text = words.map((c) => c.text).join(" ").trim();
    if (!NAME.test(text) || words.some((c) => tags.has(c))) return;
    if (PHONE_LABEL.test(text) || ADDRESS_LABEL.test(text) || ORDER_LABEL.test(text) || /\b(?:payment|delivered|help|summary|details)\b/i.test(text)) return;
    const byPhone = near(rows, i).some((o) => isPhoneRow.has(rows.indexOf(o)));
    const partner = /^by\s/i.test(text) && near(rows, i).some((o) => /\bdeliver/i.test(o.text));
    const tag: Tag = { kind: "name", why: byPhone ? "a name beside the phone number" : "the delivery partner" };
    if (byPhone || partner) words.forEach((c) => tags.set(c, tag));
  });
  return tags;
}

/** The text masked for showing: the first two characters, the rest as dots. */
export function mask(text: string): string {
  return text.replace(/\S/g, (ch, i: number) => (i < 2 ? ch : /[\p{L}\p{N}]/u.test(ch) ? "•" : ch));
}

/**
 * The scan without its personal details: those pieces are dropped (the
 * text is rebuilt without them). With `keep`, for the developer view, they
 * stay in place, masked and tagged, and order numbers are tagged too.
 */
export function withoutPii(result: ScanResult, keep = false): ScanResult {
  const tags = findPii(result);
  const personal = (p: ScanItem) => {
    const t = tags.get(p);
    return t && t.kind !== "order-id" ? t : null;
  };
  // For the developer view: a found piece masked and tagged, an order number tagged.
  const tagged = (p: ScanItem): ScanItem => {
    const t = tags.get(p);
    if (!t) return p;
    if (t.kind === "order-id") return { ...p, ref: t };
    // A later part of a split piece shows nothing: its first two
    // characters are already the middle of the detail.
    const later = p.from != null && !p.from.startsWith(p.text);
    return { ...p, text: later ? p.text.replace(/[\p{L}\p{N}]/gu, "•") : mask(p.text), from: p.from != null ? mask(p.from) : undefined, pii: t };
  };
  const clean = (list: ScanItem[]) => (keep ? list.map(tagged) : list.filter((p) => !personal(p)));
  // Docling's layout blocks hold the same text: drop (or mask) any that
  // overlaps a personal piece.
  const hit = [...tags].filter(([, t]) => t.kind !== "order-id").map(([p]) => p);
  const overlaps = (a: ScanItem) => hit.some((p) => p.page === a.page && p.box[0] < a.box[2] && a.box[0] < p.box[2] && p.box[1] < a.box[3] && a.box[1] < p.box[3]);
  // A scanner that sends no OCR pieces (an older image) is read from these
  // blocks, so they carry the tags themselves.
  const items = keep
    ? result.items.map((it) => (tags.has(it) ? tagged(it) : overlaps(it) ? { ...it, text: mask(it.text) } : it))
    : result.items.filter((it) => !overlaps(it));
  return { ...result, items, cells: result.cells ? clean(result.cells) : result.cells };
}
