import type { ScanMetrics } from "@/lib/metrics/scanMath";
import { ABANDONED_AFTER_MS } from "@/lib/metrics/scanMath";

// The scanner's usage, as the metrics page shows it: who uses it, how often
// it was down, how far people get, and where it fails. Counts and fixed
// codes only (src/lib/scanTracking.ts); the figures come from scanMath.ts.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const pct = (x: number | null) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
const one = (x: number | null) => (x == null ? "n/a" : Number.isInteger(x) ? String(x) : x.toFixed(1));
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

const CODE_LABEL: Record<string, string> = {
  "no-text": "no text found in the image",
  down: "scanner down",
  unsupported: "format not supported",
  "too-large": "image too large",
  "rate-limited": "too many scans",
  empty: "empty upload",
  network: "request never reached the server",
  "prep-failed": "image could not be prepared",
  "zero-items": "no items read",
  invalid: "save refused: something to fix",
  refused: "save refused: not allowed",
  error: "save failed on the server",
  "not-configured": "scanner not configured",
  unreachable: "laptop or tunnel unreachable",
  timeout: "timed out",
  refused_: "",
};
const label = (code: string) => {
  const [head, rest] = code.split(": ");
  return rest ? `${CODE_LABEL[head] ?? head}: ${CODE_LABEL[rest] ?? rest}` : (CODE_LABEL[code] ?? code);
};

