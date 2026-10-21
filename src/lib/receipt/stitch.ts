// Screenshots of one long order, put back together. A long order list is
// screenshotted in parts as the user scrolls, uploaded in any order. Each
// part repeats the status bar and the app's sticky header and footer, and
// parts that overlap repeat some rows, the edge ones often cut in half. This
// orders the parts (by the rows they share, else by which one holds the top
// of the order and which the bill total), keeps each shared row once, drops
// the cut rows at the edges, and keeps the header and footer once. Pure, so
// it is unit-tested.

import { screenCue } from "./orderBill";

/** A rebuilt row of one screenshot; `y` is its top as a share of the height. */
export interface ShotRow {
  text: string;
  y: number;
}

/** Where two screenshots meet in the stitched order; `overlap` rows shared, 0 when none was found. */
export interface Join {
  from: number;
  to: number;
  overlap: number;
}

export interface Stitched {
  /** The screenshots in reading order, by their index in the upload. */
  order: number[];
  joins: Join[];
  /** Screenshots that repeat another one entirely, left out. */
  duplicates: number[];
  /** The order's rows, as one text. */
  text: string;
}

// The phone's status bar: clock, signal, battery.
const STATUS_BAR = 0.05;
// Sticky headers and footers sit at the edges, at the same height on every part.
const EDGE_TOP = 0.2;
const EDGE_BOTTOM = 0.85;
const SAME_PLACE = 0.015;
// Rows at the very edge of a part may be cut and read differently.
const SLACK = 2;

const key = (t: string) =>
  t
    .toLowerCase()
    .replace(/₹/g, "")
    .replace(/[^a-z0-9]+/g, "");

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** One row cut at a screenshot's edge and read whole on the next: a looser match. */
function cutCopy(cutText: string, wholeText: string): boolean {
  // Names only: pack sizes ("1x500g", "1x400g") differ by a digit between items.
  if (!named(cutText) || !named(wholeText)) return false;
  const cut = key(cutText);
  const whole = key(wholeText);
  let common = 0;
  while (common < cut.length && cut[common] === whole[common]) common++;
  if (common >= Math.max(5, 0.6 * Math.min(cut.length, whole.length))) return true;
  return Math.min(cut.length, whole.length) >= 8 && distance(cut, whole) <= Math.floor(Math.max(cut.length, whole.length) * 0.25);
}

/** The same row read twice: OCR may differ by a letter or two between screenshots. */
function same(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.max(a.length, b.length);
  return Math.min(a.length, b.length) >= 6 && distance(a, b) <= Math.floor(n * 0.15);
}

interface Part {
  index: number;
  rows: ShotRow[];
  /** Rows that are the order itself, not status bar, header or footer. */
  body: string[];
  keys: string[];
  top: string[];
  bottom: string[];
  cue: "top" | "end" | null;
}

/** Rows the order runs through: shared (at the same height) by every part. */
function isChrome(row: ShotRow, others: ShotRow[][]): boolean {
  if (row.y >= EDGE_TOP && row.y <= EDGE_BOTTOM) return false;
  const k = key(row.text);
  return k.length > 0 && others.every((rows) => rows.some((o) => Math.abs(o.y - row.y) <= SAME_PLACE && same(key(o.text), k)));
}

