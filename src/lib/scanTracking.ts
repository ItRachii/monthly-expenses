// What the scanner's usage tracking may record: fixed lists and counts, never
// content. Shared by the browser (which sends a few hints) and the server
// (which checks every one of them and writes the rows). Pure.
//
// An attempt runs from opening the scanner to saving or leaving. Each step
// is an event; the developer metrics page (/dev/metrics) is built from them.

import { ORDER_APPS } from "./receipt/quickCommerce";

/** The steps of an attempt, in order. */
export const EVENTS = [
  "opened", // the scanner was opened
  "availability_checked", // asked whether the scanner is up
  "images_picked", // images chosen, about to be read
  "scan_requested", // one image sent to be read
  "scan_result", // that image's answer
  "read_result", // all the images put together and read
  "review_changes", // what the user changed before saving (counts only)
  "save_attempted", // Save was pressed
  "save_result", // the save's answer
  "tracking_dropped", // events lost because tracking itself failed (a count)
] as const;
export type ScanEventName = (typeof EVENTS)[number];

/** Outcomes, per event: the failure codes of each stage. "ok" is always allowed where the step can succeed. */
export const OUTCOMES: Record<ScanEventName, readonly string[]> = {
  opened: [],
  availability_checked: ["up", "down"],
  images_picked: ["ok", "unsupported", "too-large", "prep-failed"],
  scan_requested: [],
  scan_result: ["ok", "down", "no-text", "unsupported", "too-large", "rate-limited", "empty", "network"],
  read_result: ["ok", "zero-items"],
  review_changes: [],
  save_attempted: [],
  save_result: ["ok", "invalid", "refused", "error"],
  tracking_dropped: [],
};

/** Why the scanner was down, when it was. */
export const DOWN_REASONS = ["not-configured", "unreachable", "timeout", "refused", "error"] as const;
export type DownReason = (typeof DOWN_REASONS)[number];

export const KINDS = ["receipt", "order"] as const;
export type ScanKind = (typeof KINDS)[number];

/** The apps an order can come from, plus none. A name outside the list is never stored. */
const APPS: readonly string[] = ORDER_APPS;

/** Events the browser may report itself; everything else is written by the server. */
export const CLIENT_EVENTS: readonly ScanEventName[] = ["images_picked", "read_result", "review_changes", "scan_result"];
/** The only scan_result a browser may report: its own request never reached the server. */
export const CLIENT_SCAN_OUTCOMES: readonly string[] = ["network"];

const ATTEMPT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isAttemptId = (v: unknown): v is string => typeof v === "string" && ATTEMPT.test(v);

/** A row ready to store, or what it would be. */
export interface ScanEventRow {
  attempt: string;
  seq: number | null;
  userId: string;
  event: ScanEventName;
  outcome: string | null;
  detail: string | null;
  kind: ScanKind | null;
  app: string | null;
  n: number | null;
  ms: number | null;
  flagMissing: boolean | null;
  flagMismatch: boolean | null;
  edited: number | null;
  removed: number | null;
  added: number | null;
  test: boolean;
}

/** What a caller may pass. Anything not on the lists is dropped, so free text cannot get in. */
export interface ScanEventInput {
  attempt: unknown;
  event: unknown;
  seq?: unknown;
  outcome?: unknown;
  detail?: unknown;
  kind?: unknown;
  app?: unknown;
  n?: unknown;
  ms?: unknown;
  flagMissing?: unknown;
  flagMismatch?: unknown;
  edited?: unknown;
  removed?: unknown;
  added?: unknown;
  test?: unknown;
}

const count = (v: unknown, max = 100_000): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
const flag = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** The row to store for an input, or null when it is not a valid event. Never trusts a string. */
export function cleanScanEvent(input: ScanEventInput, userId: string): ScanEventRow | null {
  if (!isAttemptId(input.attempt) && input.event !== "tracking_dropped") return null;
  if (!(EVENTS as readonly string[]).includes(input.event as string)) return null;
  const event = input.event as ScanEventName;
  const allowed = OUTCOMES[event];
  const outcome = typeof input.outcome === "string" && allowed.includes(input.outcome) ? input.outcome : null;
  if (allowed.length > 0 && outcome === null && event !== "availability_checked") return null;
  const detail =
    typeof input.detail === "string" && (DOWN_REASONS as readonly string[]).includes(input.detail) ? input.detail : null;
  const kind = typeof input.kind === "string" && (KINDS as readonly string[]).includes(input.kind) ? (input.kind as ScanKind) : null;
  const app = typeof input.app === "string" && APPS.includes(input.app) ? input.app : null;
  return {
    attempt: isAttemptId(input.attempt) ? input.attempt : "00000000-0000-0000-0000-000000000000",
    seq: input.seq === undefined ? null : count(input.seq, 1000),
    userId,
    event,
    outcome,
    detail,
    kind,
    app,
    n: count(input.n),
    ms: count(input.ms, 3_600_000),
    flagMissing: flag(input.flagMissing),
    flagMismatch: flag(input.flagMismatch),
    edited: count(input.edited),
    removed: count(input.removed),
    added: count(input.added),
    test: input.test === true,
  };
}

/** Whether a browser may report this event (the server checks again; this is the shared rule). */
export function clientMayReport(input: { event: unknown; outcome?: unknown }): boolean {
  if (!(CLIENT_EVENTS as readonly unknown[]).includes(input.event)) return false;
  return input.event !== "scan_result" || (CLIENT_SCAN_OUTCOMES as readonly unknown[]).includes(input.outcome);
}
