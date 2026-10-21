"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createSettlement, getOutstandingTransfers } from "@/lib/settlements";
import { SETTLE_EPS, pairAmount, round2 } from "@/lib/settlementMath";
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
  settledTo: string; // wire participant key of the recipient (groups only)
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
  let settledTo: string | null = null;
  let remainingAfter: number | null = null;
  let memberEmails: string[] = [];

  if (input.ctx === "personal") {
    ownerEmail = email;
    settledBy = email;
  } else {
    if (!(await isGroupMember(input.ctx, email)))
      return { ok: false, error: "You are not a member of this group." };
    groupId = input.ctx;
    // Payer and recipient must both resolve to real participants; otherwise
    // fall back / reject rather than persisting an attacker-supplied string.
    const participants = await getGroupParticipants(input.ctx);
    memberEmails = participants.map((p) => p.email);
    settledBy = emailForKey(input.ctx, participants, input.settledBy) ?? email;
    settledTo = emailForKey(input.ctx, participants, input.settledTo);
    if (!settledTo)
      return { ok: false, error: "Pick who received the payment." };
    if (settledTo === settledBy)
      return { ok: false, error: "Payer and recipient must be different people." };
  }

  let created: { id: number };
  if (!groupId || !settledTo) {
    created = await createSettlement({ month: input.month, settledBy, settledTo, amount: input.amount, note: note || null, ownerEmail, groupId });
  } else {
    const gid = groupId;
    const to = settledTo;
    // Checked and recorded under a lock on this group's month: two payments
    // sent at once must not both pass the check and together exceed the debt.
    const res = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`settle:${gid}:${input.month}`}))`;
      // A payment can never exceed what this payer still owes this recipient,
      // so a month can only close once the full amount has been recovered.
      const outstanding = await getOutstandingTransfers(gid, input.month, memberEmails, tx);
      const due = pairAmount(outstanding, settledBy, to);
      if (due <= SETTLE_EPS) return { error: "Nothing is outstanding between these members for this month." };
      if (input.amount > due + SETTLE_EPS)
        return { error: `Amount exceeds the outstanding ${formatINR(due)}. Record at most what is still owed.` };
      remainingAfter = round2(Math.max(0, due - input.amount));
      return {
        created: await createSettlement(
          { month: input.month, settledBy, settledTo: to, amount: input.amount, note: note || null, ownerEmail, groupId: gid },
          tx,
        ),
      };
    });
    if ("error" in res) return { ok: false, error: res.error };
    created = res.created;
  }

  // Notify other group members about the payment. Best-effort.
  if (groupId && settledTo) {
    try {
      const people = await prisma.appUser.findMany({
        where: { email: { in: [email, settledBy, settledTo] } },
      });
      const byEmail = new Map(people.map((u) => [u.email, u]));
      const name = (e: string) => displayNameFor(byEmail.get(e) ?? null, maskEmail(e));
      const status =
        remainingAfter != null && remainingAfter > SETTLE_EPS
          ? `part payment, ${formatINR(remainingAfter)} still due`
          : "fully settled";
      await notifyGroup({
        groupId,
        actorEmail: email,
        type: "settlement_recorded",
        message: `${name(email)} recorded a payment for ${input.month}: ${name(settledBy)} paid ${name(settledTo)} ${formatINR(input.amount)} (${status})`,
        target: { kind: "settlement", id: created.id, month: input.month },
      });
    } catch {
      // ignore notification errors
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
