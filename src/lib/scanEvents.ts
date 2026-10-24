// Writes the scanner's usage events (db/2026_10_scan_events.sql). Server only.
//
// Tracking must never get in the way of a scan or a save: recordScanEvent
// never throws, never waits on anything slow, and gives up quietly. When it
// does lose events (the table missing, the database refusing) it counts
// them and writes the count as a "tracking_dropped" event once it can, so
// the metrics page can say it is undercounting.

import { prisma } from "./prisma";
import { istDay } from "./activity";
import { cleanScanEvent, type ScanEventInput } from "./scanTracking";

/** Most events one user can add in a day (India time). Per server instance, like the scan rate limit. */
export const DAILY_CAP = 200;
/** Rows older than this are deleted. */
export const RETENTION_DAYS = 180;
// Until db/2026_10_scan_events.sql is applied every insert fails; wait before trying again.
const RETRY_MS = 10 * 60_000;
const SYSTEM_ATTEMPT = "00000000-0000-0000-0000-000000000000";

const perUser = new Map<string, { day: string; n: number }>();
let missingUntil = 0;
let dropped = 0;
let purgedOn = "";

/** Test hook: forget the in-memory state. */
export function resetScanEventState(): void {
  perUser.clear();
  missingUntil = 0;
  dropped = 0;
  purgedOn = "";
}

function underCap(userId: string): boolean {
  const day = istDay();
  const cur = perUser.get(userId);
  if (!cur || cur.day !== day) {
    perUser.set(userId, { day, n: 1 });
    return true;
  }
  if (cur.n >= DAILY_CAP) return false;
  cur.n++;
  return true;
}

/**
 * Notes one step of an attempt. `userId` is the signed-in user's id. Anything
 * that is not on the fixed lists is dropped (see cleanScanEvent). Never throws.
 */
export async function recordScanEvent(input: ScanEventInput, userId: string): Promise<void> {
  try {
    if (Date.now() < missingUntil) return;
    const row = cleanScanEvent(input, userId);
    if (!row) return;
    if (!underCap(userId)) {
      dropped++;
      return;
    }
    await prisma.$executeRaw`
      INSERT INTO public.scan_events
        (attempt, seq, user_id, event, outcome, detail, kind, app, n, ms, flag_missing, flag_mismatch, edited, removed, added, test)
      SELECT ${row.attempt}, coalesce(${row.seq}::int,
               (SELECT coalesce(max(seq), 0) + 1 FROM public.scan_events WHERE attempt = ${row.attempt} AND event = ${row.event})),
             ${row.userId}, ${row.event}, ${row.outcome}, ${row.detail}, ${row.kind}, ${row.app}, ${row.n}, ${row.ms},
             ${row.flagMissing}, ${row.flagMismatch}, ${row.edited}, ${row.removed}, ${row.added}, ${row.test}
      ON CONFLICT (attempt, event, seq) DO NOTHING`;
    if (dropped > 0) await flushDropped(userId);
    void purgeOld();
  } catch (e) {
    dropped++;
    // Most likely the table is not created yet: try again in a while.
    if ((e as { meta?: { code?: string } })?.meta?.code === "42P01") missingUntil = Date.now() + RETRY_MS;
  }
}

/** Writes how many events were lost since the last time, then forgets the count. */
async function flushDropped(userId: string): Promise<void> {
  const n = dropped;
  dropped = 0;
  try {
    await prisma.$executeRaw`
      INSERT INTO public.scan_events (attempt, seq, user_id, event, n)
      SELECT ${SYSTEM_ATTEMPT}, (SELECT coalesce(max(seq), 0) + 1 FROM public.scan_events WHERE attempt = ${SYSTEM_ATTEMPT} AND event = 'tracking_dropped'),
             ${userId}, 'tracking_dropped', ${n}`;
  } catch {
    dropped += n;
  }
}

/** Deletes rows past retention, at most once a day per server instance. */
async function purgeOld(): Promise<void> {
  const day = istDay();
  if (purgedOn === day) return;
  purgedOn = day;
  try {
    await prisma.$executeRaw`DELETE FROM public.scan_events WHERE created_at < now() - make_interval(days => ${RETENTION_DAYS}::int)`;
  } catch {
    // Retried tomorrow.
  }
}
