"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canonicalCategoriesFor, createExpense } from "@/lib/expenses";
import { isGroupMember } from "@/lib/groups";
import { notifyGroup } from "@/lib/notifications";
import { displayNameFor } from "@/lib/users";
import { SPLIT_EQUAL } from "@/lib/constants";
import { cleanText, isValidAmount, isValidDateISO } from "@/lib/validate";
import { statementsEnabled } from "@/lib/features";

export interface ImportRow {
  date: string;
  item: string;
  amount: number;
  category: string;
}

const MAX_ROWS = 500;

/**
 * Adds rows parsed from a card statement as expenses paid by the signed-in
 * user and split equally. Only what the client sends is stored: a date, a
 * description with card numbers and references already removed, an amount
 * and a category.
 */
export async function importStatementAction(input: {
  ctx: string;
  rows: ImportRow[];
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (!statementsEnabled()) return { ok: false, error: "Statement import is not enabled." };
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  if (!Array.isArray(input.rows) || input.rows.length === 0)
    return { ok: false, error: "Nothing selected." };
  if (input.rows.length > MAX_ROWS) return { ok: false, error: `At most ${MAX_ROWS} rows at a time.` };

  const rows: ImportRow[] = [];
  for (const r of input.rows) {
    const item = cleanText(String(r.item ?? ""), 200);
    if (!item) return { ok: false, error: "A row has no description." };
    if (!isValidDateISO(r.date)) return { ok: false, error: `Invalid date on "${item}".` };
    if (!isValidAmount(r.amount)) return { ok: false, error: `Invalid amount on "${item}".` };
    rows.push({ date: r.date, item, amount: r.amount, category: cleanText(String(r.category ?? ""), 50) });
  }

  let ownerEmail: string | null = null;
  let groupId: string | null = null;
  if (input.ctx === "personal") {
    ownerEmail = email;
  } else {
    if (!(await isGroupMember(input.ctx, email)))
      return { ok: false, error: "You are not a member of this group." };
    groupId = input.ctx;
  }

  const categories = await canonicalCategoriesFor(
    groupId ? { kind: "group", groupId } : { kind: "personal", email },
    rows.map((r) => r.category),
  );

  for (let i = 0; i < rows.length; i++) {
    await createExpense({
      date: rows[i].date,
      category: categories[i],
      item: rows[i].item,
      amount: rows[i].amount,
      payer: email,
      split: SPLIT_EQUAL,
      ownerEmail,
      groupId,
    });
  }

  if (groupId) {
    try {
      const actor = await prisma.appUser.findUnique({ where: { email } });
      await notifyGroup({
        groupId,
        actorEmail: email,
        type: "expense_added",
        message: `${displayNameFor(actor, "A member")} added ${rows.length} expense${rows.length === 1 ? "" : "s"} from a card statement`,
      });
    } catch {
      // Notifications are best-effort.
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, count: rows.length };
}
