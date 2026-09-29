"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** Reading pace of the slide, in pixels a second. */
const PACE = 55;

/**
 * A name on one line that never widens its container. When it does not fit,
 * its end fades out, and hovering or keyboard-focusing the nearest
 * `.slide-trigger` ancestor slides it along so the whole name can be read,
 * holding at each end (globals.css, .slide-name). The full name is also the
 * tooltip. Nothing moves until asked: a name that slid on its own in a
 * sidebar seen all day would pull the eye every time.
 */
export function SlidingName({ text, className = "" }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (!b || !i) return;
    const measure = () => setShift(Math.max(0, Math.ceil(i.offsetWidth - b.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    return () => ro.disconnect();
  }, [text]);

  const over = shift > 1;
  // A little past the end, so the last letter clears the right-hand fade.
  const distance = shift + 14;
  const style = over
    ? ({
        "--slide-shift": `-${distance}px`,
        // The move takes 76% of each pass; the rest is the hold at the ends.
        "--slide-time": `${Math.max(1.6, distance / PACE / 0.76).toFixed(2)}s`,
      } as CSSProperties)
    : undefined;

  return (
    <span ref={box} className={`slide-name ${className}`} data-overflow={over || undefined} style={style} title={over ? text : undefined}>
      <span ref={inner} className="slide-name-text">
        {text}
      </span>
    </span>
  );
}
