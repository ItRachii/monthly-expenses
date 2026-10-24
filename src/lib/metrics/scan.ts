// Loads the scanner's usage events for the developer metrics page and turns
// them into figures (scanMath.ts). Only user ids and fixed codes are read.
// Server-only.

import { prisma } from "../prisma";
import { developerIds } from "../features";
import { istDay } from "../activity";
import { addDays } from "./math";
import { WINDOW_DAYS, computeScanMetrics, type ScanEventRow, type ScanMetrics } from "./scanMath";

/** Most rows read at once: a few events per attempt, so this is thousands of attempts. */
const MAX_ROWS = 100_000;

/** The figures, or null until db/2026_10_scan_events.sql is applied. */
export async function loadScanMetrics(opts: { includeDevelopers: boolean }): Promise<ScanMetrics | null> {
  const reg = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('public.scan_events')::text AS t`;
  if (!reg[0]?.t) return null;
  const today = istDay();
  const exclude = opts.includeDevelopers ? [] : Array.from(await developerIds());

  const rows = await prisma.$queryRaw<
    {
      attempt: string; user_id: string; event: string; outcome: string | null; detail: string | null; kind: string | null; app: string | null;
      n: number | null; ms: number | null; flag_missing: boolean | null; flag_mismatch: boolean | null;
      edited: number | null; removed: number | null; added: number | null; created_at: Date;
    }[]
  >`SELECT attempt, user_id, event, outcome, detail, kind, app, n, ms, flag_missing, flag_mismatch, edited, removed, added, created_at
      FROM public.scan_events
     WHERE NOT test AND NOT (user_id = ANY(${exclude}::text[]))
     ORDER BY created_at DESC LIMIT ${MAX_ROWS}`;

  // Everyone who opened the app in the window, for the scanner's share of them.
  const act = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('public.user_activity_days')::text AS t`;
  let activeUsers: number | null = null;
  if (act[0]?.t) {
    const r = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT user_id) AS n FROM public.user_activity_days
       WHERE day > ${addDays(today, -WINDOW_DAYS)}::date AND user_id LIKE 'u\\_%' AND NOT (user_id = ANY(${exclude}::text[]))`;
    activeUsers = Number(r[0]?.n ?? 0);
  }

  const events: ScanEventRow[] = rows.map((r) => ({
    attempt: r.attempt,
    user: r.user_id,
    event: r.event,
    outcome: r.outcome,
    detail: r.detail,
    kind: r.kind,
    app: r.app,
    n: r.n,
    ms: r.ms,
    flagMissing: r.flag_missing,
    flagMismatch: r.flag_mismatch,
    edited: r.edited,
    removed: r.removed,
    added: r.added,
    at: r.created_at.getTime(),
    day: istDay(r.created_at),
  }));
  return computeScanMetrics(events, { today, now: Date.now(), activeUsers });
}

export type { ScanMetrics };
