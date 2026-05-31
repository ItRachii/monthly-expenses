"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { createSettlement } from "@/lib/settlements";
import { isGroupMember } from "@/lib/groups";

export async function settleAction(input: {
  ctx: string;
  month: string;
  settledBy: string;
  amount: number;
  note: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (!(input.amount > 0))
    return { ok: false, error: "Settlement amount must be greater than zero." };

  let ownerEmail: string | null = null;
  let groupId: string | null = null;
  if (input.ctx === "personal") {
    ownerEmail = email;
  } else {
    if (!(await isGroupMember(input.ctx, email)))
      return { ok: false, error: "You are not a member of this group." };
    groupId = input.ctx;
  }

  await createSettlement({
    month: input.month,
    settledBy: input.settledBy,
    amount: input.amount,
    note: input.note.trim() || null,
    ownerEmail,
    groupId,
  });
  revalidatePath("/settlement");
  return { ok: true };
}
