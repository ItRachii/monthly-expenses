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

/**
 * Suggestion list for category pickers: the standard set first, then any extra
 * categories the user has actually used (so a custom one created on a previous
 * expense remains selectable). Trimmed and de-duplicated, order preserved.
 */
export function mergeCategories(used: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...CATEGORIES, ...used]) {
    const t = c.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// Color palette mirrored from the Streamlit charts.
export const CHART_COLORS = [
  "#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3",
  "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd",
  "#ccebc5", "#ffed6f", "#4C72B0",
];
