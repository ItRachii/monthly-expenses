// Finding statement rows that are already expenses, so reading the same
// statement twice never adds the same spend twice. Pure: the server
// gathers the candidates, this decides which row matches which expense.

/** A statement row on its way in. */
export interface IncomingRow {
  /** Its position in the batch, so the caller can map matches back. */
  index: number;
  date: string;
  amount: number;
  item: string;
  /** Its import key: the same row of the same statement always gets the same one. */
  key: string;
}

/** An expense already on record, anywhere the importer can see. */
export interface ExistingExpense {
  id: number;
  date: string;
  amount: number;
  item: string;
  /** Set on expenses imported since keys existed; null on older and hand-entered ones. */
  importKey: string | null;
  /** The card of the statement it was imported from, when it is linked to one. */
  cardId: string | null;
}

/**
 * - exact: the same row of the same statement (same import key);
 * - likely: same day and amount, and the same description or the same card
 *   (a statement read before keys existed, or as a different file type).
 */
export type MatchHow = "exact" | "likely";

/** Lower case, letters and digits only: "SWIGGY  Bangalore." and "swiggy bangalore" match. */
export function normalizeItem(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const cents = (n: number) => Math.round(n * 100);

/**
 * Whether two descriptions read the same, for a likely match. Letters of
 * any script count here ("चाय" is not "दूध", though normalizeItem makes
 * both empty), and an empty description matches nothing. Import keys keep
 * normalizeItem, so rows imported before still key the same.
 */
function sameItem(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const x = norm(a);
  return x !== "" && x === norm(b);
}

/**
 * Which time this exact row (same day, amount and description) appears in
 * the statement, from 1. Two identical coffees on one day are two rows,
 * not a duplicate, and keep apart on every re-read.
 */
export function occurrences(rows: { date: string; total: number; description: string }[]): number[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = `${r.date}|${cents(r.total)}|${normalizeItem(r.description)}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n;
  });
}

/**
 * Pairs incoming rows with the expenses they repeat, one to one: exact key
 * matches first, then likely ones. Returns incoming index to match.
 */
export function matchDuplicates(
  incoming: IncomingRow[],
  existing: ExistingExpense[],
  cardId: string | null,
): Map<number, { id: number; how: MatchHow }> {
  const out = new Map<number, { id: number; how: MatchHow }>();
  const used = new Set<number>();

  const byKey = new Map<string, ExistingExpense[]>();
  for (const e of existing) {
    if (!e.importKey) continue;
    const list = byKey.get(e.importKey) ?? [];
    list.push(e);
    byKey.set(e.importKey, list);
  }
  for (const r of incoming) {
    const hit = (byKey.get(r.key) ?? []).find((e) => !used.has(e.id));
    if (!hit) continue;
    used.add(hit.id);
    out.set(r.index, { id: hit.id, how: "exact" });
  }

  for (const r of incoming) {
    if (out.has(r.index)) continue;
    const hit = existing.find(
      (e) =>
        !used.has(e.id) &&
        e.date === r.date &&
        cents(e.amount) === cents(r.amount) &&
        (sameItem(r.item, e.item) || (cardId !== null && e.cardId === cardId)),
    );
    if (!hit) continue;
    used.add(hit.id);
    out.set(r.index, { id: hit.id, how: "likely" });
  }
  return out;
}
