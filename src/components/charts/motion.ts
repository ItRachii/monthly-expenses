"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

// Motion for the Summary tab: numbers that count to their value and charts
// that draw in, so the figures read as just worked out. The tab mounts on
// every open, so this plays each time it is opened; changing the month
// counts from the old figure to the new one instead of from zero.

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True when the viewer asked for less motion. False while rendering on the server. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/** How long a figure takes to count up. Explanatory motion, so above the 300ms UI budget, but short. */
export const COUNT_MS = 650;
/** Chart entrances, matched to the count so both land together. */
export const DRAW_MS = 800;

// Figures rendered in the first page load keep the server's final text: no
// flash from the real value to 0 during hydration. Anything mounted after
// that (opening the tab) counts up. useSyncExternalStore tells the two
// apart: React reads the server snapshot while hydrating, the client one on
// a fresh mount.
const noSubscribe = () => () => {};
function useMountedAfterLoad(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

/**
 * Tweens a number and hands each frame's value to `apply`, which writes it
 * straight to the DOM: no React render per frame. The element's rendered
 * text is the final value, so without JavaScript, or with reduced motion,
 * it simply shows the figure.
 */
export function useCountUp(value: number, apply: (n: number) => void): void {
  const reduced = useReducedMotion();
  const afterLoad = useMountedAfterLoad();
  const [fromZero] = useState(afterLoad);
  const shown = useRef<number | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Layout effect: the start value is written before the browser paints, so
  // the final figure never flashes first.
  useLayoutEffect(() => {
    const from = shown.current ?? (fromZero ? 0 : value);
    if (reduced || from === value) {
      shown.current = value;
      applyRef.current(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    applyRef.current(from);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      const n = from + (value - from) * easeOutQuart(t);
      shown.current = n;
      applyRef.current(t === 1 ? value : n);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Interrupted (a new month picked mid-count): the next run starts from
    // wherever this one got to.
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, fromZero]);
}