interface Overlap {
  rows: number;
  /** First and last shared row of the upper part, and of the lower one. */
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

// Words on pack-size and price rows that every item repeats.
const COMMON = /\b(?:x|g|gm|gms|kg|ml|l|ltr|pcs?|packs?|units?|deducted|refunded|saved|off|free|mrp)\b/g;
/** A row with a name in it, not a pack size or price note ("1.1 X 150 g ₹3.08 deducted"). */
const named = (text: string) => /[a-z]{3,}/.test(text.toLowerCase().replace(COMMON, " "));

/**
 * Where the bottom of part a runs into the top of part b: the longest run of
 * rows read the same in both, ending near a's bottom and starting near b's
 * top (a row or two at either edge may be cut), with at least one row that
 * is distinct (not "1 X 1 kg", which several items share). One row read
 * differently inside the run is allowed.
 */
function overlap(a: Part, b: Part): Overlap | null {
  const count = (keys: string[], k: string) => keys.filter((x) => x === k).length;
  let best: Overlap | null = null;
  for (let i = 0; i < a.keys.length; i++) {
    for (let j = 0; j <= Math.min(SLACK, b.keys.length - 1); j++) {
      let k = 0;
      let misses = 0;
      let distinct = 0;
      let last = -1;
      let matched = 0;
      while (i + k < a.keys.length && j + k < b.keys.length) {
        if (same(a.keys[i + k], b.keys[j + k])) {
          last = k;
          matched++;
          if (named(a.body[i + k]) && count(a.keys, a.keys[i + k]) === 1 && count(b.keys, b.keys[j + k]) === 1) distinct++;
        } else if (k === 0 || ++misses > 1) break; // a run starts on a match
        k++;
      }
      if (last < 0 || distinct === 0) continue;
      const aEnd = i + last;
      if (aEnd < a.keys.length - 1 - SLACK) continue;
      if (!best || matched > best.rows) best = { rows: matched, aStart: i, aEnd, bStart: j, bEnd: j + last };
    }
  }
  return best;
}

/**
 * Puts the screenshots of one order back together. `taken` is when each was
 * taken (the file's time), the tie-break for parts nothing else orders:
 * people screenshot a long page top to bottom.
 */
export function stitch(shots: ShotRow[][], taken?: number[]): Stitched {
  if (shots.length <= 1) return { order: shots.length ? [0] : [], joins: [], duplicates: [], text: (shots[0] ?? []).map((r) => r.text).join("\n") };

  // The same screenshot uploaded twice: nearly every row at the same height.
  const duplicates: number[] = [];
  const kept: number[] = [];
  for (let i = 0; i < shots.length; i++) {
    const rows = shots[i].filter((r) => r.y >= STATUS_BAR && key(r.text));
    const covered = (mine: ShotRow[], theirs: ShotRow[]) =>
      mine.filter((r) => theirs.some((o) => Math.abs(o.y - r.y) <= SAME_PLACE && same(key(o.text), key(r.text)))).length >= 0.9 * mine.length;
    const twin = kept.find((j) => {
      const other = shots[j].filter((r) => r.y >= STATUS_BAR && key(r.text));
      return rows.length > 0 && covered(rows, other) && covered(other, rows);
    });
    if (twin !== undefined) duplicates.push(i);
    else kept.push(i);
  }

  const parts: Part[] = kept.map((index) => {
    const rows = shots[index].filter((r) => r.y >= STATUS_BAR);
    const others = kept.filter((j) => j !== index).map((j) => shots[j]);
    const chrome = rows.map((r) => others.length > 0 && isChrome(r, others));
    const body = rows.filter((r, n) => !chrome[n] && key(r.text).length >= 2).map((r) => r.text);
    return {
      index,
      rows,
      body,
      keys: body.map(key),
      top: rows.filter((r, n) => chrome[n] && r.y < 0.5).map((r) => r.text),
      bottom: rows.filter((r, n) => chrome[n] && r.y >= 0.5).map((r) => r.text),
      cue: screenCue(body),
    };
  });

  const n = parts.length;
  const ov = parts.map((a) => parts.map((b) => (a === b ? null : overlap(a, b))));
  // Parts that must touch: shared rows, or (weaker) the row cut at the
  // bottom of one being the first row of the other.
  const touch = (a: Part, b: Part) => a.body.length > 0 && b.body.length > 0 && cutCopy(a.body[a.body.length - 1], b.body[0]);
  const links: { a: number; b: number; w: number }[] = [];
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const w = ov[a][b] ? 1000 + ov[a][b]!.rows : touch(parts[a], parts[b]) ? 1 : 0;
      if (w) links.push({ a, b, w });
    }
  links.sort((x, y) => y.w - x.w);
  const next = new Array<number>(n).fill(-1);
  const prev = new Array<number>(n).fill(-1);
  const head = (k: number) => {
    while (prev[k] !== -1) k = prev[k];
    return k;
  };
  for (const { a, b } of links) if (next[a] === -1 && prev[b] === -1 && head(a) !== b) (next[a] = b), (prev[b] = a);

  // Chains of linked parts: the one holding the top of the order first, the
  // one with the bill total last, the rest by when they were taken.
  const when = (k: number) => taken?.[parts[k].index] ?? parts[k].index;
  const chains = parts
    .map((_, k) => k)
    .filter((k) => prev[k] === -1)
    .map((k) => {
      const chain = [k];
      while (next[chain[chain.length - 1]] !== -1) chain.push(next[chain[chain.length - 1]]);
      return chain;
    });
  const place = (c: number[]) => (c.some((k) => parts[k].cue === "top") ? 0 : c.some((k) => parts[k].cue === "end") ? 2 : 1);
  chains.sort((x, y) => place(x) - place(y) || Math.min(...x.map(when)) - Math.min(...y.map(when)));
  const order = chains.flat();

  const rows = [...parts[order[0]].body];
  const joins: Join[] = [];
  for (let t = 1; t < n; t++) {
    const a = parts[order[t - 1]];
    const b = parts[order[t]];
    const o = ov[order[t - 1]][order[t]];
    if (o) {
      // Shared rows once, each as read more fully: a row at the edge of a
      // screenshot can be cut ("Eggs ₹7" for "Eggs ₹70").
      const base = rows.length - a.body.length;
      for (let k = 0; k < o.rows; k++) {
        const at = base + o.aStart + k;
        const other = b.body[o.bStart + k];
        if (at >= 0 && other && same(key(rows[at]), key(other)) && key(other).length > key(rows[at]).length) rows[at] = other;
      }
      rows.splice(rows.length - (a.body.length - 1 - o.aEnd)); // a's cut bottom rows
      rows.push(...b.body.slice(o.bEnd + 1));
    } else {
      // No rows shared, but the row at the bottom edge of one may be the
      // first of the next, cut so badly it reads differently: keep it once,
      // as read in full.
      const last = rows.length - 1;
      const first = last >= 0 && b.body.length > 0 && cutCopy(rows[last], b.body[0]) ? 0 : -1;
      if (first !== -1) {
        if (key(b.body[first]).length >= key(rows[last]).length) rows[last] = b.body[first];
        rows.push(...b.body.slice(first + 1));
      } else rows.push(...b.body);
    }
    joins.push({ from: a.index, to: b.index, overlap: o?.rows ?? 0 });
  }
  const text = [...parts[order[0]].top, ...rows, ...parts[order[n - 1]].bottom].join("\n");
  return { order: order.map((k) => parts[k].index), joins, duplicates, text };
}
