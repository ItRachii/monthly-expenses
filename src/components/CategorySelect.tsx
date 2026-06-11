"use client";

import { useState } from "react";

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
    return (
      <div className="space-y-1">
        <input
          className="input"
          autoFocus
          placeholder="New category name"
          value={value}
          maxLength={50}
          onChange={(e) => onChange(e.target.value)}
        />
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
  // that isn't in the suggestion list.
  const options =
    value && !categories.includes(value) ? [value, ...categories] : categories;

  return (
    <select
      className="select"
      value={value}
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
