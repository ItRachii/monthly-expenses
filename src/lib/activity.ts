// Records the days each user opens the app, for daily / weekly / monthly
// active users on the developer metrics page. One row per user per day in
// India time (db/2026_10_user_activity.sql); everything else those metrics
// need is already in the tables of what people did.

import { prisma } from "./prisma";

const TIME_ZONE = "Asia/Kolkata";

/** Today's date (YYYY-MM-DD) in India time. */
export function istDay(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(at);
}

// Users already recorded today by this server instance, so a warm instance
// writes once per user per day, not on every page.
const seen = new Map<string, string>();
// Until db/2026_10_user_activity.sql is applied every insert fails; wait a
// while before trying again, so the log is not one error per page view.
const RETRY_MS = 10 * 60_000;
let missingUntil = 0;

/** Notes that the user opened the app today. Never throws: metrics must not break a page. */
export async function recordVisit(userId: string): Promise<void> {
  const day = istDay();
  if (seen.get(userId) === day || Date.now() < missingUntil) return;
  try {
    await prisma.$executeRaw`
      INSERT INTO public.user_activity_days (user_id, day)
      VALUES (${userId}, ${day}::date)
      ON CONFLICT DO NOTHING`;
    seen.set(userId, day);
  } catch (e) {
    // Most likely the table is not created yet: try again in a while.
    if ((e as { meta?: { code?: string } })?.meta?.code === "42P01") missingUntil = Date.now() + RETRY_MS;
  }
}
