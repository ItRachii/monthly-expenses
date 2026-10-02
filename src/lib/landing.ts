// Where opening a notification lands: which expenses to highlight, which
// deleted ones to show crossed out where they used to be, and which month
// to open on. Pure, so the feed and the tests share it.

import type { DeletedExpense, NotificationFocus } from "./notifications";

export const ALL_MONTHS = "all";

export type Landing =
  | {
      kind: "expenses";
      verb: "added" | "edited";
      /** The ids still in the group, to highlight. */
      ids: number[];
      /** How many the notification named that have since been deleted. */
      missing: number;
      /** The month to open on: theirs, All when they span months, null to leave it. */
      month: string | null;
    }
  | {
      kind: "deleted";
      /** What was deleted, shown crossed out where it used to be. */
      ghosts: DeletedExpense[];
      count: number;
      total: number;
      month: string | null;
    };

const monthOf = (iso: string) => iso.slice(0, 7);

function oneMonth(dates: string[]): string | null {
  if (dates.length === 0) return null;
  const months = new Set(dates.map(monthOf));
  return months.size === 1 ? [...months][0] : ALL_MONTHS;
}

/** The landing for an opened notification, against the rows on show now. */
export function landingFor(focus: NotificationFocus | null, rows: { id: number; date: string }[]): Landing | null {
  if (!focus) return null;
  const t = focus.target;
  if (t.kind === "expenses") {
    const dateById = new Map(rows.map((r) => [r.id, r.date]));
    const ids = t.ids.filter((id) => dateById.has(id));
    return {
      kind: "expenses",
      verb: focus.type === "expense_updated" ? "edited" : "added",
      ids,
      missing: t.ids.length - ids.length,
      month: oneMonth(ids.map((id) => dateById.get(id)!)),
    };
  }
  if (t.kind === "deleted") {
    return { kind: "deleted", ghosts: t.items, count: t.count, total: t.total, month: oneMonth(t.items.map((i) => i.date)) };
  }
  return null;
}

export type Placed<T, G> = { row: T; ghost?: undefined } | { ghost: G; row?: undefined };

/**
 * Slots deleted expenses into the list where they would have sat: by date
 * when the list is sorted by date, otherwise at the top.
 */
export function placeGhosts<T extends { date: string }, G extends { date: string }>(
  rows: T[],
  ghosts: G[],
  dateSort: "asc" | "desc" | null,
): Placed<T, G>[] {
  const out: Placed<T, G>[] = rows.map((row) => ({ row }));
  if (ghosts.length === 0) return out;
  if (dateSort === null) return [...ghosts.map((ghost) => ({ ghost })), ...out];
  for (const ghost of ghosts) {
    // After rows of the same day: a deletion is news about that day's list.
    let at = out.findIndex((p) => {
      const d = (p.row ?? p.ghost)!.date;
      return dateSort === "desc" ? d < ghost.date : d > ghost.date;
    });
    if (at === -1) at = out.length;
    out.splice(at, 0, { ghost });
  }
  return out;
}

/** The record a payment notification points at, against the payments on show. */
export function settlementLanding(focus: NotificationFocus | null, ids: number[]): { id: number; month: string; present: boolean } | null {
  if (!focus || focus.target.kind !== "settlement") return null;
  return { id: focus.target.id, month: focus.target.month, present: ids.includes(focus.target.id) };
}
