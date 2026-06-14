// Shared types for receipt scanning. Used by the in-browser parser, the review
// UI, and the server action — so this file must stay free of server/client-only
// imports.

export interface ParsedLineItem {
  description: string;
  category: string;
  qty: number | null;
  /** Line total in rupees, GST-inclusive (so the items sum to the grand total). */
  amount: number;
  /** GST percent applied to this item (5, 12, 18, …) or null if unknown. */
  gstRate: number | null;
  /** Rupees of GST contained within `amount`, or null if unknown. */
  gstAmount: number | null;
}

export interface ParsedReceipt {
  merchant: string;
  /** Purchase date as YYYY-MM-DD, or null if none could be read. */
  purchasedOn: string | null;
  items: ParsedLineItem[];
  /** Grand total printed on the receipt, if found (for reconciliation). */
  detectedTotal: number | null;
  /** Total GST printed on the receipt, if found. */
  detectedTax: number | null;
  rawText: string;
}

/** Standard Indian GST slabs, used to snap noisy effective rates. */
export const GST_SLABS = [0, 5, 12, 18, 28] as const;
