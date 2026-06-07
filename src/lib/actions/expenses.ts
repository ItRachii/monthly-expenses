"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createExpense, updateExpense, deleteExpense } from "@/lib/expenses";
import { isGroupMember, getGroupParticipants } from "@/lib/groups";
import { notifyGroup } from "@/lib/notifications";
import { displayNameFor } from "@/lib/users";
import { formatINR } from "@/lib/format";
import { SPLIT_EQUAL } from "@/lib/constants";

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
  return displayNameFor(u, email);
}

export async function addExpenseAction(input: {
  ctx: string; // "personal" or a group id
  date: string;
  category: string;
  item: string;
  amount: number;
  payer: string;
  split: string;
}): Promise<ActionResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (!input.item.trim()) return { ok: false, error: "Please enter an item description." };
  if (!(input.amount > 0)) return { ok: false, error: "Amount must be greater than zero." };

  let ownerEmail: string | null = null;
  let groupId: string | null = null;
  // Resolve payer/split server-side so stale form values can never be persisted.
  let payer = input.payer;
  let split = input.split;

  if (input.ctx === "personal") {
    // Personal/solo: the only person is the signed-in user.
    ownerEmail = email;
    payer = email;
    split = SPLIT_EQUAL;
  } else {
    if (!(await isGroupMember(input.ctx, email)))
      return { ok: false, error: "You are not a member of this group." };
    groupId = input.ctx;

    // Validate: payer must be a member email; split must be "equal" or a member
    // email. On anything invalid, fall back to a safe default.
    const memberEmails = new Set(
      (await getGroupParticipants(input.ctx)).map((m) => m.email),
    );
    if (!memberEmails.has(payer)) payer = email;
    if (split !== SPLIT_EQUAL && !memberEmails.has(split)) split = SPLIT_EQUAL;
  }

  await createExpense({
    date: input.date,
    category: input.category,
    item: input.item.trim(),
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
        message: `${who} added "${input.item.trim()}" (${formatINR(input.amount)})`,
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
    payer: string;
    split: string;
  },
): Promise<ActionResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (!input.item.trim()) return { ok: false, error: "Please enter an item description." };
  if (!(input.amount > 0)) return { ok: false, error: "Amount must be greater than zero." };

  const exp = await prisma.expense.findUnique({ where: { id } });
  if (!exp) return { ok: false, error: "Expense not found." };

  // Authorize against, and resolve payer/split within, the expense's own
  // context (mirrors addExpenseAction) so stale form values can't be persisted.
  let payer = input.payer;
  let split = input.split;
  if (exp.ownerEmail) {
    if (exp.ownerEmail !== email) return { ok: false, error: "Not authorized." };
    payer = exp.ownerEmail;
    split = SPLIT_EQUAL;
  } else if (exp.groupId) {
    if (!(await isGroupMember(exp.groupId, email)))
      return { ok: false, error: "Not authorized." };
    const memberEmails = new Set(
      (await getGroupParticipants(exp.groupId)).map((m) => m.email),
    );
    if (!memberEmails.has(payer)) payer = exp.payer;
    if (split !== SPLIT_EQUAL && !memberEmails.has(split)) split = SPLIT_EQUAL;
  }

  // The Postgres trigger records this update in expense_changes (CDC).
  await updateExpense(id, {
    date: input.date,
    category: input.category,
    item: input.item.trim(),
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
        message: `${who} edited "${input.item.trim()}" (${formatINR(input.amount)})`,
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

  const exp = await prisma.expense.findUnique({ where: { id } });
  if (!exp) return { ok: false, error: "Expense not found." };

  if (exp.ownerEmail) {
    if (exp.ownerEmail !== email) return { ok: false, error: "Not authorized." };
  } else if (exp.groupId) {
    if (!(await isGroupMember(exp.groupId, email)))
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
