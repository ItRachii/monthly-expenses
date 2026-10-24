"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createReceiptWithItems, settleReceipts, updateReceiptDetails, type NewReceiptItem } from "@/lib/receipts";
import { canonicalCategoriesFor, createExpense } from "@/lib/expenses";
import { isGroupMember, getGroupParticipants } from "@/lib/groups";
import { notifyGroup } from "@/lib/notifications";
import { nameForOthers } from "@/lib/users";
import { formatINR } from "@/lib/format";
import { cleanText, isValidAmount, isValidDateISO } from "@/lib/validate";
import { emailForKey } from "@/lib/wire";
import { PAYER_MULTIPLE, SPLIT_CUSTOM, SPLIT_EQUAL } from "@/lib/constants";
import { recordScanEvent } from "@/lib/scanEvents";
import { isAttemptId, type ScanEventInput } from "@/lib/scanTracking";

export interface ReceiptItemInput {
  description: string;
  category: string;
  amount: number;
  gstRate: number | null;
  gstAmount: number | null;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  count?: number;
}

const MAX_ITEMS = 100;

function gstOrNull(v: number | null, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
}

async function saveReceipt(input: {
  ctx: string; // "personal" or a group id
  merchant: string;
  purchasedOn: string; // YYYY-MM-DD, applied to every line item
  payer: string; // wire participant key
  split: string; // "equal" or a wire participant key
  items: ReceiptItemInput[];
  /** The scanner attempt this save ends, for the usage metrics. */
  attempt?: string;
}): Promise<ActionResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };

  if (!isValidDateISO(input.purchasedOn))
    return { ok: false, error: "Please pick a valid receipt date." };
  if (!Array.isArray(input.items) || input.items.length === 0)
    return { ok: false, error: "Add at least one line item." };
  if (input.items.length > MAX_ITEMS)
    return { ok: false, error: `A receipt can have at most ${MAX_ITEMS} items.` };

  const merchant = cleanText(input.merchant, 80) || "Receipt";

  // Clean + validate every line item before touching the database.
  const items: NewReceiptItem[] = [];
  for (const raw of input.items) {
    const description = cleanText(raw.description, 200);
    if (!description) return { ok: false, error: "Every line item needs a description." };
    if (!isValidAmount(raw.amount))
      return { ok: false, error: `Amount for "${description}" must be a positive number.` };
    items.push({
      description,
      category: cleanText(raw.category, 50),
      amount: raw.amount,
      gstRate: gstOrNull(raw.gstRate, 100),
      gstAmount: gstOrNull(raw.gstAmount, raw.amount),
    });
  }
  const total = Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100;

  // Resolve context + payer/split exactly like a normal expense.
  let ownerEmail: string | null = null;
  let groupId: string | null = null;
  let payer: string;
  let split: string;
  if (input.ctx === "personal") {
    ownerEmail = email;
    payer = email;
    split = SPLIT_EQUAL;
  } else {
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

  const categories = await canonicalCategoriesFor(
    groupId ? { kind: "group", groupId } : { kind: "personal", email },
    items.map((it) => it.category),
  );
  items.forEach((it, i) => (it.category = categories[i]));

  const receiptId = await createReceiptWithItems({
    merchant,
    purchasedOn: input.purchasedOn,
    total,
    ownerEmail,
    groupId,
    createdBy: email,
    payer,
    split,
    items,
  });

  if (groupId) {
    try {
      const actor = await prisma.appUser.findUnique({ where: { email } });
      const who = await nameForOthers(actor, email);
      await notifyGroup({
        groupId,
        actorEmail: email,
        type: "expense_added",
        message: `${who} scanned a receipt from ${merchant}: ${items.length} items (${formatINR(total)})`,
        target: {
          kind: "expenses",
          ids: (await prisma.expense.findMany({ where: { receiptId }, select: { id: true } })).map((e) => e.id),
        },
      });
    } catch {
      // best-effort
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, count: items.length };
}

/** How a save's answer is counted: refusals that are the person's to fix, ones the server made, and a crash. */
function saveOutcome(res: ActionResult): "ok" | "invalid" | "refused" {
  if (res.ok) return "ok";
  return /not a member|not signed in/i.test(res.error ?? "") ? "refused" : "invalid";
}

export async function addReceiptAction(input: Parameters<typeof saveReceipt>[0]): Promise<ActionResult> {
  const attempt = isAttemptId(input?.attempt) ? input.attempt : null;
  // Who is saving, for the usage metrics (a save with nobody signed in is refused below, and not counted).
  const user = attempt ? (await auth())?.user?.email ?? null : null;
  const track = (e: Omit<ScanEventInput, "attempt">) => (attempt && user ? recordScanEvent({ ...e, attempt }, user) : Promise.resolve());
  const t0 = Date.now();
  await track({ event: "save_attempted", n: Array.isArray(input.items) ? input.items.length : 0 });
  try {
    const res = await saveReceipt(input);
    await track({ event: "save_result", outcome: saveOutcome(res), ms: Date.now() - t0 });
    return res;
  } catch (e) {
    await track({ event: "save_result", outcome: "error", ms: Date.now() - t0 });
    throw e;
  }
}

/**
 * Renames a scanned receipt and sets one date for it and all its items, so
 * the merchant and the day can be fixed in one place instead of per item.
 */
export async function updateReceiptAction(
  receiptId: string,
  input: { merchant: string; date: string },
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (typeof receiptId !== "string" || !receiptId) return { ok: false, error: "Receipt not found." };
  const merchant = cleanText(input.merchant, 80);
  if (!merchant) return { ok: false, error: "Please enter the shop name." };
  if (!isValidDateISO(input.date)) return { ok: false, error: "Please enter a valid date." };

  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
  if (!receipt) return { ok: false, error: "Receipt not found." };
  if (receipt.ownerEmail) {
    if (receipt.ownerEmail !== email) return { ok: false, error: "Not authorized." };
  } else if (receipt.groupId) {
    if (!(await isGroupMember(receipt.groupId, email))) return { ok: false, error: "Not authorized." };
  } else {
    return { ok: false, error: "Not authorized." };
  }

  const { changed, itemIds } = await updateReceiptDetails(receiptId, merchant, input.date);

  if (changed && receipt.groupId && itemIds.length > 0) {
    try {
      const actor = await prisma.appUser.findUnique({ where: { email } });
      const who = await nameForOthers(actor, email);
      await notifyGroup({
        groupId: receipt.groupId,
        actorEmail: email,
        type: "expense_updated",
        message: `${who} edited the receipt from ${merchant}: ${itemIds.length} items`,
        target: { kind: "expenses", ids: itemIds },
      });
    } catch {
      // best-effort
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Adds one item to a scanned receipt (one the scan missed, or a fix). It takes
 * the receipt's own date and the payer and split of its other items, so it
 * sits in the receipt like the rest; its amount moves the receipt's total.
 * The item can be edited afterwards like any other.
 */
export async function addReceiptItemAction(
  receiptId: string,
  input: { item: string; category: string; amount: number },
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (typeof receiptId !== "string" || !receiptId) return { ok: false, error: "Receipt not found." };
  const item = cleanText(input.item, 200);
  if (!item) return { ok: false, error: "Please enter an item description." };
  if (!isValidAmount(input.amount)) return { ok: false, error: "Amount must be a positive number." };

  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
  if (!receipt) return { ok: false, error: "Receipt not found." };
  if (receipt.ownerEmail) {
    if (receipt.ownerEmail !== email) return { ok: false, error: "Not authorized." };
  } else if (receipt.groupId) {
    if (!(await isGroupMember(receipt.groupId, email))) return { ok: false, error: "Not authorized." };
  } else {
    return { ok: false, error: "Not authorized." };
  }

  // Who paid and how it is split come from an item that has one payer and an
  // even or single-person split: custom amounts per person belong to their
  // item's amount and cannot be copied to another.
  const existing = await prisma.expense.findMany({ where: { receiptId }, orderBy: { id: "asc" } });
  const template = existing.find((e) => e.split !== SPLIT_CUSTOM && e.payer !== PAYER_MULTIPLE);
  if (!template)
    return { ok: false, error: "This receipt's items are split by hand, so a new one cannot copy how. Add it as a normal expense." };

  const [category] = await canonicalCategoriesFor(
    receipt.groupId ? { kind: "group", groupId: receipt.groupId } : { kind: "personal", email },
    [cleanText(input.category, 50)],
  );
  const date = (receipt.purchasedOn ?? template.date).toISOString().slice(0, 10);

  const newId = await prisma.$transaction(async (tx) => {
    const { id } = await createExpense(
      {
        date,
        category,
        item,
        amount: input.amount,
        payer: template.payer,
        split: template.split,
        shares: null,
        ownerEmail: receipt.ownerEmail,
        groupId: receipt.groupId,
        receiptId,
      },
      tx,
    );
    await settleReceipts(tx, new Map([[receiptId, input.amount]]));
    return id;
  });

  if (receipt.groupId) {
    try {
      const actor = await prisma.appUser.findUnique({ where: { email } });
      const who = await nameForOthers(actor, email);
      await notifyGroup({
        groupId: receipt.groupId,
        actorEmail: email,
        type: "expense_added",
        message: `${who} added "${item}" (${formatINR(input.amount)}) to the receipt from ${receipt.merchant}`,
        target: { kind: "expenses", ids: [newId] },
      });
    } catch {
      // best-effort
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
