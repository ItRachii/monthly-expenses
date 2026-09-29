"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Shown instead of the label on phones, when the full label would not fit. */
  shortLabel?: ReactNode;
  /** A count shown in a small pill next to the label. */
  count?: number;
}

/**
 * Underlined tabs with an indicator that slides to the active tab. Not a
 * scroll container: the tabs are sized to fit, so no scrollbar can appear.
 * The underline sits on the parent's bottom border, so give the parent
 * `border-b` and align the tabs to its bottom edge.
 *
 * On phones the tabs share the row as equal segments, with tighter type;
 * below 360px the count pills hide rather than push the tabs off the card.
 *
 * Keyboard: Left and Right move between tabs, Home and End jump to the ends.
 * The focus ring shows for keyboard focus only, never after a click.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className = "",
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** What the tabs switch between, for screen readers. */
  label: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  // The underline appears in place on first paint and only slides after that.
  const [animate, setAnimate] = useState(false);
  const shape = tabs.map((t) => `${t.id}:${t.count ?? ""}`).join("|");

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const el = list.querySelector<HTMLElement>(`[data-tab="${CSS.escape(value)}"]`);
      if (!el) return;
      const next = { left: el.offsetLeft, width: el.offsetWidth };
      setBar((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
    };
    measure();
    const frame = requestAnimationFrame(() => setAnimate(true));
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [value, shape]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((t) => t.id === value);
    const to =
      e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(tabs[to].id);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(tabs[to].id)}"]`)?.focus();
  }

  return (
    <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`relative flex min-w-0 gap-1 max-sm:w-full ${className}`}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`relative inline-flex items-center gap-2 whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/70 max-sm:min-w-0 max-sm:flex-1 max-sm:justify-center max-sm:gap-1.5 max-sm:px-1.5 max-sm:text-[13px] ${
              active ? "font-semibold text-ink" : "text-muted hover:bg-white/[0.04] hover:text-ink"
            } ${active && !bar ? "shadow-[inset_0_-2px_0_theme(colors.primary)]" : ""}`}
          >
            {t.shortLabel ? (
              <>
                <span className="sm:hidden">{t.shortLabel}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </>
            ) : (
              t.label
            )}
            {t.count !== undefined ? (
              <span
                className={`inline-flex min-w-[1.375rem] justify-center rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums transition-colors duration-200 max-sm:min-w-[1.125rem] max-sm:px-1 max-sm:text-[10px] max-[359px]:hidden ${
                  active ? "bg-primary/20 text-ink" : "bg-white/[0.06] text-muted"
                }`}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
      {/* The underline slides from tab to tab; before the first measure the
          active tab draws its own, so nothing jumps on first paint. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute -bottom-px left-0 h-0.5 rounded-full bg-primary ${
          animate ? "transition-[transform,width] duration-200 ease-out motion-reduce:transition-none" : ""
        }`}
        style={bar ? { width: bar.width, transform: `translateX(${bar.left}px)` } : { width: 0, opacity: 0 }}
      />
    </div>
  );
}
