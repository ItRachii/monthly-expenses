"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createExpense, updateExpense, deleteExpense } from "@/lib/expenses";
import { isGroupMember, getGroupParticipants } from "@/lib/groups";
import { notifyGroup } from "@/lib/notifications";
import { displayNameFor } from "@/lib/users";
import { formatINR } from "@/lib/format";
import { CATEGORIES, SPLIT_EQUAL } from "@/lib/constants";
import { cleanText, isValidAmount, isValidDateISO } from "@/lib/validate";
import { emailForKey } from "@/lib/wire";
import { maskEmail } from "@/lib/pii";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function revalidateExpenseViews() {
  for (const p of ["/", "/add", "/log", "/summary", "/settlement", "/notifications"])
    revalidatePath(p);
}

/** Display name for the signed-in actor, used in notification messages. */
async function actorName(email: string): Promise<string> {
  const u = await prisma.appUser.findUnique({ where: { email } });
  // Fallback is the masked address — notification messages are stored and
  // shown to other members, so the raw email never lands in them.
  return displayNameFor(u, maskEmail(email));
}

function validateExpenseInput(input: {
  date: string;
  category: string;
  item: string;
  amount: number;
}): { item: string } | { error: string } {
  const item = cleanText(input.item, 200);
  if (!item) return { error: "Please enter an item description." };
  if (!isValidDateISO(input.date)) return { error: "Please pick a valid date." };
  if (!isValidAmount(input.amount))
    return { error: "Amount must be a positive number." };
  if (!(CATEGORIES as readonly string[]).includes(input.category))
    return { error: "Please pick a valid category." };
  return { item };
}

export async function addExpenseAction(input: {
  ctx: string; // "personal" or a group id
  date: string;
  category: string;
  item: string;
  amount: number;
  payer: string; // wire participant key, resolved to an email server-side
  split: string; // "equal" or a wire participant key
}): Promise<ActionResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };

  const checked = validateExpenseInput(input);
  if ("error" in checked) return { ok: false, error: checked.error };
  const item = checked.item;

  let ownerEmail: string | null = null;
  let groupId: string | null = null;
  // Resolve payer/split server-side: clients only ever send opaque participant
  // keys, and anything invalid or stale falls back to a safe default.
  let payer: string;
  let split: string;

  if (input.ctx === "personal") {
    // Personal/solo: the only person is the signed-in user.
    ownerEmail = email;
    payer = email;
    split = SPLIT_EQUAL;
  } else {
    // Only actual members may write; participants (members + pending invitees)
    // may be the payer or a split target.
    if (!(await isGroupMember(input.ctx, email)))
      return { ok: false, error: "You are not a member of this group." };
    groupId = input.ctx;

    const participants = await getGroupParticipants(input.ctx);
    payer = emailForKey(input.ctx, participants, input.payer) ?? email;
    split =
      input.split === SPLIT_EQUAL
        ? SPLIT_EQUAL
        : emailForKey(input.ctx, participants, input.split) ?? SPLIT_EQUAL;
  }

  await createExpense({
    date: input.date,
    category: input.category,
    item,
    amount: input.amount,
    payer,
    split,
    ownerEmail,
    groupId,
  });

  // Notify other group members. Best-effort: never fail the write on this.
  if (groupId) {
    try {
      const who = await actorName(email);
      await notifyGroup({
        groupId,
        actorEmail: email,
        type: "expense_added",
        message: `${who} added "${item}" (${formatINR(input.amount)})`,
      });
    } catch {
      // ignore notification errors
    }
  }

  revalidateExpenseViews();
  return { ok: true };
}

export async function updateExpenseAction(
  id: number,
  input: {
    date: string;
    category: string;
    item: string;
    amount: number;
    payer: string; // wire participant key
    split: string; // "equal" or a wire participant key
  },
): Promise<ActionResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(id)) return { ok: false, error: "Expense not found." };

  const checked = validateExpenseInput(input);
  if ("error" in checked) return { ok: false, error: checked.error };
  const item = checked.item;

  const exp = await prisma.expense.findUnique({ where: { id } });
  if (!exp) return { ok: false, error: "Expense not found." };

  // Authorize against, and resolve payer/split within, the expense's own
  // context (mirrors addExpenseAction) so stale form values can't be persisted.
  let payer: string;
  let split: string;
  if (exp.ownerEmail) {
    if (exp.ownerEmail !== email) return { ok: false, error: "Not authorized." };
    payer = exp.ownerEmail;
    split = SPLIT_EQUAL;
  } else if (exp.groupId) {
    if (!(await isGroupMember(exp.groupId, email)))
      return { ok: false, error: "Not authorized." };
    const participants = await getGroupParticipants(exp.groupId);
    // Unknown keys keep the row's existing values rather than guessing.
    payer = emailForKey(exp.groupId, participants, input.payer) ?? exp.payer;
    split =
      input.split === SPLIT_EQUAL
        ? SPLIT_EQUAL
        : emailForKey(exp.groupId, participants, input.split) ?? exp.split;
  } else {
    // Legacy row with neither owner nor group: nobody may edit it blindly.
    return { ok: false, error: "Not authorized." };
  }

  // The Postgres trigger records this update in expense_changes (CDC).
  await updateExpense(id, {
    date: input.date,
    category: input.category,
    item,
    amount: input.amount,
    payer,
    split,
  });

  if (exp.groupId) {
    try {
      const who = await actorName(email);
      await notifyGroup({
        groupId: exp.groupId,
        actorEmail: email,
        type: "expense_updated",
        message: `${who} edited "${item}" (${formatINR(input.amount)})`,
      });
    } catch {
      // ignore notification errors
    }
  }

  revalidateExpenseViews();
  return { ok: true };
}

export async function deleteExpenseAction(id: number): Promise<ActionResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(id)) return { ok: false, error: "Expense not found." };

  const exp = await prisma.expense.findUnique({ where: { id } });
  if (!exp) return { ok: false, error: "Expense not found." };

  if (exp.ownerEmail) {
    if (exp.ownerEmail !== email) return { ok: false, error: "Not authorized." };
  } else if (exp.groupId) {
    if (!(await isGroupMember(exp.groupId, email)))
      return { ok: false, error: "Not authorized." };
  } else {
    // Legacy row with neither owner nor group: nobody may delete it blindly.
    return { ok: false, error: "Not authorized." };
  }

  await deleteExpense(id);

  // Notify other group members about the deletion. Best-effort.
  if (exp.groupId) {
    try {
      const who = await actorName(email);
      await notifyGroup({
        groupId: exp.groupId,
        actorEmail: email,
        type: "expense_deleted",
        message: `${who} deleted "${exp.item}" (${formatINR(exp.amount)})`,
      });
    } catch {
      // ignore notification errors
    }
  }

  revalidateExpenseViews();
  return { ok: true };
}
