"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, SearchIcon, SortIcon } from "@/components/Icons";

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
