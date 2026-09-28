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

type Result = { ok: true } | { ok: false; error: string };

async function requireEmail(): Promise<string | null> {
  if (!statementsEnabled()) return null;
  const session = await auth();
  return session?.user?.email ?? null;
}

/** Files a parsed statement's summary under the signed-in user's card. */
export async function saveStatementSummaryAction(input: SaveStatementInput): Promise<Result> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  const invalid = validateSaveInput(input);
  if (invalid) return { ok: false, error: invalid };
  await saveCardStatement(email, input);
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
