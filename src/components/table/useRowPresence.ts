"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

// Motion for filtered lists: rows a filter drops fade out before they go,
// and rows that arrive come in a beat apart. The filter's own test stays the
// truth for counts, totals and selection; only what is drawn lags it, for
// EXIT_MS.

const EXIT_MS = 150;
/** Gap between arriving rows, and how many rows get a later start. */
const STAGGER_MS = 30;
const STAGGER_CAP = 12;
const NONE: ReadonlySet<number> = new Set();

type Test<T> = (row: T) => boolean;

/**
 * Wraps a list filter. Returns the test to draw rows with (the filter, plus
 * rows it just dropped, for EXIT_MS) and the ids of those leaving rows.
 */
export function useRowPresence<T extends { id: number }>(rows: T[], matches: Test<T>) {
  const [last, setLast] = useState<{ test: Test<T> }>({ test: matches });
  const [leaving, setLeaving] = useState<{ ids: ReadonlySet<number> }>({ ids: NONE });

  // A new filter: work out who it drops while rendering, so they never blink
  // out for a frame before the fade starts.
  if (last.test !== matches) {
    const ids = new Set(rows.filter((r) => last.test(r) && !matches(r)).map((r) => r.id));
    setLast({ test: matches });
    setLeaving({ ids: ids.size ? ids : NONE });
  }

  useEffect(() => {
    if (leaving.ids === NONE) return;
    const timer = window.setTimeout(() => setLeaving({ ids: NONE }), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const ids = leaving.ids;
  const draw = useMemo<Test<T>>(() => (ids === NONE ? matches : (r) => matches(r) || ids.has(r.id)), [matches, ids]);
  return { draw, leaving: ids };
}

export type RowMotion = ReturnType<typeof rowMotion>;

/** The class and delay for a list row: it arrives `index` beats late, or fades out. */
export function rowMotion(index: number, leaving: boolean): { className: string; style: CSSProperties } {
  return {
    className: leaving ? "row-enter row-out" : "row-enter",
    style: { "--enter-delay": `${Math.min(index, STAGGER_CAP) * STAGGER_MS}ms` } as CSSProperties,
  };
}
