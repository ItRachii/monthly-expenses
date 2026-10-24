// Unit checks for the product metrics math (no database). Run with
// `npm run test:metrics`. The SQL that feeds it is checked against a real
// Postgres by hand; this pins down the definitions.
import { addDays, computeUsage, weekOf, type UserDay } from "../../src/lib/metrics/math";
import { istDay } from "../../src/lib/activity";
import { computeScanMetrics, type ScanEventRow } from "../../src/lib/metrics/scanMath";
import { cleanScanEvent, clientMayReport } from "../../src/lib/scanTracking";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failures++;
};

check("addDays across a month", addDays("2026-10-30", 3) === "2026-11-02");
check("addDays back across a year", addDays("2026-01-02", -3) === "2025-12-30");
check("week starts on Monday", weekOf("2026-10-18") === "2026-10-12" && weekOf("2026-10-12") === "2026-10-12");
// 18:45 UTC is 00:15 the next day in India.
check("India day", istDay(new Date("2026-10-17T18:45:00Z")) === "2026-10-18" && istDay(new Date("2026-10-17T18:15:00Z")) === "2026-10-17");

const today = "2026-10-18"; // a Sunday
const d = (n: number) => addDays(today, -n);
const rows: UserDay[] = [
  // a: arrived 20 days ago, adds an expense every day since.
  ...Array.from({ length: 21 }, (_, i) => ({ user: "a", day: d(i), kind: "expense" as const })),
  // b: arrived 10 days ago, only ever looked: then and today.
  { user: "b", day: d(10), kind: "visit" },
  { user: "b", day: d(0), kind: "visit" },
  // c: arrived 40 days ago, scanned a receipt then, gone since.
  { user: "c", day: d(40), kind: "receipt" },
  // e: arrived 12 days ago, joined a group 2 days later.
  { user: "e", day: d(12), kind: "visit" },
  { user: "e", day: d(10), kind: "group" },
];
const firstSeen = new Map([["a", d(20)], ["b", d(10)], ["c", d(40)], ["e", d(12)]]);
const u = computeUsage(rows, firstSeen, today);

check("WAU: active in the last 7 days", u.wau.value === 2, String(u.wau.value)); // a, b
check("WAU previous week", u.wau.previous === 3, String(u.wau.previous)); // a, b (day 10), e (days 10, 12)
check("MAU", u.mau.value === 3, String(u.mau.value)); // a, b, e
check("MAU previous 30 days", u.mau.previous === 1, String(u.mau.previous)); // c
check("DAU is the 7-day average", Math.abs(u.dau.value - 8 / 7) < 1e-9, String(u.dau.value)); // a x7 + b today
check("today's DAU in the series", u.series.at(-1)?.dau === 2 && u.series.length === 90);
check("no one new this week", u.wauNew === 0);
check("new users, last 30 days", u.newUsers.value === 3 && u.newUsers.previous === 1, JSON.stringify([u.newUsers.value, u.newUsers.previous]));
check("12 weeks of sign-ups, ending this week", u.newUsers.weekly.length === 12 && u.newUsers.weekly.at(-1)?.week === "2026-10-12");
// Arrived 8..37 days ago: a (20, acted), b (10, only looked), e (12, joined a group on day 2).
check("activation", u.activation.users === 3 && u.activation.activated === 2, JSON.stringify(u.activation));
const adopt = Object.fromEntries(u.adoption.map((x) => [x.kind, x.users]));
check("adoption counts each user once per kind", adopt.expense === 1 && adopt.group === 1 && adopt.receipt === 0, JSON.stringify(adopt));
// Average DAU over 30 days (a 21 days, b and e 2 each) over MAU (3).
check("stickiness", u.stickiness !== null && Math.abs(u.stickiness - (21 + 2 + 2) / 30 / 3) < 1e-9, String(u.stickiness));

// e arrived in the week of 2026-10-05 and came back that same week only.
const ce = u.cohorts.find((c) => c.week === "2026-10-05");
check("cohort week", ce?.size === 2, JSON.stringify(ce)); // b and e
check("cohort retention", JSON.stringify(ce?.retention.slice(0, 3)) === JSON.stringify([1, 0.5, null]), JSON.stringify(ce?.retention));
check("8 cohorts of 8 weeks", u.cohorts.length === 8 && u.cohorts.every((c) => c.retention.length === 8));
check("empty cohort has no rates", u.cohorts[u.cohorts.length - 1].retention[0] === null);

const empty = computeUsage([], new Map(), today);
check("no data", empty.mau.value === 0 && empty.stickiness === null && empty.activation.users === 0);

