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
import { BANK_LABEL, fileStatementShell, saveCardStatement, validateSaveInput, type SaveStatementInput } from "@/lib/cards";
import type { Bank } from "@/lib/statements/types";
import { recordPendingGst, saveLineage, validateLineage } from "@/lib/loans";
import type { LineagePayload } from "@/lib/statements/lineage";

export interface ImportRow {
  date: string;
  item: string;
  amount: number;
  category: string;
  /**
   * For a lone GST charge citing a reference not on record: the keyed hash
   * of that reference, so the charge can be traced once the statement that
   * billed the instalment is uploaded. Null or absent otherwise.
   */
  untracedRefKey?: string | null;
}

const MAX_ROWS = 500;
const REF_KEY = /^r_[A-Za-z0-9_-]{16,64}$/;

/**
 * Adds rows parsed from a card statement as expenses paid by the signed-in
 * user and split equally. Only what the client sends is stored: a date, a
 * description with card numbers and references already removed, an amount
 * and a category.
 */
export async function importStatementAction(input: {
  ctx: string;
  rows: ImportRow[];
  /** The statement's summary, filed under the user's card in the same go. */
  summary?: SaveStatementInput;
  /**
   * Which card and month the rows come from, so they are listed under the
   * statement even when the file carried no summary box (ICICI's CSV).
   */
  card?: { bank: Bank; last4: string; product: string | null; period: string };
  /** EMI instalments billed here, and GST charges traced to earlier ones. */
  lineage?: LineagePayload;
}): Promise<{ ok: true; count: number; summarySaved: boolean } | { ok: false; error: string }> {
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
    const untracedRefKey = r.untracedRefKey ?? null;
    if (untracedRefKey !== null && (typeof untracedRefKey !== "string" || !REF_KEY.test(untracedRefKey)))
      return { ok: false, error: `Malformed reference key on "${item}".` };
    rows.push({ date: r.date, item, amount: r.amount, category: cleanText(String(r.category ?? ""), 50), untracedRefKey });
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

  // The statement the rows belong to, filed first so each row can point at it.
  let summarySaved = false;
  let cardId: string | null = null;
  let statementId: number | null = null;
  if (input.summary && !validateSaveInput(input.summary)) {
    ({ cardId, statementId } = await saveCardStatement(email, input.summary));
    summarySaved = true;
  } else if (input.card && /^\d{4}$/.test(input.card.last4) && /^\d{4}-\d{2}$/.test(input.card.period) && input.card.bank in BANK_LABEL) {
    ({ cardId, statementId } = await fileStatementShell(email, {
      bank: input.card.bank,
      last4: input.card.last4,
      product: typeof input.card.product === "string" ? input.card.product : null,
      period: input.card.period,
    }));
  }

  const period = input.summary?.period ?? input.card?.period ?? input.lineage?.instalments[0]?.period ?? null;
  const createdIds: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const created = await createExpense({
      date: rows[i].date,
      category: categories[i],
      item: rows[i].item,
      amount: rows[i].amount,
      payer: email,
      split: SPLIT_EQUAL,
      shares: null,
      ownerEmail,
      groupId,
      statementId,
    });
    createdIds.push(created.id);
    if (rows[i].untracedRefKey) {
      await recordPendingGst(email, {
        expenseId: created.id,
        refKey: rows[i].untracedRefKey!,
        amount: rows[i].amount,
        date: rows[i].date,
        period: period && /^\d{4}-\d{2}$/.test(period) ? period : rows[i].date.slice(0, 7),
      });
    }
  }

  if (groupId) {
    try {
      const actor = await prisma.appUser.findUnique({ where: { email } });
      await notifyGroup({
        groupId,
        actorEmail: email,
        type: "expense_added",
        message: `${displayNameFor(actor, "A member")} added ${rows.length} expense${rows.length === 1 ? "" : "s"} from a card statement`,
        target: { kind: "expenses", ids: createdIds },
      });
    } catch {
      // Notifications are best-effort.
    }
  }

  if (input.lineage && !validateLineage(input.lineage)) await saveLineage(email, cardId, input.lineage);

  revalidatePath("/", "layout");
  return { ok: true, count: rows.length, summarySaved };
}