function Tile({ label: l, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{l}</div>
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

/** A small bar: how much of the whole, with the number beside it. */
function Bar({ value, tone = "bg-primary" }: { value: number | null; tone?: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-ink/10">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%` }} />
    </div>
  );
}

export function ScanSections({ scan }: { scan: ScanMetrics | null }) {
  if (!scan) {
    return (
      <Section title="Scanner usage">
        <div className="alert-warning">Not being recorded yet: apply db/2026_10_scan_events.sql to the database.</div>
      </Section>
    );
  }
  const s = scan;
  const win = `last ${s.windowDays} days`;
  const mid = Math.round(ABANDONED_AFTER_MS / 60_000);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Scanner usage</h2>
        <p className="text-sm text-muted">
          Receipts and order screenshots, {win}. An attempt runs from opening the scanner to saving or leaving. Counts and fixed codes only:
          no images, text, amounts or names are recorded.
        </p>
      </div>

      {s.tracking.dropped > 0 ? (
        <div className="alert-warning">
          Tracking lost {s.tracking.dropped} event{s.tracking.dropped === 1 ? "" : "s"} in this period (the database refused them, or a user hit the daily
          cap), so the numbers below are slightly low.
        </div>
      ) : null}

      <Section title="1. Who uses it">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Users today" value={String(s.usage.today)} />
          <Tile label="Users, last 7 days" value={String(s.usage.week)} />
          <Tile label={`Users, ${win}`} value={String(s.usage.month)}>
            <div className="metric-delta">
              {s.usage.share ? `${pct(s.usage.share.pct)} of the ${s.usage.share.active} people who opened the app` : "Share of all users: visits not tracked"}
            </div>
          </Tile>
          <Tile label="New to the scanner" value={String(s.usage.newUsers)}>
            <div className="metric-delta">{s.usage.returningUsers} returning</div>
          </Tile>
          <Tile label="Attempts" value={String(s.attempts)} />
          <Tile label="Attempts per user" value={one(s.usage.attemptsPerUser)} />
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Day</th><th>Users</th><th>Attempts</th></tr>
            </thead>
            <tbody>
              {s.usage.daily.map((d) => (
                <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{d.users}</td><td>{d.attempts}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="2. How often it was down" note="Asked each time the scanner is opened. The laptop being off and the tunnel dropping look the same from here.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Down when opened" value={String(s.availability.down)}>
            <div className="metric-delta">of {s.availability.checks} checks</div>
          </Tile>
          <Tile label="Down rate" value={pct(s.availability.downRate)} />
          <Tile label="People who hit it" value={String(s.availability.usersHit)} />
          <Tile label="Went down mid-scan" value={String(s.availability.midScan)}>
            <div className="metric-delta">was up when opened</div>
          </Tile>
        </div>
        {s.availability.reasons.length > 0 ? (
          <p className="text-sm text-muted">
            Why: {s.availability.reasons.map((r) => `${label(r.reason)} (${r.n})`).join(", ")}.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Day</th><th>Checks</th><th>Down</th></tr>
            </thead>
            <tbody>
              {s.availability.daily.map((d) => (
                <tr key={d.day} className={d.down > 0 ? "text-warning" : ""}><td>{dayLabel(d.day)}</td><td>{d.checks}</td><td>{d.down}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="3. From image to expense in one go">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Saved end to end" value={pct(s.endToEnd.rate)}>
            <div className="metric-delta">{s.endToEnd.saved} of {s.attempts} attempts</div>
          </Tile>
          <Tile label="When the scanner was up" value={pct(s.endToEnd.ratePerUp)}>
            <div className="metric-delta">leaves out attempts that found it down</div>
          </Tile>
          <Tile label="Clean success" value={pct(s.clean.rate)}>
            <div className="metric-delta">{s.clean.saved}: no failure, one read, one save</div>
          </Tile>
        </div>
        <ul className="space-y-2">
          {s.funnel.map((f) => (
            <li key={f.key} className="space-y-1">
              <div className="flex justify-between gap-3 text-sm">
                <span>{f.label}</span>
                <span className="font-semibold">
                  {f.attempts} <span className="font-normal text-muted">({pct(f.pctOfOpened)}{f.dropOff != null && f.dropOff > 0 ? `, lost ${pct(f.dropOff)} here` : ""})</span>
                </span>
              </div>
              <Bar value={f.pctOfOpened} />
            </li>
          ))}
        </ul>
        <div className="text-sm">
          <span className="font-semibold">Abandoned: {s.abandoned.attempts}</span>{" "}
          <span className="text-muted">({pct(s.abandoned.rate)}): not saved and still for {mid} minutes. Last step reached: </span>
          {s.abandoned.lastStage.length ? s.abandoned.lastStage.map((l) => `${l.stage} (${l.n})`).join(", ") : "none"}.
        </div>
      </Section>

      <Section title="4. Where it fails" note="Per stage, as a share of the times that stage ran. Warnings are not failures: the read worked but looked shaky.">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Stage</th><th>Ran</th><th>Failed</th><th>Rate</th><th>Why</th></tr>
            </thead>
            <tbody>
              {s.failures.map((f) => (
                <tr key={f.stage} className={f.failed > 0 ? "" : "text-muted"}>
                  <td>{f.label}</td>
                  <td>{f.total}</td>
                  <td>{f.failed}</td>
                  <td>{pct(f.rate)}</td>
                  <td>
                    {[...f.codes.map((c) => `${label(c.code)} (${c.n})`), ...f.warnings.map((w) => `warning: ${w.code} (${w.n})`)].join(", ") || "none"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.byApp.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>From</th><th>Attempts</th><th>Saved</th><th>Saved rate</th><th>Images that failed</th></tr>
              </thead>
              <tbody>
                {s.byApp.map((a) => (
                  <tr key={a.app}><td>{a.app}</td><td>{a.attempts}</td><td>{a.saved}</td><td>{pct(a.savedRate)}</td><td>{a.failedScans}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Section title="Quality" note="How much people fix after the scan, and how long it takes.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Items edited per saved attempt" value={one(s.quality.edited)} />
          <Tile label="Items removed per saved attempt" value={one(s.quality.removed)} />
          <Tile label="Items added by hand per saved attempt" value={one(s.quality.added)} />
          <Tile label="Re-reads per attempt" value={one(s.quality.rescansPerAttempt)}>
            <div className="metric-delta">screenshots added after the first read</div>
          </Tile>
          <Tile label="Scan time, median" value={s.quality.scanMs ? secs(s.quality.scanMs.median) : "n/a"}>
            <div className="metric-delta">{s.quality.scanMs ? `90th percentile ${secs(s.quality.scanMs.p90)}, ${s.quality.scanMs.n} image${s.quality.scanMs.n === 1 ? "" : "s"}` : "No scans yet"}</div>
          </Tile>
        </div>
      </Section>
    </div>
  );
}