// ---- the scanner's usage events -------------------------------------------
const NOW = Date.parse("2026-10-18T12:00:00Z");
const MIN = 60_000;
let tick = 0;
const ev = (attempt: string, user: string, event: string, o: Partial<ScanEventRow> = {}, day = today, minutesAgo = 300 - tick++): ScanEventRow => ({
  attempt, user, event, outcome: null, detail: null, kind: null, app: null, n: null, ms: null, flagMissing: null, flagMismatch: null,
  edited: null, removed: null, added: null, at: NOW - minutesAgo * MIN, day, ...o,
});
const up = (a: string, u: string) => [ev(a, u, "opened"), ev(a, u, "availability_checked", { outcome: "up", ms: 40 })];
const scanned = (a: string, u: string, app: string) => [
  ev(a, u, "images_picked", { outcome: "ok", n: 2, app, kind: "order" }),
  ev(a, u, "scan_requested", { n: 100 }), ev(a, u, "scan_result", { outcome: "ok", ms: 10_000 }),
  ev(a, u, "scan_requested", { n: 100 }), ev(a, u, "scan_result", { outcome: "ok", ms: 20_000 }),
  ev(a, u, "read_result", { outcome: "ok", n: 5 }),
];
const events: ScanEventRow[] = [
  // A (u1, Zepto): the clean run, saved with 1 edit and 1 item removed.
  ...up("A", "u1"), ...scanned("A", "u1", "Zepto"),
  ev("A", "u1", "review_changes", { edited: 1, removed: 1, added: 0 }), ev("A", "u1", "save_attempted", { n: 4 }), ev("A", "u1", "save_result", { outcome: "ok", ms: 300 }),
  // B (u2): the scanner was down when opened.
  ev("B", "u2", "opened"), ev("B", "u2", "availability_checked", { outcome: "down", detail: "unreachable" }),
  // C (u2, Blinkit, 2 days ago): one image failed, rescanned, read twice, saved: not clean.
  ...up("C", "u2").map((e) => ({ ...e, day: addDays(today, -2) })),
  ev("C", "u2", "images_picked", { outcome: "ok", n: 1, app: "Blinkit", kind: "order" }, addDays(today, -2)),
  ev("C", "u2", "scan_requested", {}, addDays(today, -2)), ev("C", "u2", "scan_result", { outcome: "no-text" }, addDays(today, -2)),
  ev("C", "u2", "scan_requested", {}, addDays(today, -2)), ev("C", "u2", "scan_result", { outcome: "ok", ms: 30_000 }, addDays(today, -2)),
  ev("C", "u2", "read_result", { outcome: "ok", n: 3, flagMissing: true }, addDays(today, -2)),
  ev("C", "u2", "read_result", { outcome: "ok", n: 3, flagMismatch: true }, addDays(today, -2)),
  ev("C", "u2", "save_attempted", {}, addDays(today, -2)), ev("C", "u2", "save_result", { outcome: "invalid" }, addDays(today, -2)),
  ev("C", "u2", "save_attempted", {}, addDays(today, -2)), ev("C", "u2", "save_result", { outcome: "ok" }, addDays(today, -2)),
  // D (u3, Zepto): picked and left, long ago.
  ...up("D", "u3"), ev("D", "u3", "images_picked", { outcome: "ok", n: 1, app: "Zepto", kind: "order" }),
  // E (u3, receipt): up at the start, went down in the middle of the scan.
  ...up("E", "u3"), ev("E", "u3", "images_picked", { outcome: "ok", n: 1, kind: "receipt" }), ev("E", "u3", "scan_requested"), ev("E", "u3", "scan_result", { outcome: "down", detail: "timeout" }),
  // Not in the window / not counted.
  ...up("OLD", "u9").map((e) => ({ ...e, day: addDays(today, -60) })),
  ev("00000000-0000-0000-0000-000000000000", "u1", "tracking_dropped", { n: 3 }),
];
const sm = computeScanMetrics(events, { today, now: NOW, activeUsers: 6 });
check("scan: attempts opened in the window (the old one is left out)", sm.attempts === 5, String(sm.attempts));
check("scan: users today / this week / this month", sm.usage.today === 3 && sm.usage.week === 3 && sm.usage.month === 3, JSON.stringify([sm.usage.today, sm.usage.week, sm.usage.month]));
check("scan: share of the people active in the app", sm.usage.share?.active === 6 && sm.usage.share.pct === 0.5, JSON.stringify(sm.usage.share));
check("scan: attempts per user", sm.usage.attemptsPerUser === 5 / 3);
check("scan: new users (u1, u2, u3 all first opened this month)", sm.usage.newUsers === 3 && sm.usage.returningUsers === 0);
check("scan: down on open: 1 of 5 checks, 1 person, unreachable", sm.availability.checks === 5 && sm.availability.down === 1 && sm.availability.downRate === 0.2 && sm.availability.usersHit === 1 && sm.availability.reasons[0].reason === "unreachable", JSON.stringify(sm.availability));
check("scan: went down mid-scan (E only)", sm.availability.midScan === 1, String(sm.availability.midScan));
check("scan: end to end 2 of 5, and of attempts that found it up 2 of 4", sm.endToEnd.saved === 2 && sm.endToEnd.rate === 0.4 && sm.endToEnd.ratePerUp === 0.5, JSON.stringify(sm.endToEnd));
check("scan: clean success is A only (C failed, rescanned and read twice)", sm.clean.saved === 1 && sm.clean.rate === 0.2, JSON.stringify(sm.clean));
check("scan: funnel counts", JSON.stringify(sm.funnel.map((f) => f.attempts)) === JSON.stringify([5, 4, 2, 2, 2, 2]), JSON.stringify(sm.funnel.map((f) => [f.key, f.attempts])));
check("scan: abandoned = not saved and still for 30 minutes (B, D, E)", sm.abandoned.attempts === 3, JSON.stringify(sm.abandoned));
const stage = (s: string) => sm.failures.find((f) => f.stage === s)!;
check("scan: failures per stage", stage("availability").failed === 1 && stage("scan").failed === 2 && stage("scan").total === 5 && stage("save").failed === 1 && stage("save").total === 3, JSON.stringify(sm.failures.map((f) => [f.stage, f.failed, f.total])));
check("scan: scan failure codes", JSON.stringify(stage("scan").codes) === JSON.stringify([{ code: "down", n: 1 }, { code: "no-text", n: 1 }]), JSON.stringify(stage("scan").codes));
check("scan: read warnings (missing parts, bill mismatch)", stage("read").warnings.length === 2 && stage("read").failed === 0, JSON.stringify(stage("read").warnings));
check("scan: by app", sm.byApp.find((a) => a.app === "Zepto")?.attempts === 2 && sm.byApp.find((a) => a.app === "Zepto")?.saved === 1 && sm.byApp.find((a) => a.app === "Blinkit")?.saved === 1, JSON.stringify(sm.byApp));
check("scan: corrections per saved attempt (only A reported them)", sm.quality.edited === 1 && sm.quality.removed === 1 && sm.quality.added === 0 && sm.quality.savedWithReview === 1, JSON.stringify(sm.quality));
check("scan: re-scans per attempt that was read (C read twice, A once: 1 over 2)", sm.quality.rescansPerAttempt === 0.5, String(sm.quality.rescansPerAttempt));
check("scan: scan time median and p90", sm.quality.scanMs?.median === 20_000 && sm.quality.scanMs.p90 === 30_000 && sm.quality.scanMs.n === 3, JSON.stringify(sm.quality.scanMs));
check("scan: tracking drops are reported", sm.tracking.dropped === 3);
const none = computeScanMetrics([], { today, now: NOW, activeUsers: null });
check("scan: no data at all", none.attempts === 0 && none.endToEnd.rate === null && none.availability.downRate === null && none.usage.share === null && none.quality.scanMs === null);

