// Ported from legacy-streamlit/utils/calculations.py
export const CATEGORIES = [
  "Housing",
  "Groceries",
  "Dining Out",
  "Food",
  "Transport",
  "Healthcare",
  "Wellness",
  "Entertainment",
  "Shopping",
  "Travel",
  "Utilities",
  "Subscriptions",
  "Other",
] as const;

export const SPLIT_EQUAL = "equal";
/** Unequal split: the row's `shares` map holds each participant's amount. */
export const SPLIT_CUSTOM = "custom";

/**
 * Identity of a category for duplicate checks: case, surrounding and repeated
 * spaces, and a plural "s"/"ies" are ignored, so "utilities", "Utility" and
 * " Utilities " all match "Utilities". db/2026_09_category_dedupe.sql uses
 * the same rule for the one-off data cleanup.
 */
export function categoryKey(name: string): string {
  const k = name.trim().replace(/\s+/g, " ").toLowerCase();
  if (k.endsWith("ies")) return k.slice(0, -3) + "y";
  if (k.endsWith("s") && !k.endsWith("ss")) return k.slice(0, -1);
  return k;
}

/**
 * Consistent display form for a new category: trimmed, single-spaced, each
 * word capitalised ("dining out" -> "Dining Out"). Short all-caps words are
 * kept as typed so acronyms like "EMI" or "GST" survive.
 */
export function formatCategory(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) =>
      w.length <= 4 && w === w.toUpperCase() && /[A-Z]/.test(w)
        ? w
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
}

/** The entry in `list` that is the same category as `name`, if any. */
export function findCategory(list: readonly string[], name: string): string | undefined {
  const key = categoryKey(name);
  if (!key) return undefined;
  return list.find((c) => categoryKey(c) === key);
}

/**
 * The category to store for user input: an existing category when the input
 * matches one (so duplicates can never be created), otherwise the input in
 * its consistent display form. Empty stays empty (legacy "uncategorised").
 */
export function canonicalCategory(name: string, known: readonly string[]): string {
  const formatted = formatCategory(name);
  if (!formatted) return "";
  return findCategory(known, formatted) ?? formatted;
}

/**
 * Suggestion list for category pickers: the standard set first, then any extra
 * categories the user has actually used (so a custom one created on a previous
 * expense remains selectable). De-duplicated by categoryKey, so "utilities"
 * never shows next to "Utilities"; the first spelling seen wins.
 */
export function mergeCategories(used: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...CATEGORIES, ...used]) {
    const t = c.trim().replace(/\s+/g, " ");
    const key = categoryKey(t);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}
