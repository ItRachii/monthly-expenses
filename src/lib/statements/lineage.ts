// EMI lineage across statements.
//
// HDFC bills the GST on an instalment's interest a month after the
// instalment, as a lone "IGST" line. That line cites the exact "(Ref# …)"
// transaction reference of the interest line it taxes, so the join is
// exact: reference to reference. The same holds for the GST on a
// processing fee. Amount and date matching (18% of the interest, on the
// instalment's date) is only the fallback for statements without
// references.
//
// This runs in the browser. Loan numbers and references become stable keyed
// hashes under a salt the server derives for this user, so the same loan
// and the same reference key the same way in every statement, while the
// numbers themselves never leave the page.

import type { ParsedStatement, StatementRow } from "./types";

/** An instalment on record for this user, from an earlier statement. */
export interface KnownInstalment {
  loanKey: string;
  loanLast4: string | null;
  instalmentNo: number | null;
  /** YYYY-MM-DD the instalment was billed. */
  date: string;
  principal: number;
  interest: number;
  /** Stable key of the interest line's reference, which a later GST line cites. */
  refKey: string | null;
  /** GST on the interest, once a later statement billed it. */
  gst: number | null;
  /** Statement month that billed the instalment. */
  period: string;
}

export interface MissingInstalment {
  loanLast4: string | null;
  instalmentNo: number;
  /** Statement month expected to hold it, YYYY-MM. */
  period: string;
}

export interface LineageResult {
  /** GST charges matched to instalments on record. */
  matched: number;
  /** Of those, matched by reference (exact) rather than by amount. */
  byRef: number;
  /** GST charges still unexplained. */
  untraced: StatementRow[];
  /** Earlier instalments of loans in this statement that are not on record. */
  missing: MissingInstalment[];
  /** Reference matched but the amount was not 18% of the interest. */
  amountMismatch: string[];
}

