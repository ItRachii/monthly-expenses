// EMI instalments on record, for tracing the GST a bank bills later back to
// the instalment it belongs to. Server only.

import { createHmac } from "crypto";
import { prisma } from "./prisma";
import { formatDate } from "./format";
import { piiSecret } from "./piiCrypto";
import type { KnownInstalment, LineagePayload } from "./statements/lineage";

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
