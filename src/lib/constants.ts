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

export const SPLIT_OPTIONS = ["50-50", "Person A", "Person B"] as const;
export const PEOPLE = ["Person A", "Person B"] as const;

// Color palette mirrored from the Streamlit charts.
export const CHART_COLORS = [
  "#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3",
  "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd",
  "#ccebc5", "#ffed6f", "#4C72B0",
];
