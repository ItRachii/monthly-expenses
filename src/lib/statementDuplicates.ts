// Server side of "this statement row is already an expense": the row's
// import key, and the expenses an import would repeat, looked for in
// Personal and in every group the importer is in (the same card spend
// added to two places is still counted twice).

import { createHmac } from "crypto";
import { prisma } from "./prisma";
import { formatDate } from "./format";
import { piiSecret } from "./piiCrypto";
import { matchDuplicates, normalizeItem, type MatchHow } from "./statements/duplicates";

export interface CardRef {
  bank: string;
  last4: string;
}

export interface KeyedRow {
  date: string;
  amount: number;
  /** The cleaned description, exactly as it would be stored. */
  item: string;
  /** Which time this exact row appears in the statement, from 1. */
  occurrence: number;
}

/**
 * The row's import key: a keyed hash of who imported it, the card, the
 * day, the amount, the description and its occurrence. The same row of the
 * same statement always gets the same key; nothing readable is kept.
 */
export function importKeyFor(email: string, card: CardRef | null, row: KeyedRow): string {
  const msg = [
    "import-v1",
    email,
    card ? `${card.bank}:${card.last4}` : "-",
    row.date,
    Math.round(row.amount * 100),
    normalizeItem(row.item),
    row.occurrence,
  ].join("\n");
  return "i_" + createHmac("sha256", piiSecret()).update(msg).digest("base64url").slice(0, 32);
}

/** A batch row that repeats an expense on record, and where that expense is. */
export interface DuplicateView {
  index: number;
  how: MatchHow;
  existing: {
    id: number;
    date: string;
    item: string;
    amount: number;
    /** Null for Personal. */
    group: { id: string; name: string } | null;
  };
}

/** The expenses on record that rows of this batch repeat, one per row at most. */
export async function findImportDuplicates(email: string, card: CardRef | null, rows: KeyedRow[]): Promise<DuplicateView[]> {
  if (rows.length === 0) return [];
  const keys = rows.map((r) => importKeyFor(email, card, r));
  const dates = Array.from(new Set(rows.map((r) => r.date))).map((d) => new Date(`${d}T00:00:00.000Z`));
  const groupIds = (await prisma.groupMember.findMany({ where: { email }, select: { groupId: true } })).map((m) => m.groupId);
  const cardRow = card
    ? await prisma.card.findFirst({ where: { ownerEmail: email, bank: card.bank, last4: card.last4 }, select: { id: true } })
    : null;

  const candidates = await prisma.expense.findMany({
    where: {
      AND: [
        { OR: [{ ownerEmail: email, groupId: null }, ...(groupIds.length ? [{ groupId: { in: groupIds } }] : [])] },
        { OR: [{ importKey: { in: keys } }, { date: { in: dates } }] },
      ],
    },
    select: {
      id: true,
      date: true,
      item: true,
      amount: true,
      importKey: true,
      group: { select: { id: true, name: true } },
      statement: { select: { cardId: true } },
    },
    orderBy: { id: "asc" },
  });

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const matches = matchDuplicates(
    rows.map((r, index) => ({ index, date: r.date, amount: r.amount, item: r.item, key: keys[index] })),
    candidates.map((c) => ({
      id: c.id,
      date: formatDate(c.date),
      amount: c.amount,
      item: c.item,
      importKey: c.importKey,
      cardId: c.statement?.cardId ?? null,
    })),
    cardRow?.id ?? null,
  );

  return Array.from(matches.entries())
    .sort(([a], [b]) => a - b)
    .map(([index, m]) => {
      const e = byId.get(m.id)!;
      return { index, how: m.how, existing: { id: e.id, date: formatDate(e.date), item: e.item, amount: e.amount, group: e.group } };
    });
}
