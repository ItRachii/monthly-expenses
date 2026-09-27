// Shared types for credit card statement import. Used by the in-browser
// pipeline, the review UI and the server action, so this file stays free of
// server-only and browser-only imports.

export type Bank = "hdfc" | "icici" | "unknown";

export type RowKind = "domestic" | "international" | "emi";

export type PartKind = "base" | "principal" | "interest" | "markup" | "gst" | "fee";

export interface RowPart {
  kind: PartKind;
  label: string;
  amount: number;
}

export interface ForeignInfo {
  currency: string;
  amount: number;
  /** Rupees per unit for the base conversion the bank printed. */
  rate: number;
  /** Rupees per unit once markup and GST are included. */
  effectiveRate: number;
}

export interface StatementRow {
  id: string;
  kind: RowKind;
  /** YYYY-MM-DD */
  date: string;
  /** Merchant text with card numbers, references and contacts removed. */
  description: string;
  /** Sum of the parts, always positive. `credit` says which way it went. */
  total: number;
  credit: boolean;
  parts: RowPart[];
  foreign: ForeignInfo | null;
  /** "3 of 12" when the statement says so. */
  installment: string | null;
  /** Suggested app category. */
  category: string;
  page: number;
}

export interface ParsedStatement {
  bank: Bank;
  /** YYYY-MM-DD, when the statement prints one. */
  statementDate: string | null;
  /** YYYY-MM the statement covers. */
  period: string | null;
  rows: StatementRow[];
  /** Redacted date-led lines the parser could not read. */
  unparsed: { page: number; text: string }[];
  /**
   * Every line the parser worked from, after redaction: section headings and
   * date-led lines only. Safe to share when a statement does not parse.
   */
  redactedLines: string[];
  warnings: string[];
}