/** What the server stores after an import. */
export interface LineagePayload {
  instalments: {
    loanKey: string;
    loanLast4: string | null;
    instalmentNo: number | null;
    date: string;
    principal: number;
    interest: number;
    refKey: string | null;
    /** GST billed in the same statement, when printed next to it. */
    gst: number | null;
    period: string;
  }[];
  gstMatches: {
    loanKey: string;
    /** The instalment's date. */
    date: string;
    refKey: string | null;
    gst: number;
    gstPeriod: string;
    matchedBy: "ref" | "amount";
  }[];
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(salt: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64url(new Uint8Array(sig)).slice(0, 32);
}

/** Stable key for a loan number under this user's salt. */
export async function loanKeyFor(salt: string, digits: string): Promise<string> {
  return "l_" + (await hmac(salt, `loan-v1\n${digits}`));
}

/** Stable key for a transaction reference under this user's salt. */
export async function refKeyFor(salt: string, digits: string): Promise<string> {
  return "r_" + (await hmac(salt, `ref-v1\n${digits}`));
}

/** Sets every loan key and reference key, then forgets the digits. */
export async function applyKeys(parsed: ParsedStatement, salt: string): Promise<void> {
  const loanKeys = new Map<string, string>();
  const refKeys = new Map<string, string>();
  for (const r of parsed.rows) {
    const tokens = [r.taxRef, ...r.parts.map((p) => p.ref)];
    for (const t of tokens) {
      const d = t ? parsed.tokenDigits[t] : undefined;
      if (t && d && !refKeys.has(t)) refKeys.set(t, await refKeyFor(salt, d));
    }
    const lt = r.loan?.token;
    const ld = lt ? parsed.tokenDigits[lt] : undefined;
    if (lt && ld && !loanKeys.has(lt)) loanKeys.set(lt, await loanKeyFor(salt, ld));
  }
  for (const r of parsed.rows) {
    if (r.loan?.token) r.loan.key = loanKeys.get(r.loan.token) ?? null;
    if (r.taxRef) r.taxRefKey = refKeys.get(r.taxRef) ?? null;
    for (const p of r.parts) if (p.ref) p.refKey = refKeys.get(p.ref) ?? null;
  }
  parsed.tokenDigits = {};
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

function close(a: number, b: number, tolerance: number): boolean {
  return b > 0 && Math.abs(a - b) / b <= tolerance;
}

function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** YYYY-MM of a date moved back by n months. */
function monthsBefore(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Traces lone GST charges to instalments on record and lists the earlier
 * instalments this statement's loans are missing. Mutates the rows.
 */
export function resolveLineage(rows: StatementRow[], known: KnownInstalment[]): LineageResult {
  const taken = new Set<KnownInstalment>();
  let matched = 0;
  let byRef = 0;
  const amountMismatch: string[] = [];

  const link = (r: StatementRow, k: KnownInstalment, matchedBy: "ref" | "amount") => {
    taken.add(k);
    r.untraced = false;
    r.gstFor = { loanKey: k.loanKey, loanLast4: k.loanLast4, instalmentNo: k.instalmentNo, date: k.date, period: k.period, matchedBy };
    r.parts[0].label = "GST on EMI interest";
    r.description = `GST on EMI${k.instalmentNo ? ` #${k.instalmentNo}` : ""} interest (loan …${k.loanLast4 ?? "?"}, ${monthLabel(k.period)})`;
    matched++;
    if (matchedBy === "ref") byRef++;
  };

  // Exact: the GST cites the interest line's reference.
  for (const r of rows) {
    if (!r.untraced || !r.taxRefKey) continue;
    const hit = known.find((k) => !taken.has(k) && k.refKey && k.refKey === r.taxRefKey);
    if (!hit) continue;
    if (!close(r.parts[0].amount, hit.interest * 0.18, 0.02)) {
      amountMismatch.push(`₹${r.parts[0].amount.toFixed(2)} cites instalment #${hit.instalmentNo ?? "?"} of loan …${hit.loanLast4 ?? "?"} but is not 18% of its ₹${hit.interest.toFixed(2)} interest.`);
    }
    link(r, hit, "ref");
  }
  // Fallback for statements without references: the instalment's date and 18% of its interest.
  for (const r of rows) {
    if (!r.untraced) continue;
    const gst = r.parts[0].amount;
    const candidates = known.filter(
      (k) => !taken.has(k) && k.gst === null && daysBetween(k.date, r.date) <= 3 && close(gst, k.interest * 0.18, 0.02),
    );
    const exact = candidates.filter((k) => k.date === r.date);
    const pool = exact.length > 0 ? exact : candidates;
    // Only when it can be no other instalment: two loans with the same
    // interest on the same day cannot be told apart by amount.
    if (pool.length === 1) link(r, pool[0], "amount");
  }

  const missing: MissingInstalment[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.kind !== "emi" || !r.loan?.key || !r.loan.instalmentNo) continue;
    const n = r.loan.instalmentNo;
    for (let i = 1; i < n; i++) {
      const onRecord = known.some((k) => k.loanKey === r.loan!.key && k.instalmentNo === i);
      const inStatement = rows.some((o) => o !== r && o.kind === "emi" && o.loan?.key === r.loan!.key && o.loan.instalmentNo === i);
      const id = `${r.loan.key}|${i}`;
      if (onRecord || inStatement || seen.has(id)) continue;
      seen.add(id);
      missing.push({ loanLast4: r.loan.last4, instalmentNo: i, period: monthsBefore(r.date, n - i) });
    }
  }
  return { matched, byRef, untraced: rows.filter((r) => r.untraced), missing, amountMismatch };
}

/** Plain-language notes for the review screen. */
export function lineageWarnings(result: LineageResult): string[] {
  const out: string[] = [];
  const byLoan = new Map<string, MissingInstalment[]>();
  for (const m of result.missing) {
    const k = m.loanLast4 ?? "?";
    byLoan.set(k, [...(byLoan.get(k) ?? []), m]);
  }
  for (const [last4, list] of byLoan) {
    const months = [...new Set(list.map((m) => monthLabel(m.period)))].join(", ");
    const nos = list.map((m) => `#${m.instalmentNo}`).join(", ");
    out.push(
      `Loan …${last4}: instalment${list.length === 1 ? "" : "s"} ${nos} ${list.length === 1 ? "is" : "are"} not on record. Upload the ${months} statement${list.length === 1 ? "" : "s"} so the GST billed later can be mapped to ${list.length === 1 ? "it" : "them"}.`,
    );
  }
  if (result.untraced.length > 0) {
    const list = result.untraced.map((r) => `₹${r.total.toFixed(2)} on ${r.date.slice(8)}/${r.date.slice(5, 7)}`).join(", ");
    out.push(
      `${result.untraced.length} GST charge${result.untraced.length === 1 ? "" : "s"} (${list}) cite${result.untraced.length === 1 ? "s" : ""} a reference that is not on record. If it is GST on an EMI's interest, upload the statement that billed that instalment.`,
    );
  }
  out.push(...result.amountMismatch);
  return out;
}

/** The instalments and GST matches to store after an import. */
export function lineagePayload(rows: StatementRow[], period: string | null): LineagePayload | null {
  if (!period) return null;
  const instalments: LineagePayload["instalments"] = [];
  for (const r of rows) {
    if (r.kind !== "emi" || !r.loan?.key || r.credit) continue;
    const principalPart = r.parts.find((p) => p.kind === "principal") ?? r.parts.find((p) => p.kind === "base");
    const interestPart = r.parts.find((p) => p.kind === "interest");
    const gst = r.parts.find((p) => p.kind === "gst")?.amount ?? null;
    instalments.push({
      loanKey: r.loan.key,
      loanLast4: r.loan.last4,
      instalmentNo: r.loan.instalmentNo,
      date: r.date,
      principal: principalPart?.amount ?? 0,
      interest: interestPart?.amount ?? 0,
      refKey: interestPart?.refKey ?? principalPart?.refKey ?? null,
      gst,
      period,
    });
  }
  const gstMatches: LineagePayload["gstMatches"] = rows
    .filter((r) => r.gstFor)
    .map((r) => ({
      loanKey: r.gstFor!.loanKey,
      date: r.gstFor!.date,
      refKey: r.taxRefKey,
      gst: r.parts[0].amount,
      gstPeriod: period,
      matchedBy: r.gstFor!.matchedBy,
    }));
  return instalments.length === 0 && gstMatches.length === 0 ? null : { instalments, gstMatches };
}
