// Product metrics from who did what on which day. Pure, so it is unit-tested
// without a database (tests/metrics/run.ts); the rows come from
// src/lib/metrics/queries.ts. Days are YYYY-MM-DD in India time.

export type Kind = "visit" | "expense" | "receipt" | "statement" | "settlement" | "group" | "invite";

/** Everything but "visit": the user did something, not just looked. */
export const ACTION_KINDS: Exclude<Kind, "visit">[] = ["expense", "receipt", "statement", "settlement", "group", "invite"];

export interface UserDay {
  user: string;
  day: string;
  kind: Kind;
}

export interface Window {
  value: number;
  /** The same window just before, for the change. */
  previous: number;
}

export interface Usage {
  /** Average daily active users over the last 7 days. */
  dau: Window;
  /** Active in the last 7 days. */
  wau: Window;
  /** Active in the last 30 days. */
  mau: Window;
  /** Of this week's active users, how many were first seen this week. */
  wauNew: number;
  /** Average DAU over the last 30 days divided by MAU: how many days a month a user comes back. */
  stickiness: number | null;
  /** The last 90 days: active users that day, in the 7 days and in the 30 days up to it. */
  series: { day: string; dau: number; wau: number; mau: number }[];
  newUsers: Window & { weekly: { week: string; count: number }[] };
  /** New users of 8 to 37 days ago who did something within a week of arriving. */
  activation: { users: number; activated: number };
  /** Share of the last 30 days' active users who did each kind of thing. */
  adoption: { kind: Exclude<Kind, "visit">; users: number }[];
  /** Users by the week they arrived, and the share active in each later week. */
  cohorts: { week: string; size: number; retention: (number | null)[] }[];
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The Monday of the day's week. */
export function weekOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -dow);
}

const COHORT_WEEKS = 8;

export function computeUsage(rows: UserDay[], firstSeen: Map<string, string>, today: string): Usage {
  // Users active per day, and the action kinds each user did per day.
  const byDay = new Map<string, Set<string>>();
  const actions = new Map<string, Map<string, Set<string>>>(); // user -> day -> kinds
  for (const r of rows) {
    let users = byDay.get(r.day);
    if (!users) byDay.set(r.day, (users = new Set()));
    users.add(r.user);
    if (r.kind !== "visit") {
      let days = actions.get(r.user);
      if (!days) actions.set(r.user, (days = new Map()));
      let kinds = days.get(r.day);
      if (!kinds) days.set(r.day, (kinds = new Set()));
      kinds.add(r.kind);
    }
  }

  // Distinct users active in the n days ending at `end`.
  const activeIn = (end: string, n: number): Set<string> => {
    const out = new Set<string>();
    for (let i = 0; i < n; i++) for (const u of byDay.get(addDays(end, -i)) ?? []) out.add(u);
    return out;
  };
  const avgDaily = (end: string, n: number): number => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += byDay.get(addDays(end, -i))?.size ?? 0;
    return sum / n;
  };

  const week = activeIn(today, 7);
  const month = activeIn(today, 30);
  const firstIn = (start: string, end: string) =>
    Array.from(firstSeen.values()).filter((d) => d >= start && d <= end).length;

  const series: Usage["series"] = [];
  for (let i = 89; i >= 0; i--) {
    const day = addDays(today, -i);
    series.push({ day, dau: byDay.get(day)?.size ?? 0, wau: activeIn(day, 7).size, mau: activeIn(day, 30).size });
  }

  const weekly: { week: string; count: number }[] = [];
  const thisWeek = weekOf(today);
  for (let i = 11; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i);
    weekly.push({ week: start, count: firstIn(start, addDays(start, 6)) });
  }

  // Activation: arrived 8 to 37 days ago, so each had a full first week.
  let cohortUsers = 0;
  let activated = 0;
  for (const [user, first] of firstSeen) {
    if (first < addDays(today, -37) || first > addDays(today, -8)) continue;
    cohortUsers++;
    const days = actions.get(user);
    if (days && Array.from(days.keys()).some((d) => d >= first && d <= addDays(first, 6))) activated++;
  }

  const adoption = ACTION_KINDS.map((kind) => {
    let users = 0;
    for (const u of month) {
      const days = actions.get(u);
      if (!days) continue;
      for (const [d, kinds] of days) {
        if (d > addDays(today, -30) && d <= today && kinds.has(kind)) {
          users++;
          break;
        }
      }
    }
    return { kind, users };
  });

  // Weekly cohorts: who arrived in each of the last 8 weeks, and the share
  // of them active in each week after. Week 0 is everyone, by definition.
  const userDays = new Map<string, Set<string>>();
  for (const r of rows) {
    let s = userDays.get(r.user);
    if (!s) userDays.set(r.user, (s = new Set()));
    s.add(r.day);
  }
  const cohorts: Usage["cohorts"] = [];
  for (let c = COHORT_WEEKS - 1; c >= 0; c--) {
    const start = addDays(thisWeek, -7 * c);
    const members = Array.from(firstSeen.entries())
      .filter(([, d]) => d >= start && d <= addDays(start, 6))
      .map(([u]) => u);
    const retention: (number | null)[] = [];
    for (let k = 0; k < COHORT_WEEKS; k++) {
      const ws = addDays(start, 7 * k);
      if (ws > today) {
        retention.push(null);
        continue;
      }
      const we = addDays(ws, 6);
      const back = members.filter((u) => Array.from(userDays.get(u) ?? []).some((d) => d >= ws && d <= we)).length;
      retention.push(members.length ? back / members.length : null);
    }
    cohorts.push({ week: start, size: members.length, retention });
  }

  const avgDau30 = avgDaily(today, 30);
  return {
    dau: { value: avgDaily(today, 7), previous: avgDaily(addDays(today, -7), 7) },
    wau: { value: week.size, previous: activeIn(addDays(today, -7), 7).size },
    mau: { value: month.size, previous: activeIn(addDays(today, -30), 30).size },
    wauNew: Array.from(week).filter((u) => (firstSeen.get(u) ?? "") > addDays(today, -7)).length,
    stickiness: month.size ? avgDau30 / month.size : null,
    series,
    newUsers: {
      value: firstIn(addDays(today, -29), today),
      previous: firstIn(addDays(today, -59), addDays(today, -30)),
      weekly,
    },
    activation: { users: cohortUsers, activated },
    adoption,
    cohorts,
  };
}
