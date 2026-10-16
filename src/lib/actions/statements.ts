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
import { findImportDuplicates, importKeyFor, type CardRef, type DuplicateView } from "@/lib/statementDuplicates";
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
  /** Which time this exact row appears in the statement, from 1. */
  occurrence?: number;
  /**
   * Overwrite this expense (an earlier import of the same row) instead of
   * adding a new one. It stays where it is, Personal or its group.
   */
  replaceId?: number | null;
}

const MAX_ROWS = 500;

type CleanRow = Required<Pick<ImportRow, "date" | "item" | "amount" | "category">> & {
  untracedRefKey: string | null;
  occurrence: number;
  replaceId: number | null;
};

/** Validates and cleans the rows the browser sent; an error string on the first bad one. */
function cleanRows(input: ImportRow[]): CleanRow[] | string {
  if (!Array.isArray(input) || input.length === 0) return "Nothing selected.";
  if (input.length > MAX_ROWS) return `At most ${MAX_ROWS} rows at a time.`;
  const rows: CleanRow[] = [];
  for (const r of input) {
    const item = cleanText(String(r.item ?? ""), 200);
    if (!item) return "A row has no description.";
    if (!isValidDateISO(r.date)) return `Invalid date on "${item}".`;
    if (!isValidAmount(r.amount)) return `Invalid amount on "${item}".`;
    const untracedRefKey = r.untracedRefKey ?? null;
    if (untracedRefKey !== null && (typeof untracedRefKey !== "string" || !REF_KEY.test(untracedRefKey)))
      return `Malformed reference key on "${item}".`;
    const occurrence = r.occurrence ?? 1;
    if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > MAX_ROWS) return `Invalid row position on "${item}".`;
    const replaceId = r.replaceId ?? null;
    if (replaceId !== null && !Number.isInteger(replaceId)) return `Invalid expense to replace on "${item}".`;
    rows.push({ date: r.date, item, amount: r.amount, category: cleanText(String(r.category ?? ""), 50), untracedRefKey, occurrence, replaceId });
  }
  return rows;
}

/** The card a batch comes from, for its import keys. */
function cardOf(input: { summary?: SaveStatementInput; card?: { bank: Bank; last4: string } }): CardRef | null {
  const c = input.summary ?? input.card;
  return c && c.bank in BANK_LABEL && /^\d{4}$/.test(c.last4) ? { bank: c.bank, last4: c.last4 } : null;
}

/**
 * Before adding: which of these rows are already expenses (from an earlier
 * read of this statement, as another file type, or added by hand with the
 * same description), looked for in Personal and every group you are in.
 */
export async function checkStatementDuplicatesAction(input: {
  rows: ImportRow[];
  summary?: SaveStatementInput;
  card?: { bank: Bank; last4: string };
}): Promise<{ ok: true; duplicates: DuplicateView[] } | { ok: false; error: string }> {
  if (!statementsEnabled()) return { ok: false, error: "Statement import is not enabled." };
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  const rows = cleanRows(input.rows);
  if (typeof rows === "string") return { ok: false, error: rows };
  return { ok: true, duplicates: await findImportDuplicates(email, cardOf(input), rows) };
}
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
}): Promise<
  { ok: true; count: number; replaced: number; skipped: number; summarySaved: boolean } | { ok: false; error: string }
