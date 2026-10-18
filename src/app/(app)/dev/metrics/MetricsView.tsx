import Link from "next/link";
import type { Metrics } from "@/lib/metrics/queries";
import type { Window } from "@/lib/metrics/math";
import { formatINR } from "@/lib/format";
import { ActiveUsersChart, CountBars, ExpenseSourcesChart } from "./MetricsCharts";

// The metrics page's content, given the loaded numbers (page.tsx loads them).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const pct = (x: number | null) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
const whole = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const KIND_LABEL: Record<string, string> = {
  expense: "Added or edited expenses",
  receipt: "Scanned a receipt",
  statement: "Imported a card statement",
  settlement: "Settled up",
  group: "Created or joined a group",
  invite: "Invited someone",
};

/** "+3 (+25%)" against the previous period, with a word, not only a colour. */
function Change({ w, period, money }: { w: Window; period: string; money?: boolean }) {
  const diff = w.value - w.previous;
  const fmt = (n: number) => (money ? formatINR(Math.abs(n)) : whole(Math.abs(n)));
  if (w.previous === 0 && w.value === 0) return <div className="metric-delta">No change vs previous {period}</div>;
  if (w.previous === 0) return <div className="metric-delta">Up from 0 the previous {period}</div>;
  const rate = diff / w.previous;
  const tone = diff > 0 ? "text-positive" : diff < 0 ? "text-negative" : "text-muted";
  const word = diff > 0 ? "Up" : diff < 0 ? "Down" : "Flat";
  return (
    <div className={`metric-delta ${tone}`}>
      {diff > 0 ? "▲" : diff < 0 ? "▼" : "▬"} {word} {fmt(diff)} ({Math.round(Math.abs(rate) * 100)}%) vs previous {period}
    </div>
  );
}

function Tile({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {children}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="section-title">{title}</h2>
        {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function MetricsView({ m }: { m: Metrics }) {
  const u = m.usage;
  const g = m.groups;
  const answered = g.invites.accepted + g.invites.declined;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1>Product metrics</h1>
        <p className="text-sm text-muted">
          As of {dayLabel(m.today)} (India time). Active means opened the app or did something in it.{" "}
          {m.includesDevelopers ? "Includes developers' own use." : "Developers' own use is left out."}{" "}
          <Link href={m.includesDevelopers ? "/dev/metrics" : "/dev/metrics?dev=1"} className="text-primary-light hover:underline">
            {m.includesDevelopers ? "Leave developers out" : "Include developers"}
          </Link>
          {" · "}
          <Link href="/dev/scan" className="text-primary-light hover:underline">Scan inspector</Link>
        </p>
      </div>

      {!m.visitsTracked ? (
        <div className="alert-warning">
          Visits are not being recorded yet: apply db/2026_10_user_activity.sql. Until then, active users only count people who signed in or did
          something, so anyone who only looked is missed.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Total users" value={String(m.totalUsers)}>
          <div className="metric-delta">Everyone who ever signed up</div>
        </Tile>
        <Tile label="New users, last 30 days" value={String(u.newUsers.value)}>
          <Change w={u.newUsers} period="30 days" />
        </Tile>
        <Tile label="Weekly active users" value={String(u.wau.value)}>
          <Change w={u.wau} period="7 days" />
        </Tile>
        <Tile label="Monthly active users" value={String(u.mau.value)}>
          <Change w={u.mau} period="30 days" />
        </Tile>
        <Tile label="Daily active users (7-day average)" value={whole(u.dau.value)}>
          <Change w={u.dau} period="7 days" />
        </Tile>
        <Tile label="Stickiness (DAU / MAU)" value={pct(u.stickiness)}>
          <div className="metric-delta">
            {u.stickiness == null ? "No active users yet" : `About ${Math.max(1, Math.round(u.stickiness * 30))} of 30 days, per active user`}
          </div>
        </Tile>
      </div>

      <Section
        title="Active users, last 90 days"
        note={`Of this week's ${u.wau.value} active users, ${u.wauNew} are new this week and ${u.wau.value - u.wauNew} came back.`}
      >
        <ActiveUsersChart data={u.series} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="New users per week" note="By the week each person was first seen.">
          <CountBars data={u.newUsers.weekly.map((w) => ({ at: w.week, count: w.count }))} label="new users" period="week" />
        </Section>

        <Section title="Activation" note="New users of 8 to 37 days ago who did something (not just looked) in their first 7 days.">
          <div className="metric-value text-3xl">{u.activation.users ? pct(u.activation.activated / u.activation.users) : "n/a"}</div>
          <div className="text-sm text-muted">
            {u.activation.activated} of {u.activation.users} new users. The rest signed up and only looked: they are the ones onboarding is losing.
          </div>
        </Section>
      </div>

      <Section title="What active users do" note="Share of the last 30 days' active users who did each at least once.">
        <ul className="space-y-2">
          {u.adoption.map((a) => {
            const share = u.mau.value ? a.users / u.mau.value : 0;
            return (
              <li key={a.kind} className="space-y-1">
                <div className="flex justify-between gap-3 text-sm">
                  <span>{KIND_LABEL[a.kind]}</span>
                  <span className="font-semibold">
                    {pct(u.mau.value ? share : null)} <span className="font-normal text-muted">({a.users})</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink/5">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title="Retention by sign-up week"
        note="Each row is the people first seen that week; each column the share of them active N weeks later. Read down a column to see if newer users stick better."
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Week of</th>
                <th>Users</th>
                {u.cohorts[0]?.retention.map((_, k) => <th key={k}>W{k}</th>)}
              </tr>
            </thead>
            <tbody>
              {u.cohorts.map((c) => (
                <tr key={c.week}>
                  <td className="whitespace-nowrap">{dayLabel(c.week)}</td>
                  <td>{c.size}</td>
                  {c.retention.map((r, k) => (
                    <td
                      key={k}
                      className="text-center tabular-nums"
                      // One hue, light to dark with the share; text stays ink.
                      style={r != null && c.size ? { background: `rgb(var(--c-primary) / ${(0.08 + r * 0.47).toFixed(2)})` } : undefined}
                    >
                      {r == null || !c.size ? "" : pct(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Groups" note="Groups are how Ledger spreads: one person invites the people they share costs with.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Groups" value={String(g.total)}>
            <div className="metric-delta">{g.shared} shared (2+ members)</div>
          </Tile>
          <Tile label="Active groups, last 30 days" value={String(g.active)}>
            <Change w={{ value: g.active, previous: g.activePrevious }} period="30 days" />
          </Tile>
          <Tile label="Members per group" value={g.total ? g.avgMembers.toFixed(1) : "n/a"}>
            <div className="metric-delta">Average</div>
          </Tile>
          <Tile label="Invites accepted, 90 days" value={answered ? pct(g.invites.accepted / answered) : "n/a"}>
            <div className="metric-delta">
              {g.invites.sent} sent: {g.invites.accepted} accepted, {g.invites.declined} declined, {g.invites.pending} waiting
            </div>
          </Tile>
        </div>
        <div className="text-sm font-semibold">New groups per month</div>
        <CountBars data={g.createdMonthly.map((x) => ({ at: x.month, count: x.count }))} label="new groups" period="month" />
      </Section>

      <Section title="Expenses added per week" note="Where expenses come from shows which features carry the work.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Amount added, last 30 days" value={formatINR(m.amountAdded.value)}>
            <Change w={m.amountAdded} period="30 days" money />
          </Tile>
        </div>
        <ExpenseSourcesChart data={m.expensesWeekly} />
      </Section>
    </div>
  );
}
