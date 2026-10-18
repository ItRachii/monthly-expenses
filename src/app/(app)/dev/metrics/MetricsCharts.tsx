"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Series colours: the first three of the app's validated category palette
// (src/components/charts/Charts.tsx), checked again here against both the
// light and the dark surface with the dataviz skill's validator.
const BLUE = "#3987e5";
const ORANGE = "#d95926";
const GREEN = "#199e70";
const MUTED = "rgb(var(--c-muted))";
const GRID = "rgb(var(--c-ink) / 0.08)";
const tooltipBox = "rounded-lg border border-ink/10 bg-surface px-3 py-2 text-sm shadow-xl";
const axis = { tick: { fill: MUTED, fontSize: 12 }, tickLine: false, axisLine: false } as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-18" -> "18 Oct". */
export const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} '${m.slice(2, 4)}`;

interface Series {
  key: string;
  label: string;
  color: string;
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function SeriesTooltip({
  active,
  payload,
  title,
  series,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, number | string> }>;
  title: (row: Record<string, number | string>) => string;
  series: Series[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className={`${tooltipBox} min-w-[9rem]`}>
      <div className="mb-1 text-muted">{title(row)}</div>
      {series.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-muted">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
            {s.label}
          </span>
          <span className="font-semibold">{row[s.key]}</span>
        </div>
      ))}
    </div>
  );
}

const ACTIVE: Series[] = [
  { key: "mau", label: "Monthly (30 days)", color: BLUE },
  { key: "wau", label: "Weekly (7 days)", color: ORANGE },
  { key: "dau", label: "Daily", color: GREEN },
];

/** Daily, weekly and monthly active users over the last 90 days: one unit, one axis. */
export function ActiveUsersChart({ data }: { data: { day: string; dau: number; wau: number; mau: number }[] }) {
  return (
    <div className="space-y-2">
      <Legend series={ACTIVE} />
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="4 4" />
            <XAxis dataKey="day" tickFormatter={dayLabel} minTickGap={28} {...axis} />
            <YAxis allowDecimals={false} width={32} {...axis} />
            <Tooltip
              cursor={{ stroke: "rgb(var(--c-ink) / 0.2)" }}
              content={<SeriesTooltip title={(r) => dayLabel(String(r.day))} series={ACTIVE} />}
            />
            {ACTIVE.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** One series of counts per period (sign-ups per week, groups per month). */
export function CountBars({
  data,
  label,
  period,
}: {
  data: { at: string; count: number }[];
  label: string;
  period: "week" | "month";
}) {
  const fmt = period === "week" ? (d: string) => dayLabel(d) : monthLabel;
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="4 4" />
          <XAxis dataKey="at" tickFormatter={fmt} minTickGap={12} {...axis} />
          <YAxis allowDecimals={false} width={32} {...axis} />
          <Tooltip
            cursor={{ fill: "rgb(var(--c-ink) / 0.04)" }}
            content={({ active, payload }) => {
              const d = active ? (payload?.[0]?.payload as { at: string; count: number } | undefined) : undefined;
              if (!d) return null;
              return (
                <div className={tooltipBox}>
                  <div className="text-muted">{period === "week" ? `Week of ${dayLabel(d.at)}` : monthLabel(d.at)}</div>
                  <div className="font-semibold">
                    {d.count} {label}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="count" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const SOURCES: Series[] = [
  { key: "manual", label: "Typed in", color: BLUE },
  { key: "receipt", label: "Receipt scan", color: ORANGE },
  { key: "statement", label: "Statement import", color: GREEN },
];

/** Expenses added per week, stacked by where they came from. */
export function ExpenseSourcesChart({ data }: { data: { week: string; manual: number; receipt: number; statement: number }[] }) {
  return (
    <div className="space-y-2">
      <Legend series={SOURCES} />
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="4 4" />
            <XAxis dataKey="week" tickFormatter={dayLabel} minTickGap={12} {...axis} />
            <YAxis allowDecimals={false} width={32} {...axis} />
            <Tooltip
              cursor={{ fill: "rgb(var(--c-ink) / 0.04)" }}
              content={<SeriesTooltip title={(r) => `Week of ${dayLabel(String(r.week))}`} series={[...SOURCES].reverse()} />}
            />
            {SOURCES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="src"
                fill={s.color}
                // A surface-coloured gap between stacked segments.
                stroke="rgb(var(--c-surface))"
                strokeWidth={2}
                radius={i === SOURCES.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={28}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
