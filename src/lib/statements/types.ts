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
  /** Per-parse token of the line's "(Ref# …)" transaction reference. */
  ref?: string | null;
  /** Stable keyed hash of that reference for this user. Set in the browser. */
  refKey?: string | null;
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
  /** The loan an EMI row belongs to. Null for other rows. */
  loan: LoanRef | null;
  /** For a GST charge matched to an instalment billed in an earlier statement. */
  gstFor: GstLineage | null;
  /** A lone GST charge that matched nothing, in this statement or on record. */
  untraced: boolean;
  /** For a GST charge: the token of the reference it cites, and its stable key. */
  taxRef: string | null;
  taxRefKey: string | null;
  /** Suggested app category. */
  category: string;
  page: number;
}

export interface LoanRef {
  /** Per-parse pseudonym of the loan number (see redact.makeRefTagger). */
  token: string | null;
  /** Stable keyed hash of the loan number for this user. Set in the browser. */
  key: string | null;
  /** Last four digits of the loan number, for display only. */
  last4: string | null;
  /** Instalment number when the statement prints one. */
  instalmentNo: number | null;
}

export interface GstLineage {
  loanKey: string;
  loanLast4: string | null;
  instalmentNo: number | null;
  /** Date the instalment was billed. */
  date: string;
  /** Statement month that billed the instalment. */
  period: string;
  /** "ref": the GST cites the instalment's own reference. "amount": date and 18% only. */
  matchedBy: "ref" | "amount";
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
   * Browser only. The digits behind each loan and reference token, kept just
   * long enough to compute their stable keys, then cleared. Never shown,
   * stored or sent.
   */
  tokenDigits: Record<string, string>;
  /**
   * Every line the parser worked from, after redaction: section headings and
   * date-led lines only. Safe to share when a statement does not parse.
   */
  redactedLines: string[];
  warnings: string[];
}
