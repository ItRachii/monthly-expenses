// What the scanner's usage events say, for the developer metrics page. Pure,
// so it is unit-tested without a database (tests/metrics/run.ts); the rows
// come from src/lib/metrics/scan.ts. Days are YYYY-MM-DD in India time.
//
// An attempt is one run of the scanner: from opening it to saving or
// leaving. Every figure here is a count or a rate over attempts or users;
// nothing is read from the images or the expenses.

import { addDays } from "./math";

/** One stored event, as the page reads it. */
export interface ScanEventRow {
  attempt: string;
  user: string;
  event: string;
  outcome: string | null;
  detail: string | null;
  kind: string | null;
  app: string | null;
  n: number | null;
  ms: number | null;
  flagMissing: boolean | null;
  flagMismatch: boolean | null;
  edited: number | null;
  removed: number | null;
  added: number | null;
  /** When it happened (ms). */
  at: number;
  /** That moment's India day. */
  day: string;
}

/** How long an attempt may sit still before it counts as abandoned. */
export const ABANDONED_AFTER_MS = 30 * 60_000;
/** The look-back of every figure, in days. */
export const WINDOW_DAYS = 30;

export const STAGES = ["availability", "pick", "scan", "read", "save"] as const;
export type Stage = (typeof STAGES)[number];
const STAGE_LABEL: Record<Stage, string> = {
  availability: "Scanner was up",
  pick: "Picking images",
  scan: "Reading each image",
  read: "Putting the order together",
  save: "Saving",
};

export interface ScanMetrics {
  windowDays: number;
  attempts: number;
  usage: {
    today: number;
    week: number;
    month: number;
    /** Of everyone active in the last 30 days (null when not known). */
    share: { active: number; pct: number } | null;
    newUsers: number;
    returningUsers: number;
    attemptsPerUser: number | null;
    daily: { day: string; users: number; attempts: number }[];
  };
  availability: {
    checks: number;
    down: number;
    downRate: number | null;
    usersHit: number;
    /** Went down in the middle of an attempt that had found it up. */
    midScan: number;
    reasons: { reason: string; n: number }[];
    daily: { day: string; checks: number; down: number }[];
  };
  funnel: { key: string; label: string; attempts: number; pctOfOpened: number | null; dropOff: number | null }[];
  endToEnd: { saved: number; rate: number | null; ratePerUp: number | null };
  clean: { saved: number; rate: number | null };
  abandoned: { attempts: number; rate: number | null; lastStage: { stage: string; n: number }[] };
  failures: {
    stage: Stage;
    label: string;
    total: number;
    failed: number;
    rate: number | null;
    codes: { code: string; n: number }[];
    /** Not failures, but things that tell you the read was shaky. */
    warnings: { code: string; n: number }[];
  }[];
  byApp: { app: string; attempts: number; saved: number; savedRate: number | null; failedScans: number }[];
  quality: {
    savedWithReview: number;
    edited: number | null;
    removed: number | null;
    added: number | null;
    rescansPerAttempt: number | null;
    scanMs: { median: number; p90: number; n: number } | null;
  };
  tracking: { dropped: number };
}

const rate = (a: number, b: number) => (b > 0 ? a / b : null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}

const tally = (items: string[]) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
};

/**
 * Every figure for the last 30 days. `events` may reach further back (the
 * first-time-or-returning split needs it). `activeUsers` is how many people
 * opened the app at all in those 30 days, to say what share used the scanner.
 */
