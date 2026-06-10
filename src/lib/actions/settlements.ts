"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createSettlement } from "@/lib/settlements";
import { isGroupMember, getGroupParticipants } from "@/lib/groups";
import { notifyGroup } from "@/lib/notifications";
import { displayNameFor } from "@/lib/users";
import { formatINR } from "@/lib/format";
import { cleanText, isValidAmount, isValidMonth } from "@/lib/validate";
import { emailForKey } from "@/lib/wire";
import { maskEmail } from "@/lib/pii";

export async function settleAction(input: {
  ctx: string;
  month: string;
  settledBy: string; // wire participant key, resolved to an email server-side
  amount: number;
  note: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (!isValidMonth(input.month))
    return { ok: false, error: "Please pick a valid month." };
  if (!isValidAmount(input.amount))
    return { ok: false, error: "Settlement amount must be a positive number." };
  const note = cleanText(input.note, 500);

  let ownerEmail: string | null = null;
  let groupId: string | null = null;
  let settledBy: string;
  if (input.ctx === "personal") {
    ownerEmail = email;
    settledBy = email;
  } else {
    if (!(await isGroupMember(input.ctx, email)))
      return { ok: false, error: "You are not a member of this group." };
    groupId = input.ctx;
    // The payer must resolve to a real participant; otherwise fall back to the
    // actor rather than persisting an attacker-supplied string.
    const participants = await getGroupParticipants(input.ctx);
    settledBy = emailForKey(input.ctx, participants, input.settledBy) ?? email;
  }

  await createSettlement({
    month: input.month,
    settledBy,
    amount: input.amount,
    note: note || null,
    ownerEmail,
    groupId,
  });

  // Notify other group members about the settlement. Best-effort.
  if (groupId) {
    try {
      const actor = await prisma.appUser.findUnique({ where: { email } });
      const who = displayNameFor(actor, maskEmail(email));
      await notifyGroup({
        groupId,
        actorEmail: email,
        type: "settlement_recorded",
        message: `${who} recorded a settlement for ${input.month} (${formatINR(input.amount)})`,
      });
    } catch {
      // ignore notification errors
    }
  }

  revalidatePath("/settlement");
  revalidatePath("/notifications");
  return { ok: true };
}
