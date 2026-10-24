"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  canonicalCategoriesFor,
  createExpense,
  updateExpense,
  deleteExpenses,
} from "@/lib/expenses";
import { isGroupMember, getGroupParticipants } from "@/lib/groups";
import { notifyGroup } from "@/lib/notifications";
import { nameForOthers } from "@/lib/users";
import { formatDate, formatINR } from "@/lib/format";
import { PAYER_MULTIPLE, SPLIT_CUSTOM, SPLIT_EQUAL } from "@/lib/constants";
import { MAX_AMOUNT, cleanText, isValidAmount, isValidDateISO } from "@/lib/validate";
import { SETTLE_EPS, round2, type Shares } from "@/lib/settlementMath";
import type { MemberDTO } from "@/lib/groups";
import { emailForKey } from "@/lib/wire";
import { buildAddSetup, type AddSetup } from "@/lib/addSetup";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function revalidateExpenseViews() {
  // Expenses surface on the home dashboard and every /g/[ctx] tab, so
  // refresh the whole app shell rather than enumerating routes.
  revalidatePath("/", "layout");
}

/** Display name for the signed-in actor, used in notification messages. */
async function actorName(email: string): Promise<string> {
  const u = await prisma.appUser.findUnique({ where: { email } });
  // Fallback is the masked address — notification messages are stored and
  // shown to other members, so the raw email never lands in them.
  return nameForOthers(u, email);
}

function validateExpenseInput(input: {
  date: string;
  category: string;
  item: string;
  amount: number;
}): { item: string; category: string } | { error: string } {
  const item = cleanText(input.item, 200);
  if (!item) return { error: "Please enter an item description." };
  if (!isValidDateISO(input.date)) return { error: "Please pick a valid date." };
  if (!isValidAmount(input.amount))
    return { error: "Amount must be a positive number." };
  // Category is cleaned free text, not a whitelist: the dropdown only suggests
  // the standard set, but legacy rows carry values outside it ("Clothes",
  // "Rent", "", lowercase variants) that must remain editable. The label is
  // escaped on render and capped here, so an arbitrary string is harmless.
  const category = cleanText(input.category, 50);
  return { item, category };
}

/**
 * Resolves per-person amounts sent as { wireKey: rupees } to { email: rupees }:
 * an unequal split ("owes") or several payers ("paid"). Every key must be a
 * current participant, every amount a non-negative number, and the amounts
 * must add up to the expense amount to the paisa.
 */
function resolveShares(
  scope: string,
  participants: MemberDTO[],
  input: unknown,
  amount: number,
  what: "owes" | "paid" = "owes",
): { shares: Shares } | { error: string } {
  const empty = `Enter how much each person ${what}.`;
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: empty };
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > participants.length)
    return { error: "The split has more people than the group." };
  const shares: Shares = {};
  let total = 0;
  for (const [key, value] of entries) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT)
      return { error: "Each share must be zero or a positive amount." };
    const n = round2(value);
    if (n === 0) continue;
    const email = emailForKey(scope, participants, key);
    if (!email) return { error: "Someone in this split is no longer in the group. Reopen the form." };
    total += n;
    shares[email] = n;
  }
  if (Object.keys(shares).length === 0) return { error: empty };
  if (Math.abs(round2(total) - round2(amount)) > SETTLE_EPS)
    return {
      error: `${what === "paid" ? "Payments" : "Shares"} add up to ${formatINR(round2(total))} but the expense is ${formatINR(amount)}.`,
    };
  return { shares };
}

/**
 * The payer of a group expense: one participant, or several with what each
 * put in. One name in the "several" map collapses to a plain single payer.
 * An unknown single key falls back to `fallback`.
 */
function resolvePayer(
  scope: string,
  participants: MemberDTO[],
  input: { payer: string; payers?: Record<string, number>; amount: number },
  fallback: string,
): { payer: string; payers: Shares | null } | { error: string } {
  if (input.payer !== PAYER_MULTIPLE)
    return { payer: emailForKey(scope, participants, input.payer) ?? fallback, payers: null };
  const res = resolveShares(scope, participants, input.payers, input.amount, "paid");
  if ("error" in res) return res;
  const ids = Object.keys(res.shares);
  if (ids.length === 1) return { payer: ids[0], payers: null };
  return { payer: PAYER_MULTIPLE, payers: res.shares };
}

