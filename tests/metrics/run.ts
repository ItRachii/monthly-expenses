// Unit checks for the product metrics math (no database). Run with
// `npm run test:metrics`. The SQL that feeds it is checked against a real
// Postgres by hand; this pins down the definitions.
import { addDays, computeUsage, weekOf, type UserDay } from "../../src/lib/metrics/math";
import { istDay } from "../../src/lib/activity";

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

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all metrics checks passed");