export function computeScanMetrics(
  events: ScanEventRow[],
  opts: { today: string; now: number; activeUsers: number | null },
): ScanMetrics {
  const since = addDays(opts.today, -(WINDOW_DAYS - 1));
  const real = events.filter((e) => e.event !== "tracking_dropped");
  const inWindow = real.filter((e) => e.day >= since && e.day <= opts.today);

  // Attempts opened in the window, and everything that happened in them.
  const byAttempt = new Map<string, ScanEventRow[]>();
  for (const e of real) {
    const list = byAttempt.get(e.attempt) ?? [];
    list.push(e);
    byAttempt.set(e.attempt, list);
  }
  const attempts = [...byAttempt.entries()]
    .filter(([, list]) => list.some((e) => e.event === "opened" && e.day >= since && e.day <= opts.today))
    .map(([id, list]) => {
      const sorted = [...list].sort((a, b) => a.at - b.at);
      const opened = sorted.find((e) => e.event === "opened")!;
      const has = (event: string, outcome?: string) => sorted.some((e) => e.event === event && (outcome === undefined || e.outcome === outcome));
      const avail = sorted.find((e) => e.event === "availability_checked");
      const saved = has("save_result", "ok");
      return {
        id,
        user: opened.user,
        day: opened.day,
        kind: sorted.find((e) => e.kind)?.kind ?? null,
        app: sorted.find((e) => e.app)?.app ?? null,
        events: sorted,
        last: sorted[sorted.length - 1].at,
        saved,
        wasUp: avail?.outcome === "up",
        picked: has("images_picked", "ok"),
        scanned: has("scan_result", "ok"),
        read: has("read_result", "ok"),
        saveTried: has("save_attempted"),
        reads: sorted.filter((e) => e.event === "read_result").length,
        saveTries: sorted.filter((e) => e.event === "save_attempted").length,
      };
    });

  // ---- usage
  const usersOf = (days: string[]) => new Set(attempts.filter((a) => days.includes(a.day)).map((a) => a.user));
  const lastDays = (n: number) => Array.from({ length: n }, (_, i) => addDays(opts.today, -i));
  const monthUsers = usersOf(lastDays(WINDOW_DAYS));
  const firstOpen = new Map<string, string>();
  for (const e of real)
    if (e.event === "opened" && (!firstOpen.has(e.user) || e.day < firstOpen.get(e.user)!)) firstOpen.set(e.user, e.day);
  const newUsers = [...monthUsers].filter((u) => firstOpen.get(u)! >= since).length;
  const usage: ScanMetrics["usage"] = {
    today: usersOf([opts.today]).size,
    week: usersOf(lastDays(7)).size,
    month: monthUsers.size,
    share: opts.activeUsers && opts.activeUsers > 0 ? { active: opts.activeUsers, pct: Math.min(1, monthUsers.size / opts.activeUsers) } : null,
    newUsers,
    returningUsers: monthUsers.size - newUsers,
    attemptsPerUser: monthUsers.size ? attempts.length / monthUsers.size : null,
    daily: lastDays(14)
      .reverse()
      .map((day) => ({ day, users: usersOf([day]).size, attempts: attempts.filter((a) => a.day === day).length })),
  };

  // ---- availability
  const checks = inWindow.filter((e) => e.event === "availability_checked");
  const down = checks.filter((e) => e.outcome === "down");
  const midScan = attempts.filter((a) => a.wasUp && a.events.some((e) => e.event === "scan_result" && e.outcome === "down")).length;
  const availability: ScanMetrics["availability"] = {
    checks: checks.length,
    down: down.length,
    downRate: rate(down.length, checks.length),
    usersHit: new Set(down.map((e) => e.user)).size,
    midScan,
    reasons: tally(down.map((e) => e.detail ?? "unknown")).map(({ k, n }) => ({ reason: k, n })),
    daily: lastDays(14)
      .reverse()
      .map((day) => ({
        day,
        checks: checks.filter((e) => e.day === day).length,
        down: down.filter((e) => e.day === day).length,
      })),
  };

  // ---- funnel, end to end, clean, abandoned
  const n = attempts.length;
  const steps: [string, string, number][] = [
    ["opened", "Opened the scanner", n],
    ["picked", "Picked images", attempts.filter((a) => a.picked).length],
    ["scanned", "An image was read", attempts.filter((a) => a.scanned).length],
    ["read", "The order was put together", attempts.filter((a) => a.read).length],
    ["save", "Pressed Save", attempts.filter((a) => a.saveTried).length],
    ["saved", "Saved to expenses", attempts.filter((a) => a.saved).length],
  ];
  const funnel = steps.map(([key, label, count], i) => ({
    key,
    label,
    attempts: count,
    pctOfOpened: rate(count, n),
    dropOff: i === 0 ? null : steps[i - 1][2] > 0 ? 1 - count / steps[i - 1][2] : null,
  }));
  const saved = attempts.filter((a) => a.saved);
  const isFailure = (e: ScanEventRow) =>
    (e.event === "availability_checked" && e.outcome === "down") ||
    (e.event !== "availability_checked" && e.outcome !== null && e.outcome !== "ok");
  const clean = saved.filter((a) => a.reads === 1 && a.saveTries === 1 && !a.events.some(isFailure));
  const upAttempts = attempts.filter((a) => a.wasUp);
  const abandoned = attempts.filter((a) => !a.saved && opts.now - a.last >= ABANDONED_AFTER_MS);
  const reached = (a: (typeof attempts)[number]) =>
    a.saveTried ? "Pressed Save" : a.read ? "Reviewing the items" : a.scanned ? "Reading" : a.picked ? "Picked images" : a.wasUp ? "Opened, nothing picked" : "Opened (scanner down or unchecked)";

  // ---- failures, by stage
  const inAttempts = attempts.flatMap((a) => a.events);
  const stageRows = (event: string) => inAttempts.filter((e) => e.event === event);
  const failedBy = (rows: ScanEventRow[]) => tally(rows.filter((e) => e.outcome !== null && e.outcome !== "ok").map((e) => e.outcome!));
  const mk = (stage: Stage, total: number, codes: { k: string; n: number }[], warnings: { code: string; n: number }[] = []) => {
    const failed = codes.reduce((s, c) => s + c.n, 0);
    return { stage, label: STAGE_LABEL[stage], total, failed, rate: rate(failed, total), codes: codes.map((c) => ({ code: c.k, n: c.n })), warnings };
  };
  const avails = stageRows("availability_checked");
  const picks = stageRows("images_picked");
  const scans = stageRows("scan_result");
  const reads = stageRows("read_result");
  const saves = stageRows("save_result");
  const failures = [
    mk("availability", avails.length, tally(avails.filter((e) => e.outcome === "down").map((e) => `down: ${e.detail ?? "unknown"}`))),
    mk("pick", picks.length, failedBy(picks)),
    mk("scan", scans.length, failedBy(scans)),
    mk("read", reads.length, failedBy(reads), [
      { code: "missing-parts prompt shown", n: reads.filter((e) => e.flagMissing).length },
      { code: "bill total did not match", n: reads.filter((e) => e.flagMismatch).length },
    ].filter((w) => w.n > 0)),
    mk("save", stageRows("save_attempted").length, failedBy(saves)),
  ];

  // ---- by app
  const apps = [...new Set(attempts.map((a) => a.app ?? "Receipt (no app)"))].sort();
  const byApp = apps
    .map((app) => {
      const list = attempts.filter((a) => (a.app ?? "Receipt (no app)") === app);
      const sv = list.filter((a) => a.saved).length;
      return {
        app,
        attempts: list.length,
        saved: sv,
        savedRate: rate(sv, list.length),
        failedScans: list.flatMap((a) => a.events).filter((e) => e.event === "scan_result" && e.outcome !== "ok").length,
      };
    })
    .sort((a, b) => b.attempts - a.attempts);

  // ---- quality
  const reviews = saved.map((a) => a.events.filter((e) => e.event === "review_changes").pop()).filter((e): e is ScanEventRow => !!e);
  const withReads = attempts.filter((a) => a.reads >= 1);
  const okMs = scans.filter((e) => e.outcome === "ok" && e.ms !== null).map((e) => e.ms!);
  const quality: ScanMetrics["quality"] = {
    savedWithReview: reviews.length,
    edited: avg(reviews.map((e) => e.edited ?? 0)),
    removed: avg(reviews.map((e) => e.removed ?? 0)),
    added: avg(reviews.map((e) => e.added ?? 0)),
    rescansPerAttempt: avg(withReads.map((a) => a.reads - 1)),
    scanMs: okMs.length ? { median: percentile(okMs, 0.5), p90: percentile(okMs, 0.9), n: okMs.length } : null,
  };

  return {
    windowDays: WINDOW_DAYS,
    attempts: n,
    usage,
    availability,
    funnel,
    endToEnd: { saved: saved.length, rate: rate(saved.length, n), ratePerUp: rate(upAttempts.filter((a) => a.saved).length, upAttempts.length) },
    clean: { saved: clean.length, rate: rate(clean.length, n) },
    abandoned: {
      attempts: abandoned.length,
      rate: rate(abandoned.length, n),
      lastStage: tally(abandoned.map(reached)).map(({ k, n: c }) => ({ stage: k, n: c })),
    },
    failures,
    byApp,
    quality,
    tracking: { dropped: events.filter((e) => e.event === "tracking_dropped" && e.day >= since).reduce((s, e) => s + (e.n ?? 0), 0) },
  };
}