export async function addExpenseAction(input: {
  ctx: string; // "personal" or a group id
  date: string;
  category: string;
  item: string;
  amount: number;
  payer: string; // wire participant key, or "multiple", resolved server-side
  split: string; // "equal", "custom" or a wire participant key
  shares?: Record<string, number>; // wire key -> rupees, when split = "custom"
  payers?: Record<string, number>; // wire key -> rupees, when payer = "multiple"
}): Promise<ActionResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };

  const checked = validateExpenseInput(input);
  if ("error" in checked) return { ok: false, error: checked.error };
  const { item } = checked;

  let ownerEmail: string | null = null;
  let groupId: string | null = null;
  // Resolve payer/split server-side: clients only ever send opaque participant
  // keys, and anything invalid or stale falls back to a safe default.
  let payer: string;
  let payers: Shares | null = null;
  let split: string;
  let shares: Shares | null = null;

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
    const who = resolvePayer(input.ctx, participants, input, email);
    if ("error" in who) return { ok: false, error: who.error };
    payer = who.payer;
    payers = who.payers;
    if (input.split === SPLIT_CUSTOM) {
      const res = resolveShares(input.ctx, participants, input.shares, input.amount);
      if ("error" in res) return { ok: false, error: res.error };
      split = SPLIT_CUSTOM;
      shares = res.shares;
    } else {
      split =
        input.split === SPLIT_EQUAL
          ? SPLIT_EQUAL
          : emailForKey(input.ctx, participants, input.split) ?? SPLIT_EQUAL;
    }
  }

  const [category] = await canonicalCategoriesFor(
    groupId ? { kind: "group", groupId } : { kind: "personal", email },
    [checked.category],
  );

  const created = await createExpense({
    date: input.date,
    category,
    item,
    amount: input.amount,
    payer,
    payers,
    split,
    shares,
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
        target: { kind: "expenses", ids: [created.id] },
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
    payer: string; // wire participant key, or "multiple"
    split: string; // "equal", "custom" or a wire participant key
    shares?: Record<string, number>; // wire key -> rupees, when split = "custom"
    payers?: Record<string, number>; // wire key -> rupees, when payer = "multiple"
  },
): Promise<ActionResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(id)) return { ok: false, error: "Expense not found." };

  const checked = validateExpenseInput(input);
  if ("error" in checked) return { ok: false, error: checked.error };
  const { item } = checked;

  const exp = await prisma.expense.findUnique({ where: { id } });
  if (!exp) return { ok: false, error: "Expense not found." };

  // Authorize against, and resolve payer/split within, the expense's own
  // context (mirrors addExpenseAction) so stale form values can't be persisted.
  let payer: string;
  let payers: Shares | null = null;
  let split: string;
  let shares: Shares | null = null;
  if (exp.ownerEmail) {
    if (exp.ownerEmail !== email) return { ok: false, error: "Not authorized." };
    payer = exp.ownerEmail;
    split = SPLIT_EQUAL;
  } else if (exp.groupId) {
    if (!(await isGroupMember(exp.groupId, email)))
      return { ok: false, error: "Not authorized." };
    const participants = await getGroupParticipants(exp.groupId);
    // Unknown keys keep the row's existing values rather than guessing.
    const who = resolvePayer(exp.groupId, participants, input, exp.payer);
    if ("error" in who) return { ok: false, error: who.error };
    payer = who.payer;
    payers = who.payers;
    // A stale key on a several-payers row would keep "multiple" without payers.
    if (payer === PAYER_MULTIPLE && !payers) return { ok: false, error: "Enter how much each person paid." };
    if (input.split === SPLIT_CUSTOM) {
      const res = resolveShares(exp.groupId, participants, input.shares, input.amount);
      if ("error" in res) return { ok: false, error: res.error };
      split = SPLIT_CUSTOM;
      shares = res.shares;
    } else {
      split =
        input.split === SPLIT_EQUAL
          ? SPLIT_EQUAL
          : emailForKey(exp.groupId, participants, input.split) ?? exp.split;
      // A stale key on an unequal row would keep "custom" without shares.
      if (split === SPLIT_CUSTOM) return { ok: false, error: "Pick how to split this expense." };
    }
  } else {
    // Legacy row with neither owner nor group: nobody may edit it blindly.
    return { ok: false, error: "Not authorized." };
  }

  // Same context the authorization above resolved: owner first, then group.
  const [category] = await canonicalCategoriesFor(
    exp.ownerEmail
      ? { kind: "personal", email: exp.ownerEmail }
      : { kind: "group", groupId: exp.groupId! },
    [checked.category],
  );

  // The Postgres trigger records this update in expense_changes (CDC).
  await updateExpense(id, {
    date: input.date,
    category,
    item,
    amount: input.amount,
    payer,
    payers,
    split,
    shares,
  });

  if (exp.groupId) {
    try {
      const who = await actorName(email);
      await notifyGroup({
        groupId: exp.groupId,
        actorEmail: email,
        type: "expense_updated",
        message: `${who} edited "${item}" (${formatINR(input.amount)})`,
        target: { kind: "expenses", ids: [id] },
      });
    } catch {
      // ignore notification errors
    }
  }

  revalidateExpenseViews();
  return { ok: true };
}

