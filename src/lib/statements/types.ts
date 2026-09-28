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

/** The statement's summary box. Every figure is optional: layouts differ. */
export interface StatementSummary {
  previousDues: number | null;
  paymentsCredits: number | null;
  purchases: number | null;
  financeCharges: number | null;
  totalDue: number | null;
  minimumDue: number | null;
  creditLimit: number | null;
  availableCredit: number | null;
  availableCash: number | null;
  /** YYYY-MM-DD */
  statementDate: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
}

export interface CardIdentity {
  /** The last four digits only. Nothing more of the number is ever kept. */
  last4: string;
  /** "Millennia", "Coral", … when the statement names it. */
  product: string | null;
}

export interface ParsedStatement {
  bank: Bank;
  summary: StatementSummary | null;
  card: CardIdentity | null;
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
