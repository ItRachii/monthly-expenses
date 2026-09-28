// EMI instalments on record, for tracing the GST a bank bills later back to
// the instalment it belongs to. Server only.

import { createHmac } from "crypto";
import { prisma } from "./prisma";
import { formatDate } from "./format";
import { piiSecret } from "./piiCrypto";
import { gstLineageName, monthLabel, type KnownInstalment, type LineagePayload } from "./statements/lineage";

/**
 * The salt the browser uses to key loan numbers for this user. Derived from
 * the PII secret and the user id, so the same loan keys the same way in
 * every statement, and no one without the secret can compute a key.
 */
export function loanSaltFor(userId: string): string {
  return createHmac("sha256", piiSecret()).update(`loan-salt-v1\n${userId}`).digest("hex");
}

const LOAN_KEY = /^l_[A-Za-z0-9_-]{16,64}$/;
const REF_KEY = /^r_[A-Za-z0-9_-]{16,64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-\d{2}$/;
const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function validateLineage(p: LineagePayload): string | null {
  if (!Array.isArray(p.instalments) || !Array.isArray(p.gstMatches)) return "Malformed lineage.";
  if (p.instalments.length + p.gstMatches.length > 500) return "Too many instalments at once.";
  for (const i of p.instalments) {
    if (!LOAN_KEY.test(i.loanKey) || !ISO.test(i.date) || !PERIOD.test(i.period)) return "Malformed instalment.";
    if (!fin(i.principal) || !fin(i.interest) || (i.gst !== null && !fin(i.gst))) return "Malformed instalment amount.";
    if (i.loanLast4 !== null && !/^\d{4}$/.test(i.loanLast4)) return "Malformed loan digits.";
    if (i.refKey !== null && !REF_KEY.test(i.refKey)) return "Malformed reference key.";
  }
  for (const g of p.gstMatches) {
    if (!LOAN_KEY.test(g.loanKey) || !ISO.test(g.date) || !PERIOD.test(g.gstPeriod) || !fin(g.gst)) return "Malformed GST match.";
    if (g.refKey !== null && !REF_KEY.test(g.refKey)) return "Malformed reference key.";
    if (g.matchedBy !== "ref" && g.matchedBy !== "amount") return "Malformed GST match.";
  }
  return null;
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Records instalments and the GST charges traced to earlier ones. */
export async function saveLineage(ownerEmail: string, cardId: string | null, p: LineagePayload): Promise<void> {
  for (const i of p.instalments) {
    await prisma.emiInstalment.upsert({
      where: { ownerEmail_loanKey_date: { ownerEmail, loanKey: i.loanKey, date: toDate(i.date) } },
      create: {
        ownerEmail,
        cardId,
        loanKey: i.loanKey,
        loanLast4: i.loanLast4,
        instalmentNo: i.instalmentNo,
        date: toDate(i.date),
        principal: i.principal,
        interest: i.interest,
        refKey: i.refKey,
        gst: i.gst,
        gstPeriod: i.gst !== null ? i.period : null,
        period: i.period,
      },
      update: {
        cardId: cardId ?? undefined,
        loanLast4: i.loanLast4 ?? undefined,
        instalmentNo: i.instalmentNo ?? undefined,
        principal: i.principal,
        interest: i.interest,
        refKey: i.refKey ?? undefined,
        ...(i.gst !== null ? { gst: i.gst, gstPeriod: i.period } : {}),
        period: i.period,
      },
    });
  }
  for (const g of p.gstMatches) {
    // By the cited reference when there is one, else by loan and date.
    const where = g.matchedBy === "ref" && g.refKey ? { ownerEmail, refKey: g.refKey } : { ownerEmail, loanKey: g.loanKey, date: toDate(g.date) };
    await prisma.emiInstalment.updateMany({ where, data: { gst: g.gst, gstPeriod: g.gstPeriod } });
  }
  await resolvePendingGst(ownerEmail, p.instalments.map((i) => i.refKey).filter((k): k is string => !!k));
}

// ---- GST added before its instalment was on record ---------------------
// A lone GST line cites the reference of the interest line it taxes. When
// that line's statement has not been uploaded yet, the user can still add
// the charge. It is remembered here by the reference's key, flagged on the
// expense, and traced the moment the earlier statement is uploaded.

export interface PendingGstInput {
  expenseId: number;
  refKey: string;
  amount: number;
  /** YYYY-MM-DD printed on the GST line, normally the instalment's own date. */
  date: string;
  /** Statement month that billed the GST, YYYY-MM. */
  period: string;
}

export async function recordPendingGst(ownerEmail: string, input: PendingGstInput): Promise<void> {
  await prisma.gstPending.create({
    data: { ownerEmail, expenseId: input.expenseId, refKey: input.refKey, amount: input.amount, date: toDate(input.date), period: input.period },
  });
}

/** The reason shown on the expense while its GST charge is untraced. */
export function pendingGstReason(p: { amount: number; date: Date }): string {
  const iso = formatDate(p.date);
  const day = new Date(p.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return (
    `This GST charge of ₹${p.amount.toFixed(2)} dated ${day} cites a reference that is not on record. ` +
    `It is most likely GST on an EMI instalment billed in the ${monthLabel(iso.slice(0, 7))} statement. ` +
    `Upload that statement on the Statements page and this charge will be traced to its instalment by the reference and renamed.`
  );
}

/** Reasons for the expenses that still carry an untraced GST charge. */
export async function pendingFlagsFor(expenseIds: number[]): Promise<Map<number, string>> {
  const flags = new Map<number, string>();
  if (expenseIds.length === 0) return flags;
  const rows = await prisma.gstPending.findMany({ where: { expenseId: { in: expenseIds }, resolvedAt: null } });
  for (const r of rows) flags.set(r.expenseId, pendingGstReason(r));
  return flags;
}

/**
 * Traces every pending GST charge whose cited reference is now on record:
 * the instalment gets its GST, the expense its lineage name, and the flag
 * is cleared. Returns how many were traced.
 */
export async function resolvePendingGst(ownerEmail: string, refKeys: string[]): Promise<number> {
  if (refKeys.length === 0) return 0;
  const pending = await prisma.gstPending.findMany({ where: { ownerEmail, resolvedAt: null, refKey: { in: refKeys } } });
  let traced = 0;
  for (const p of pending) {
    const inst = await prisma.emiInstalment.findFirst({ where: { ownerEmail, refKey: p.refKey } });
    if (!inst) continue;
    await prisma.$transaction([
      prisma.emiInstalment.update({ where: { id: inst.id }, data: { gst: p.amount, gstPeriod: p.period } }),
      prisma.expense.updateMany({ where: { id: p.expenseId }, data: { item: gstLineageName(inst) } }),
      prisma.gstPending.update({ where: { id: p.id }, data: { resolvedAt: new Date(), resolvedInstalmentId: inst.id } }),
    ]);
    traced++;
  }
  return traced;
}

/** Every instalment on record, for the browser to trace GST charges against. */
export async function listInstalments(ownerEmail: string): Promise<KnownInstalment[]> {
  const rows = await prisma.emiInstalment.findMany({ where: { ownerEmail }, orderBy: [{ loanKey: "asc" }, { date: "asc" }] });
  return rows.map((r) => ({
    loanKey: r.loanKey,
    loanLast4: r.loanLast4,
    instalmentNo: r.instalmentNo,
    date: formatDate(r.date),
    principal: r.principal,
    interest: r.interest,
    refKey: r.refKey,
    gst: r.gst,
    period: r.period,
  }));
}

export interface LoanView {
  loanKey: string;
  loanLast4: string | null;
  card: string | null;
  instalments: {
    id: number;
    instalmentNo: number | null;
    date: string;
    principal: number;
    interest: number;
    gst: number | null;
    gstPeriod: string | null;
    period: string;
  }[];
}

/** Instalments grouped by loan, for the Loans panel. */
export async function listLoans(ownerEmail: string): Promise<LoanView[]> {
  const rows = await prisma.emiInstalment.findMany({
    where: { ownerEmail },
    orderBy: [{ loanKey: "asc" }, { date: "asc" }],
    include: { card: true },
  });
  const loans = new Map<string, LoanView>();
  for (const r of rows) {
    let loan = loans.get(r.loanKey);
    if (!loan) {
      loan = {
        loanKey: r.loanKey,
        loanLast4: r.loanLast4,
        card: r.card ? `${r.card.bank === "hdfc" ? "HDFC Bank" : r.card.bank === "icici" ? "ICICI Bank" : "Card"} •••• ${r.card.last4}` : null,
        instalments: [],
      };
      loans.set(r.loanKey, loan);
    }
    loan.loanLast4 ??= r.loanLast4;
    loan.instalments.push({
      id: r.id,
      instalmentNo: r.instalmentNo,
      date: formatDate(r.date),
      principal: r.principal,
      interest: r.interest,
      gst: r.gst,
      gstPeriod: r.gstPeriod,
      period: r.period,
    });
  }
  return [...loans.values()];
}

export async function deleteLoan(ownerEmail: string, loanKey: string): Promise<void> {
  await prisma.emiInstalment.deleteMany({ where: { ownerEmail, loanKey } });
}