// What may be stored: fixed lists only.
const ATT = "11111111-2222-3333-4444-555555555555";
const okRow = cleanScanEvent({ attempt: ATT, event: "save_result", outcome: "ok", ms: 120 }, "u_x");
check("track: a valid event is kept", okRow?.event === "save_result" && okRow.outcome === "ok" && okRow.ms === 120 && okRow.userId === "u_x");
check("track: an outcome that is not on the list is refused", cleanScanEvent({ attempt: ATT, event: "save_result", outcome: "Invalid amount for Milk" }, "u_x") === null);
check("track: an event that does not exist is refused", cleanScanEvent({ attempt: ATT, event: "drop table" }, "u_x") === null);
check("track: an attempt id that is not a uuid is refused", cleanScanEvent({ attempt: "milk", event: "opened" }, "u_x") === null);
const stripped = cleanScanEvent({ attempt: ATT, event: "images_picked", outcome: "ok", app: "Totally Unknown App", detail: "my phone is 9876543210", kind: "x", n: -4, edited: 1.5 }, "u_x");
check("track: free text, unknown apps, odd numbers are dropped", stripped?.app === null && stripped.detail === null && stripped.kind === null && stripped.n === null && stripped.edited === null, JSON.stringify(stripped));
check("track: a known app and a real reason are kept", cleanScanEvent({ attempt: ATT, event: "availability_checked", outcome: "down", detail: "timeout", app: "Zepto" }, "u")?.detail === "timeout" && cleanScanEvent({ attempt: ATT, event: "images_picked", outcome: "ok", app: "Zepto" }, "u")?.app === "Zepto");
check("track: a browser may report its steps but not the server's", clientMayReport({ event: "read_result" }) && clientMayReport({ event: "scan_result", outcome: "network" }) && !clientMayReport({ event: "scan_result", outcome: "ok" }) && !clientMayReport({ event: "save_result" }) && !clientMayReport({ event: "availability_checked" }));

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all metrics checks passed");
