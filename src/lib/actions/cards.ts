"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { statementsEnabled } from "@/lib/features";
import {
  deleteCard,
  deleteCardStatement,
  saveCardStatement,
  validateSaveInput,
  type SaveStatementInput,
} from "@/lib/cards";
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

export async function deleteCardAction(id: string): Promise<Result> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  await deleteCard(email, id);
  revalidatePath("/statements");
  return { ok: true };
}

export async function deleteCardStatementAction(id: number): Promise<Result> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(id)) return { ok: false, error: "Invalid statement." };
  await deleteCardStatement(email, id);
  revalidatePath("/statements");
  return { ok: true };
}