/** Most expenses one batch delete takes: a receipt or a page of ticked rows. */
const MAX_DELETE_BATCH = 500;
/** How many of a batch's items a notification keeps by name; the rest are only counted. */
const MAX_DELETED_SNAPSHOTS = 100;

export type DeleteManyResult =
  | { ok: false; error: string }
  | { ok: true; deleted: number[]; failed: { id: number; error: string }[] };

/**
 * Deletes expenses in one go: one sign-in check, one transaction, one
 * notification per group (not one per item). Each expense is checked on its
 * own, as a single delete would; any refused are returned with why and the
 * rest still go. Receipt headers are settled in the same transaction.
 */
export async function deleteExpensesAction(ids: number[]): Promise<DeleteManyResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (!Array.isArray(ids) || ids.some((n) => !Number.isInteger(n))) return { ok: false, error: "Expense not found." };
  const wanted = Array.from(new Set(ids));
  if (wanted.length > MAX_DELETE_BATCH) return { ok: false, error: `Delete at most ${MAX_DELETE_BATCH} at a time.` };

  const found = await prisma.expense.findMany({ where: { id: { in: wanted } } });
  const byId = new Map(found.map((e) => [e.id, e]));
  const member = new Map<string, boolean>();
  const allowed: typeof found = [];
  const failed: { id: number; error: string }[] = [];
  for (const id of wanted) {
    const exp = byId.get(id);
    if (!exp) {
      failed.push({ id, error: "Expense not found." });
    } else if (exp.ownerEmail) {
      if (exp.ownerEmail === email) allowed.push(exp);
      else failed.push({ id, error: "Not authorized." });
    } else if (exp.groupId) {
      if (!member.has(exp.groupId)) member.set(exp.groupId, await isGroupMember(exp.groupId, email));
      if (member.get(exp.groupId)) allowed.push(exp);
      else failed.push({ id, error: "Not authorized." });
    } else {
      // Legacy row with neither owner nor group: nobody may delete it blindly.
      failed.push({ id, error: "Not authorized." });
    }
  }

  await deleteExpenses(allowed.map((e) => e.id));

  // Tell each group once what went. Best-effort.
  const byGroup = new Map<string, typeof found>();
  for (const e of allowed) if (e.groupId) byGroup.set(e.groupId, [...(byGroup.get(e.groupId) ?? []), e]);
  for (const [groupId, gone] of byGroup) {
    try {
      const who = await actorName(email);
      const total = round2(gone.reduce((s, e) => s + e.amount, 0));
      await notifyGroup({
        groupId,
        actorEmail: email,
        type: "expense_deleted",
        message:
          gone.length === 1
            ? `${who} deleted "${gone[0].item}" (${formatINR(gone[0].amount)})`
            : `${who} deleted ${gone.length} expenses (${formatINR(total)})`,
        // The rows are gone, so the notification keeps what they were.
        target: {
          kind: "deleted",
          items: gone.slice(0, MAX_DELETED_SNAPSHOTS).map((e) => ({
            date: formatDate(e.date),
            item: e.item,
            category: e.category,
            amount: e.amount,
            ...(e.receiptId ? { receiptId: e.receiptId } : {}),
          })),
          count: gone.length,
          total,
        },
      });
    } catch {
      // ignore notification errors
    }
  }

  revalidateExpenseViews();
  return { ok: true, deleted: allowed.map((e) => e.id), failed };
}

export async function deleteExpenseAction(id: number): Promise<ActionResult> {
  if (!Number.isInteger(id)) return { ok: false, error: "Expense not found." };
  const res = await deleteExpensesAction([id]);
  if (!res.ok) return res;
  return res.deleted.length > 0 ? { ok: true } : { ok: false, error: res.failed[0]?.error ?? "Expense not found." };
}

/** Loads the Add Expense form's options for one context (overlay use). */
export async function getAddSetupAction(
  ctx: string,
): Promise<{ ok: true; setup: AddSetup } | { ok: false; error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  const res = await buildAddSetup(email, typeof ctx === "string" && ctx ? ctx : "personal");
  return "error" in res ? { ok: false, error: res.error } : { ok: true, setup: res.setup };
}
