"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createReceiptWithItems, type NewReceiptItem } from "@/lib/receipts";
import { isGroupMember, getGroupParticipants } from "@/lib/groups";
import { notifyGroup } from "@/lib/notifications";
import { displayNameFor } from "@/lib/users";
import { formatINR } from "@/lib/format";
import { cleanText, isValidAmount, isValidDateISO } from "@/lib/validate";
import { emailForKey } from "@/lib/wire";
import { maskEmail } from "@/lib/pii";
import { SPLIT_EQUAL } from "@/lib/constants";

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

export async function addReceiptAction(input: {
  ctx: string; // "personal" or a group id
  merchant: string;
  purchasedOn: string; // YYYY-MM-DD, applied to every line item
  payer: string; // wire participant key
  split: string; // "equal" or a wire participant key
  items: ReceiptItemInput[];
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

  await createReceiptWithItems({
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
      const who = displayNameFor(actor, maskEmail(email));
      await notifyGroup({
        groupId,
        actorEmail: email,
        type: "expense_added",
        message: `${who} scanned a receipt from ${merchant} — ${items.length} items (${formatINR(total)})`,
      });
    } catch {
      // best-effort
    }
  }

  for (const p of ["/", "/add", "/log", "/summary", "/settlement", "/notifications"])
    revalidatePath(p);
  return { ok: true, count: items.length };
}
