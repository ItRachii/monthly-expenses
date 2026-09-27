"use client";

import { useState } from "react";
import { findCategory, formatCategory } from "@/lib/constants";

// Sentinel option value that switches the control into "type a new category"
// mode. A stored category can never equal this (it is never submitted — when
// chosen we swap to a text input bound to the real value).
const NEW = "__add_new_category__";

/**
 * Category picker that also lets the user create a brand-new category inline.
 * The parent owns the category string; in "new" mode the text input edits that
 * same value directly, so submitting needs no special handling.
 */
export function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: string[];
  value: string;
  onChange: (category: string) => void;
}) {
  const [creating, setCreating] = useState(false);

  if (creating) {
    // Same rule the server applies on save: case, spacing and a plural "s"
    // are ignored, so "utility" is recognised as the existing "Utilities".
    const existing = findCategory(categories, value);
    const formatted = formatCategory(value);
    const pickExisting = () => {
      setCreating(false);
      if (existing) onChange(existing);
    };
    return (
      <div className="space-y-1">
        <input
          className="input"
          autoFocus
          placeholder="New category name"
          value={value}
          maxLength={50}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={existing ? true : undefined}
        />
        {existing ? (
          <div className="alert-warning flex items-center justify-between gap-2 py-2">
            <span>&ldquo;{existing}&rdquo; is already present.</span>
            <button
              type="button"
              className="shrink-0 text-xs font-semibold underline"
              onClick={pickExisting}
            >
              Use it
            </button>
          </div>
        ) : formatted && formatted !== value.trim() ? (
          <p className="text-xs text-muted">Will be saved as &ldquo;{formatted}&rdquo;.</p>
        ) : null}
        <button
          type="button"
          className="text-xs text-muted hover:text-ink"
          onClick={() => {
            setCreating(false);
            onChange(categories[0] ?? "");
          }}
        >
          ← Choose an existing category
        </button>
      </div>
    );
  }

  // Keep the current value selectable even if it is a legacy/custom category
  // that isn't in the suggestion list (and isn't a variant of one that is).
  const options =
    value && !findCategory(categories, value) ? [value, ...categories] : categories;
  const selected = (value && findCategory(categories, value)) || value;

  return (
    <select
      className="select"
      value={selected}
      onChange={(e) => {
        if (e.target.value === NEW) {
          setCreating(true);
          onChange("");
        } else {
          onChange(e.target.value);
        }
      }}
    >
      {options.map((c) => (
        <option key={c} value={c}>
          {c === "" ? "(uncategorized)" : c}
        </option>
      ))}
      <option value={NEW}>➕ Add new category…</option>
    </select>
  );
}
