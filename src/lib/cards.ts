import { prisma } from "./prisma";
import { formatDate } from "./format";
import type { Bank, StatementSummary } from "./statements/types";

// Credit cards and their statement summaries. Filed under the user's own
// account (owner is the user id), never under a group. A card is known by
// its bank and last four digits only.

export const BANK_LABEL: Record<Bank, string> = {
  hdfc: "HDFC Bank",
  icici: "ICICI Bank",
  unknown: "Card",
};

export interface CardStatementView {
  id: number;
  period: string;
  statementDate: string | null;
  dueDate: string | null;
  previousDues: number | null;
  paymentsCredits: number | null;
  purchases: number | null;
  financeCharges: number | null;
  totalDue: number | null;
  minimumDue: number | null;
  creditLimit: number | null;
  availableCredit: number | null;
  availableCash: number | null;
  domesticTotal: number | null;
  internationalTotal: number | null;
  emiTotal: number | null;
}

export interface CardView {
  id: string;
  bank: string;
  last4: string;
  product: string | null;
  statements: CardStatementView[];
}

export interface SaveStatementInput {
  bank: Bank;
  last4: string;
  product: string | null;
  period: string;
  summary: StatementSummary;
  totals: { domestic: number; international: number; emi: number };
}

const isoDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : null);
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);

export function validateSaveInput(input: SaveStatementInput): string | null {
  if (!/^\d{4}$/.test(input.last4)) return "Card digits must be four numbers.";
  if (!/^\d{4}-\d{2}$/.test(input.period)) return "Statement month is missing.";
  if (!(input.bank in BANK_LABEL)) return "Unknown bank.";
  return null;
}

export async function listCards(ownerEmail: string): Promise<CardView[]> {
  const cards = await prisma.card.findMany({
    where: { ownerEmail },
    orderBy: [{ bank: "asc" }, { last4: "asc" }],
    include: { statements: { orderBy: { period: "desc" } } },
  });
  return cards.map((c) => ({
    id: c.id,
    bank: BANK_LABEL[c.bank as Bank] ?? c.bank,
    last4: c.last4,
    product: c.product,
    statements: c.statements.map((s) => ({
      id: s.id,
      period: s.period,
      statementDate: s.statementDate ? formatDate(s.statementDate) : null,
      dueDate: s.dueDate ? formatDate(s.dueDate) : null,
      previousDues: s.previousDues,
      paymentsCredits: s.paymentsCredits,
      purchases: s.purchases,
      financeCharges: s.financeCharges,
      totalDue: s.totalDue,
      minimumDue: s.minimumDue,
      creditLimit: s.creditLimit,
      availableCredit: s.availableCredit,
      availableCash: s.availableCash,
      domesticTotal: s.domesticTotal,
      internationalTotal: s.internationalTotal,
      emiTotal: s.emiTotal,
    })),
  }));
}

/** Files one statement's summary under its card, replacing the same month. */
export async function saveCardStatement(ownerEmail: string, input: SaveStatementInput): Promise<{ cardId: string }> {
  const product = input.product ? input.product.slice(0, 40) : null;
  const card = await prisma.card.upsert({
    where: { ownerEmail_bank_last4: { ownerEmail, bank: input.bank, last4: input.last4 } },
    create: { ownerEmail, bank: input.bank, last4: input.last4, product },
    update: product ? { product } : {},
  });
  const s = input.summary;
  const data = {
    statementDate: isoDate(s.statementDate),
    dueDate: isoDate(s.dueDate),
    previousDues: num(s.previousDues),
    paymentsCredits: num(s.paymentsCredits),
    purchases: num(s.purchases),
    financeCharges: num(s.financeCharges),
    totalDue: num(s.totalDue),
    minimumDue: num(s.minimumDue),
    creditLimit: num(s.creditLimit),
    availableCredit: num(s.availableCredit),
    availableCash: num(s.availableCash),
    domesticTotal: num(input.totals.domestic),
    internationalTotal: num(input.totals.international),
    emiTotal: num(input.totals.emi),
    importedAt: new Date(),
  };
  await prisma.cardStatement.upsert({
    where: { cardId_period: { cardId: card.id, period: input.period } },
    create: { cardId: card.id, period: input.period, ...data },
    update: data,
  });
  return { cardId: card.id };
}

export async function deleteCard(ownerEmail: string, id: string): Promise<void> {
  await prisma.card.deleteMany({ where: { id, ownerEmail } });
}

export async function deleteCardStatement(ownerEmail: string, id: number): Promise<void> {
  await prisma.cardStatement.deleteMany({ where: { id, card: { ownerEmail } } });
}
