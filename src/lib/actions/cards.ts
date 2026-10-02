"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { statementsEnabled } from "@/lib/features";
import {
  deleteCard,
  deleteCardStatement,
  planCardRemoval,
  planStatementRemoval,
  saveCardStatement,
  validateSaveInput,
  type RemovalPlan,
  type SaveStatementInput,
} from "@/lib/cards";
import { prisma } from "@/lib/prisma";
import { notifyGroup } from "@/lib/notifications";
import { displayNameFor } from "@/lib/users";
import { maskEmail } from "@/lib/pii";
import { formatINR } from "@/lib/format";
import { deleteLoan, saveLineage, validateLineage } from "@/lib/loans";
import type { LineagePayload } from "@/lib/statements/lineage";

type Result = { ok: true } | { ok: false; error: string };

async function requireEmail(): Promise<string | null> {
  if (!statementsEnabled()) return null;
  const session = await auth();
  return session?.user?.email ?? null;
}

/**
 * Files a parsed statement's summary under the signed-in user's card, and
 * the EMI instalments it billed, with the GST charges traced to earlier ones.
 */
export async function saveStatementSummaryAction(input: SaveStatementInput, lineage?: LineagePayload): Promise<Result> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  const invalid = validateSaveInput(input);
  if (invalid) return { ok: false, error: invalid };
  const { cardId } = await saveCardStatement(email, input);
  if (lineage) {
    const bad = validateLineage(lineage);
    if (bad) return { ok: false, error: bad };
    await saveLineage(email, cardId, lineage);
  }
  // Tracing a pending GST charge renames an expense and clears its warning.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteLoanAction(loanKey: string): Promise<Result> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  if (typeof loanKey !== "string" || !/^l_[A-Za-z0-9_-]{16,64}$/.test(loanKey)) return { ok: false, error: "Invalid loan." };
  await deleteLoan(email, loanKey);
  revalidatePath("/statements");
  return { ok: true };
}

export type RemovalPreview = Omit<RemovalPlan, "expenseIds" | "instalmentIds">;
type PreviewResult = { ok: true; preview: RemovalPreview } | { ok: false; error: string };

// Only what the popup shows; row ids stay on the server.
const toPreview = (p: RemovalPlan): RemovalPreview => ({
  label: p.label,
  statements: p.statements,
  personal: p.personal,
  groups: p.groups,
  kept: p.kept,
  instalments: p.instalments,
});

/** What removing a card would delete, for the confirmation popup. */
export async function cardRemovalPreviewAction(id: string): Promise<PreviewResult> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  if (typeof id !== "string") return { ok: false, error: "Invalid card." };
  const plan = await planCardRemoval(email, id);
  return plan ? { ok: true, preview: toPreview(plan) } : { ok: false, error: "Card not found." };
}

/** What removing one statement would delete, for the confirmation popup. */
export async function statementRemovalPreviewAction(id: number): Promise<PreviewResult> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(id)) return { ok: false, error: "Invalid statement." };
  const plan = await planStatementRemoval(email, id);
  return plan ? { ok: true, preview: toPreview(plan) } : { ok: false, error: "Statement not found." };
}

/**
 * Tells each group that lost expenses, since its balances change for
 * everyone in it. The message carries a count and total, nothing more.
 */
async function notifyRemoval(email: string, plan: RemovalPlan) {
  if (plan.groups.length === 0) return;
  try {
    const u = await prisma.appUser.findUnique({ where: { email } });
    // Stored and shown to other members: never the raw address.
    const who = displayNameFor(u, maskEmail(email));
    for (const g of plan.groups) {
      await notifyGroup({
        groupId: g.id,
        actorEmail: email,
        type: "expense_deleted",
        message: `${who} deleted ${g.count} imported expense${g.count === 1 ? "" : "s"} (${formatINR(g.total)})`,
        // A count and total only: a removed card or statement leaves no item names behind.
        target: { kind: "deleted", items: [], count: g.count, total: g.total },
      });
    }
  } catch {
    // Best-effort, as for single deletions.
  }
}

/**
 * Removes a card with its statements, the expenses imported from them
 * (Personal and group) and their history, and its EMI records.
 */
export async function deleteCardAction(id: string): Promise<Result> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  if (typeof id !== "string") return { ok: false, error: "Invalid card." };
  const plan = await deleteCard(email, id);
  if (!plan) return { ok: false, error: "Card not found." };
  await notifyRemoval(email, plan);
  // Personal and group expenses both changed.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Removes one statement the same way: its expenses, their history, its EMIs. */
export async function deleteCardStatementAction(id: number): Promise<Result> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(id)) return { ok: false, error: "Invalid statement." };
  const plan = await deleteCardStatement(email, id);
  if (!plan) return { ok: false, error: "Statement not found." };
  await notifyRemoval(email, plan);
  revalidatePath("/", "layout");
  return { ok: true };
}
