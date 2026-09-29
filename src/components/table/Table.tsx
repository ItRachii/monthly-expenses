"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, FilterIcon, SearchIcon, SortIcon } from "@/components/Icons";

// Pieces for the list tables (statement review, expenses): filter tabs come
// from Tabs.tsx; these add sortable headers, a search box, status pills and
// the selection checkboxes, styled once so both tables match.

export type SortDir = "asc" | "desc";
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/** Sort state: a new column starts ascending (amounts descending); the same column flips. */
export function useSort<K extends string>(initial: SortState<K>, descFirst: K[] = []) {
  const [sort, setSort] = useState(initial);
  const toggle = (key: K) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: descFirst.includes(key) ? "desc" : "asc" }));
  return [sort, toggle] as const;
}

/** Orders rows by the active column; ties keep their incoming order. */
export function sortRows<T, K extends string>(rows: T[], sort: SortState<K>, value: (row: T, key: K) => string | number): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const x = value(a.row, sort.key);
      const y = value(b.row, sort.key);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: "base" });
      return c * sign || a.i - b.i;
    })
    .map((x) => x.row);
}

export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? SortIcon : sort.dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-3 py-3 font-semibold ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 rounded outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-ink" : ""}`}
      >
        {label}
        <Icon className={`h-4 w-4 ${active ? "text-primary-light" : "text-muted"}`} />
      </button>
    </th>
  );
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

/** Plain column heading, matching SortHeader's spacing. */
export function Th({ children, align = "left", className = "" }: { children?: ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <th scope="col" className={`px-3 py-3 font-semibold ${ALIGN[align]} ${className}`}>
      {children}
    </th>
  );
}

export interface FilterOption {
  value: string;
  label: string;
  /** Shown before the label, e.g. a member's photo. */
  icon?: ReactNode;
}

/**
 * Column heading that filters the table by one of its values. The menu is
 * drawn in a portal at the heading's position, since the table's rounded
 * frame clips anything that overflows it. `value` null means everyone.
 */
export function FilterHeader({
  label,
  allLabel,
  allIcon,
  options,
  value,
  onChange,
  className = "",
}: {
  label: string;
  allLabel: string;
  allIcon?: ReactNode;
  options: FilterOption[];
  value: string | null;
  onChange: (v: string | null) => void;
  className?: string;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const active = value !== null;
  const current = options.find((o) => o.value === value);

  function close(refocus: boolean) {
    setAt(null);
    if (refocus) button.current?.focus();
  }

  useEffect(() => {
    if (!at) return;
    // Focus the ticked item, so arrows move from where the user is.
    menu.current?.querySelector<HTMLElement>("[aria-checked=true]")?.focus();
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close(false);
    };
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [at]);

  function onMenuKey(e: React.KeyboardEvent) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  }

  const pick = (v: string | null) => {
    onChange(v);
    close(true);
  };
  const item = (v: string | null, text: string, icon?: ReactNode) => {
    const on = value === v;
    return (
      <button
        key={v ?? ""}
        type="button"
        role="menuitemradio"
        aria-checked={on}
        onClick={() => pick(v)}
        className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-ink/[0.06] focus-visible:bg-ink/[0.08] ${
          on ? "font-semibold text-ink" : "text-ink/85"
        }`}
      >
        {icon ? (
          <span aria-hidden className="inline-flex shrink-0">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{text}</span>
        <CheckIcon className={`h-4 w-4 shrink-0 text-primary-light ${on ? "" : "invisible"}`} />
      </button>
    );
  };

  return (
    <th scope="col" className={`px-3 py-3 text-left font-semibold ${className}`}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-label={active ? `${label}: ${current?.label ?? ""}. Change filter` : `Filter by ${label.toLowerCase()}`}
        title={active ? `${label}: ${current?.label ?? ""}` : `Filter by ${label.toLowerCase()}`}
        onClick={() => {
          if (at) return close(false);
          const r = button.current!.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom + 4 });
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !at) {
            e.preventDefault();
            const r = button.current!.getBoundingClientRect();
            setAt({ x: r.left, y: r.bottom + 4 });
          }
        }}
        className={`inline-flex items-center gap-1 rounded outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 ${
          active ? "text-ink" : ""
        }`}
      >
        {label}
        <span className="relative">
          <FilterIcon className={`h-4 w-4 ${active ? "text-primary-light" : "text-muted"}`} />
          {active ? <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary-light" aria-hidden /> : null}
        </span>
      </button>
      {at
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={`Filter by ${label.toLowerCase()}`}
              onKeyDown={onMenuKey}
              className="menu-pop card fixed z-50 w-56 space-y-0.5 p-1.5 shadow-xl"
              style={{ left: Math.min(at.x, window.innerWidth - 232), top: at.y }}
            >
              {item(null, allLabel, allIcon)}
              {options.map((o) => item(o.value, o.label, o.icon))}
            </div>,
            document.body,
          )
        : null}
    </th>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{placeholder}</span>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        enterKeyHint="search"
        className="input py-2 pl-9"
      />
    </label>
  );
}

const PILL = {
  neutral: "bg-ink/[0.06] text-muted",
  info: "bg-primary/10 text-primary-light",
  positive: "bg-positive/10 text-positive",
  negative: "bg-negative/10 text-negative",
  warning: "bg-warning/10 text-warning",
} as const;

/** Status as a soft, rounded pill: the tint says the tone, the word says the state. */
export function StatusPill({ tone, children, title }: { tone: keyof typeof PILL; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${PILL[tone]}`}>
      {children}
    </span>
  );
}

const BOX = "h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-[rgb(var(--c-primary))] disabled:cursor-not-allowed disabled:opacity-40";

export function RowCheckbox(props: { checked: boolean; disabled?: boolean; onChange: () => void; label: string; title?: string }) {
  return (
    <input
      type="checkbox"
      className={BOX}
      checked={props.checked}
      disabled={props.disabled}
      onChange={props.onChange}
      aria-label={props.label}
      title={props.title}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Header checkbox: ticked when every selectable row is, a dash when some are. */
export function SelectAllCheckbox({
  selected,
  total,
  onChange,
  label,
}: {
  selected: number;
  total: number;
  onChange: (on: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const all = total > 0 && selected === total;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selected > 0 && !all;
  }, [selected, all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={BOX}
      checked={all}
      disabled={total === 0}
      onChange={() => onChange(!all)}
      aria-label={label}
    />
  );
}

/** Short day label for tables: 14 Sep 2026. */
export function tableDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
