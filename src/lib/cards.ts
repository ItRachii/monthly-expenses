import { prisma } from "./prisma";
import { formatDate } from "./format";
import { pendingGstReason } from "./loans";
import type { Bank, StatementSummary } from "./statements/types";

// Credit cards and their statement summaries. Filed under the user's own
// account (owner is the user id), never under a group. A card is known by
// its bank and last four digits only.

export const BANK_LABEL: Record<Bank, string> = {
  hdfc: "HDFC Bank",
  icici: "ICICI Bank",
  unknown: "Card",
};

/** An expense imported from a statement, and where it was filed. */
export interface StatementExpenseView {
  id: number;
  date: string;
  item: string;
  category: string;
  amount: number;
  /** The group it was added to, or null for Personal. */
  group: { id: string; name: string } | null;
  /**
   * Set while this is a GST charge whose instalment is not on record yet:
   * the statement month (YYYY-MM) that billed the instalment, and why.
   */
  gstPending: { month: string; reason: string } | null;
}

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
  /** True when the statement carried no summary box (ICICI's CSV export). */
  figuresMissing: boolean;
  expenses: StatementExpenseView[];
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
    include: {
      statements: {
        orderBy: { period: "desc" },
        include: {
          expenses: {
            orderBy: [{ date: "desc" }, { id: "desc" }],
            select: {
              id: true,
              date: true,
              item: true,
              category: true,
              amount: true,
              group: { select: { id: true, name: true } },
              gstPending: { where: { resolvedAt: null }, select: { amount: true, date: true }, take: 1 },
            },
          },
        },
      },
    },
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
      figuresMissing: s.totalDue === null && s.purchases === null && s.creditLimit === null && s.dueDate === null,
      expenses: s.expenses.map((e) => ({
        id: e.id,
        date: formatDate(e.date),
        item: e.item,
        category: e.category,
        amount: e.amount,
        group: e.group,
        gstPending: e.gstPending[0]
          ? { month: formatDate(e.gstPending[0].date).slice(0, 7), reason: pendingGstReason(e.gstPending[0]) }
          : null,
      })),
    })),
  }));
}

/**
 * The card and statement an import belongs to, created without figures
 * when the file had no summary box (ICICI's CSV), so its expenses still
 * have a statement to sit under. A later summary save fills the figures in.
 */
export async function fileStatementShell(
  ownerEmail: string,
  input: { bank: Bank; last4: string; product: string | null; period: string },
): Promise<{ cardId: string; statementId: number }> {
  const product = input.product ? input.product.slice(0, 40) : null;
  const card = await prisma.card.upsert({
    where: { ownerEmail_bank_last4: { ownerEmail, bank: input.bank, last4: input.last4 } },
    create: { ownerEmail, bank: input.bank, last4: input.last4, product },
    update: product ? { product } : {},
  });
  const statement = await prisma.cardStatement.upsert({
    where: { cardId_period: { cardId: card.id, period: input.period } },
    create: { cardId: card.id, period: input.period },
    update: {},
    select: { id: true },
  });
  return { cardId: card.id, statementId: statement.id };
}

/** Files one statement's summary under its card, replacing the same month. */
export async function saveCardStatement(ownerEmail: string, input: SaveStatementInput): Promise<{ cardId: string; statementId: number }> {
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
  const statement = await prisma.cardStatement.upsert({
    where: { cardId_period: { cardId: card.id, period: input.period } },
    create: { cardId: card.id, period: input.period, ...data },
    update: data,
    select: { id: true },
  });
  return { cardId: card.id, statementId: statement.id };
}

/**
 * Everything removing a card takes with it: its statements, the expenses
 * imported from them (Personal ones, and group ones in groups the owner is
 * still in), and the EMI instalments it billed. Group expenses in a group
 * the owner has left are not theirs to delete; they stay, unlinked.
 */
export interface CardRemovalPlan {
  card: { bank: string; last4: string };
  statements: number;
  personal: { count: number; total: number };
  groups: { id: string; name: string; count: number; total: number }[];
  /** Group expenses in groups the owner has left, which are kept. */
  kept: number;
  instalments: number;
  expenseIds: number[];
}

export async function planCardRemoval(ownerEmail: string, id: string): Promise<CardRemovalPlan | null> {
  const card = await prisma.card.findFirst({
    where: { id, ownerEmail },
    select: { bank: true, last4: true, _count: { select: { statements: true, instalments: true } } },
  });
  if (!card) return null;
  const linked = await prisma.expense.findMany({
    where: { statement: { cardId: id } },
    select: { id: true, ownerEmail: true, groupId: true, amount: true, group: { select: { name: true } } },
  });
  const groupIds = Array.from(new Set(linked.flatMap((e) => (e.groupId && !e.ownerEmail ? [e.groupId] : []))));
  const memberOf = new Set(
    (await prisma.groupMember.findMany({ where: { groupId: { in: groupIds }, email: ownerEmail }, select: { groupId: true } })).map((m) => m.groupId),
  );

  const plan: CardRemovalPlan = {
    card: { bank: BANK_LABEL[card.bank as Bank] ?? card.bank, last4: card.last4 },
    statements: card._count.statements,
    personal: { count: 0, total: 0 },
    groups: [],
    kept: 0,
    instalments: card._count.instalments,
    expenseIds: [],
  };
  const byGroup = new Map<string, CardRemovalPlan["groups"][number]>();
  for (const e of linked) {
    if (e.ownerEmail === ownerEmail && !e.groupId) {
      plan.personal.count++;
      plan.personal.total += e.amount;
    } else if (e.groupId && !e.ownerEmail && memberOf.has(e.groupId)) {
      const g = byGroup.get(e.groupId) ?? { id: e.groupId, name: e.group?.name ?? "Group", count: 0, total: 0 };
      g.count++;
      g.total += e.amount;
      byGroup.set(e.groupId, g);
    } else {
      plan.kept++;
      continue;
    }
    plan.expenseIds.push(e.id);
  }
  plan.groups = Array.from(byGroup.values()).sort((a, b) => a.name.localeCompare(b.name));
  return plan;
}

/** Removes the card and everything in its plan, in one transaction. */
export async function deleteCard(ownerEmail: string, id: string): Promise<CardRemovalPlan | null> {
  const plan = await planCardRemoval(ownerEmail, id);
  if (!plan) return null;
  await prisma.$transaction([
    prisma.expense.deleteMany({ where: { id: { in: plan.expenseIds } } }),
    prisma.emiInstalment.deleteMany({ where: { ownerEmail, cardId: id } }),
    // Its statements go with it (ON DELETE CASCADE).
    prisma.card.deleteMany({ where: { id, ownerEmail } }),
  ]);
  return plan;
}

export async function deleteCardStatement(ownerEmail: string, id: number): Promise<void> {
  await prisma.cardStatement.deleteMany({ where: { id, card: { ownerEmail } } });
}