> {
  if (!statementsEnabled()) return { ok: false, error: "Statement import is not enabled." };
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  const cleaned = cleanRows(input.rows);
  if (typeof cleaned === "string") return { ok: false, error: cleaned };
  const card = cardOf(input);
  const keys = cleaned.map((r) => importKeyFor(email, card, r));

  // Never two copies of the same statement row: a new row whose exact twin
  // is already on record is skipped, even if the browser did not ask first.
  const fresh = cleaned.map((r, i) => ({ r, i })).filter(({ r }) => r.replaceId === null);
  const twins = new Set(
    (await findImportDuplicates(email, card, fresh.map(({ r }) => r)))
      .filter((d) => d.how === "exact")
      .map((d) => fresh[d.index].i),
  );
  const skipped = twins.size;

  // Rows to overwrite must be expenses you may edit: your Personal ones,
  // or ones in a group you are in.
  const replaceIds = cleaned.flatMap((r) => (r.replaceId === null ? [] : [r.replaceId]));
  const replaceable = new Map(
    (
      await prisma.expense.findMany({
        where: { id: { in: replaceIds } },
        select: { id: true, ownerEmail: true, groupId: true, gstPending: { where: { resolvedAt: { not: null } }, select: { id: true } } },
      })
    ).map((e) => [e.id, e]),
  );
  const myGroups = new Set((await prisma.groupMember.findMany({ where: { email }, select: { groupId: true } })).map((m) => m.groupId));
  for (const id of replaceIds) {
    const e = replaceable.get(id);
    if (!e || !((e.ownerEmail === email && !e.groupId) || (e.groupId && !e.ownerEmail && myGroups.has(e.groupId))))
      return { ok: false, error: "One of the expenses to replace is not yours to change." };
  }

  const rows = cleaned.filter((_, i) => !twins.has(i));
  const rowKeys = keys.filter((_, i) => !twins.has(i));
  if (rows.length === 0) return { ok: true, count: 0, replaced: 0, skipped, summarySaved: false };

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
  // A replaced expense keeps its place, so its category is spelled the way
  // its own Personal or group list spells it.
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i].replaceId !== null ? replaceable.get(rows[i].replaceId!) : null;
    if (e && (e.groupId ?? null) !== groupId) {
      [categories[i]] = await canonicalCategoriesFor(e.groupId ? { kind: "group", groupId: e.groupId } : { kind: "personal", email }, [rows[i].category]);
    }
  }

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
  // Group id (null for Personal) to the ids overwritten there.
  const replacedIn = new Map<string | null, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const old = rows[i].replaceId !== null ? replaceable.get(rows[i].replaceId!)! : null;
    let id: number;
    if (old) {
      // Overwrite the earlier import with this read of the row. Its payer
      // and split stay; a name a traced GST charge was given stays too.
      await prisma.expense.update({
        where: { id: old.id },
        data: {
          date: new Date(`${rows[i].date}T00:00:00.000Z`),
          amount: rows[i].amount,
          category: categories[i],
          ...(old.gstPending.length > 0 ? {} : { item: rows[i].item }),
          statementId,
          importKey: rowKeys[i],
        },
      });
      await prisma.gstPending.deleteMany({ where: { expenseId: old.id, resolvedAt: null } });
      id = old.id;
      replacedIn.set(old.groupId, [...(replacedIn.get(old.groupId) ?? []), id]);
    } else {
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
        importKey: rowKeys[i],
      });
      id = created.id;
      createdIds.push(id);
    }
    if (rows[i].untracedRefKey && !(old && old.gstPending.length > 0)) {
      await recordPendingGst(email, {
        expenseId: id,
        refKey: rows[i].untracedRefKey!,
        amount: rows[i].amount,
        date: rows[i].date,
        period: period && /^\d{4}-\d{2}$/.test(period) ? period : rows[i].date.slice(0, 7),
      });
    }
  }

  try {
    const actor = await prisma.appUser.findUnique({ where: { email } });
    const who = displayNameFor(actor, "A member");
    if (groupId && createdIds.length > 0) {
      await notifyGroup({
        groupId,
        actorEmail: email,
        type: "expense_added",
        message: `${who} added ${createdIds.length} expense${createdIds.length === 1 ? "" : "s"} from a card statement`,
        target: { kind: "expenses", ids: createdIds },
      });
    }
    for (const [g, ids] of replacedIn) {
      if (!g) continue;
      await notifyGroup({
        groupId: g,
        actorEmail: email,
        type: "expense_updated",
        message: `${who} updated ${ids.length} expense${ids.length === 1 ? "" : "s"} from a card statement read again`,
        target: { kind: "expenses", ids },
      });
    }
  } catch {
    // Notifications are best-effort.
  }

  if (input.lineage && !validateLineage(input.lineage)) await saveLineage(email, cardId, input.lineage);

  revalidatePath("/", "layout");
  const replaced = rows.length - createdIds.length;
  return { ok: true, count: createdIds.length, replaced, skipped, summarySaved };
}
