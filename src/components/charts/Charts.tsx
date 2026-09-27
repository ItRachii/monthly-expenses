"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "@/lib/format";
import { TrendingDownIcon, TrendingUpIcon } from "@/components/Icons";

// ---------------------------------------------------------------------------
// Shared category palette.
//
// Colour follows the category everywhere on the Summary tab (trend, donut,
// bars), never its rank within a month: the seven biggest categories over
// the whole history get seven fixed hues and everything else is the grey
// "Other". Validated with the dataviz skill's validate_palette.js against
// the card surface #1C1F26 (dark): lightness, CVD and normal-vision
// separation of neighbours, and 3:1 contrast all pass; "Other" is grey on
// purpose, so only its chroma check fails.
const HUES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"];
export const OTHER = "Other";
const OTHER_HUE = "#6e737d";
const MUTED = "#8B9DB8";
const INK = "#FAFAFA";
const GRID = "rgba(255,255,255,0.08)";

export interface Palette {
  /** The named categories, biggest first. Anything else is "Other". */
  named: string[];
  colourOf: (category: string) => string;
  /** Maps a category to itself when named, otherwise to "Other". */
  bucket: (category: string) => string;
}

export const categoryName = (c: string) => c.trim() || "Uncategorised";

export function buildPalette(rows: { category: string; amount: number }[]): Palette {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const c = categoryName(r.category);
    totals.set(c, (totals.get(c) ?? 0) + r.amount);
  }
  const named = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, HUES.length)
    .map(([c]) => c);
  const hue = new Map(named.map((c, i) => [c, HUES[i]]));
  const bucket = (c: string) => (hue.has(categoryName(c)) ? categoryName(c) : OTHER);
  return { named, colourOf: (c) => hue.get(categoryName(c)) ?? OTHER_HUE, bucket };
}

// ---------------------------------------------------------------------------
// Formatting.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function monthShort(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} '${y.slice(2)}`;
}

/** ₹1.2k / ₹15k / ₹1.1L: short enough for axis ticks and caps. */
function compactINR(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(n >= 1000000 ? 0 : 1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(n)}`;
}

const tooltipBox = "rounded-lg border border-white/10 bg-surface px-3 py-2 text-sm shadow-xl";

/** Card chrome shared by the three charts: title left, optional control right. */
function ChartCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card space-y-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Swatch({ colour }: { colour: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colour }} />;
}

// ---------------------------------------------------------------------------
// Summary card: title, big amount with small decimals, sparkline, and the
// change against the previous month.

function Sparkline({ values, colour }: { values: number[]; colour: string }) {
  const W = 96;
  const H = 40;
  if (values.length < 2) return <div style={{ width: W, height: H }} aria-hidden />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (W - 4) + 2,
    H - 4 - ((v - min) / span) * (H - 8),
  ]);
  // Catmull-Rom through the points, as cubic Beziers: a smooth line that
  // still passes through every month's value.
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] ?? pts[i];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[i + 2] ?? pts[i + 1];
    d += ` C${x1 + (x2 - x0) / 6},${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6},${y2 - (y3 - y1) / 6} ${x2},${y2}`;
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

export function StatCard({
  title,
  value,
  history,
  previous,
  tone,
  money = true,
}: {
  title: string;
  value: number;
  /** Values for the sparkline, oldest first, ending with this month. */
  history: number[];
  /** Last month's value, or null when there is no earlier month. */
  previous: number | null;
  /** "spend": up is red, down is green. "neutral": direction only. */
  tone: "spend" | "neutral";
  money?: boolean;
}) {
  const [whole, frac] = (money ? inr.format(value) : String(value)).split(".");
  const change = previous && previous > 0 ? ((value - previous) / previous) * 100 : null;
  const up = change !== null && change > 0;
  const colour =
    change === null || Math.abs(change) < 0.05
      ? MUTED
      : tone === "neutral"
        ? MUTED
        : up
          ? "#f87171"
          : "#34d399";
  const Arrow = up ? TrendingUpIcon : TrendingDownIcon;

  return (
    <div className="card flex min-w-0 flex-col gap-3">
      <div className="truncate text-sm text-muted">{title}</div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-2xl font-semibold tabular-nums">
          {money ? "₹" : ""}
          {whole}
          {frac ? <span className="text-sm font-medium text-muted">.{frac}</span> : null}
        </div>
        <Sparkline values={history} colour={colour === MUTED ? "#4C72B0" : colour} />
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        {change === null ? (
          <span className="text-muted">No earlier month to compare</span>
        ) : (
          <>
            <span className="flex items-center gap-1 font-semibold" style={{ color: colour }}>
              <Arrow className="h-4 w-4" />
              {Math.abs(change).toFixed(1)}%
            </span>
            <span className="text-muted">vs last month</span>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly trend: one column per month, category segments stacked on top of
// each other, each segment its own rounded block with a gap between them.

type TrendRow = { month: string; total: number } & Record<string, number | string>;

function buildTrend(rows: { date: string; category: string; amount: number }[], palette: Palette) {
  const hasOther = rows.some((r) => palette.bucket(r.category) === OTHER);
  const keys = hasOther ? [...palette.named, OTHER] : [...palette.named];
  const byMonth = new Map<string, TrendRow>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    let row = byMonth.get(month);
    if (!row) {
      row = { month, total: 0 } as TrendRow;
      for (const k of keys) row[k] = 0;
      byMonth.set(month, row);
    }
    const k = palette.bucket(r.category);
    row[k] = Math.round(((row[k] as number) + r.amount) * 100) / 100;
    row.total = Math.round((row.total + r.amount) * 100) / 100;
  }
  return { data: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)), keys };
}

function TrendTooltip({
  active,
  label,
  payload,
  keys,
  palette,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ payload: TrendRow }>;
  keys: string[];
  palette: Palette;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  // Top of the stack first, so the list reads in the same order as the column.
  const lines = [...keys].reverse().filter((k) => (row[k] as number) > 0);
  return (
    <div className={`${tooltipBox} min-w-[11rem]`}>
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <span className="text-muted">{label ? monthShort(label) : ""}</span>
        <span className="font-semibold">{formatINR(row.total)}</span>
      </div>
      {lines.map((k) => (
        <div key={k} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-muted">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: palette.colourOf(k) }} />
            {k}
          </span>
          <span className="font-semibold">{formatINR(row[k] as number)}</span>
        </div>
      ))}
    </div>
  );
}

const RANGES = [
  { id: "6", label: "Last 6 months", months: 6 },
  { id: "12", label: "Last 12 months", months: 12 },
  { id: "all", label: "All time", months: Infinity },
] as const;
const SEGMENT_GAP = 3;
const SEGMENT_RADIUS = 6;

export function MonthlyTrend({
  rows,
  palette,
}: {
  rows: { date: string; category: string; amount: number }[];
  palette: Palette;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("12");
  const { data: all, keys } = useMemo(() => buildTrend(rows, palette), [rows, palette]);
  const months = RANGES.find((r) => r.id === range)?.months ?? Infinity;
  const data = Number.isFinite(months) ? all.slice(-months) : all;
  const capEvery = data.length > 12 ? 2 : 1;

  return (
    <ChartCard
      title="Monthly trend"
      action={
        <select
          aria-label="Time range"
          className="select w-auto py-1.5 text-xs"
          value={range}
          onChange={(e) => setRange(e.target.value as typeof range)}
        >
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      }
    >
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 18, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="4 4" />
            <XAxis
              dataKey="month"
              tickFormatter={monthShort}
              tick={{ fill: MUTED, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis tickFormatter={compactINR} tick={{ fill: MUTED, fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<TrendTooltip keys={keys} palette={palette} />} />
            {keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="month"
                fill={palette.colourOf(k)}
                maxBarSize={64}
                isAnimationActive={false}
                // Each segment is its own rounded block, inset to leave a gap
                // to its neighbours in the stack.
                shape={(props: unknown) => {
                  const p = props as { x: number; y: number; width: number; height: number; fill: string };
                  const h = p.height - SEGMENT_GAP;
                  if (!(h > 0)) return <g />;
                  return (
                    <Rectangle
                      x={p.x}
                      y={p.y + SEGMENT_GAP / 2}
                      width={p.width}
                      height={h}
                      fill={p.fill}
                      radius={Math.min(SEGMENT_RADIUS, h / 2, p.width / 2)}
                    />
                  );
                }}
              >
                {i === keys.length - 1 ? (
                  <LabelList
                    dataKey="total"
                    position="top"
                    content={(props: unknown) => {
                      const lp = props as { x?: unknown; y?: unknown; width?: unknown; value?: unknown; index?: number };
                      return (lp.index ?? 0) % capEvery === (data.length - 1) % capEvery ? (
                        <text
                          x={Number(lp.x) + Number(lp.width) / 2}
                          y={Number(lp.y) - 6}
                          textAnchor="middle"
                          fill={MUTED}
                          fontSize={11}
                        >
                          {compactINR(Number(lp.value))}
                        </text>
                      ) : null;
                    }}
                  />
                ) : null}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend in stack order: biggest first = bottom of every column. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {keys.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <Swatch colour={palette.colourOf(k)} />
            {k}
          </li>
        ))}
      </ul>

      <details className="text-sm">
        <summary className="cursor-pointer select-none text-xs text-muted hover:text-ink">View as table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                {keys.map((k) => (
                  <th key={k} className="text-right">
                    {k}
                  </th>
                ))}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((row) => (
                <tr key={row.month}>
                  <td className="whitespace-nowrap">{monthShort(row.month)}</td>
                  {keys.map((k) => (
                    <td key={k} className="text-right tabular-nums">
                      {(row[k] as number) > 0 ? formatINR(row[k] as number) : "-"}
                    </td>
                  ))}
                  <td className="text-right font-semibold tabular-nums">{formatINR(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Donut: this month by category, same colours as the trend. Categories
// outside the named seven fold into one "Other" slice.

const DONUT_INNER = 50;
const DONUT_OUTER = 72;
const RAD = Math.PI / 180;

interface CalloutProps {
  cx: number;
  cy: number;
  midAngle: number;
  outerRadius: number;
  index: number;
  value: number;
}

/**
 * Value callout for one slice, drawn outside the ring: a leader line from the
 * slice's middle, then the amount (ink) over its share (muted). Rendered only
 * for the slice being hovered or selected.
 */
function DonutCallout({
  cx,
  cy,
  midAngle,
  outerRadius,
  index,
  value,
  shown,
  colour,
  percent,
}: CalloutProps & { shown: number | null; colour: string; percent: number }) {
  if (index !== shown) return <g />;
  const cos = Math.cos(-midAngle * RAD);
  const sin = Math.sin(-midAngle * RAD);
  const right = cos >= 0;
  const sx = cx + (outerRadius + 3) * cos;
  const sy = cy + (outerRadius + 3) * sin;
  const mx = cx + (outerRadius + 14) * cos;
  const my = cy + (outerRadius + 14) * sin;
  const ex = mx + (right ? 10 : -10);
  const tx = ex + (right ? 5 : -5);
  const anchor = right ? "start" : "end";
  return (
    <g pointerEvents="none">
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${my}`} stroke={colour} strokeWidth={1.5} fill="none" />
      <circle cx={ex} cy={my} r={2.5} fill={colour} />
      <text x={tx} y={my} dy={-2} textAnchor={anchor} fill={INK} fontSize={13} fontWeight={600}>
        {compactINR(value)}
      </text>
      <text x={tx} y={my} dy={13} textAnchor={anchor} fill={MUTED} fontSize={11}>
        {percent.toFixed(percent < 10 ? 1 : 0)}%
      </text>
    </g>
  );
}

export function CategoryDonut({
  rows,
  palette,
  selected,
  onSelect,
  onClear,
}: {
  rows: { category: string; amount: number }[];
  palette: Palette;
  selected: string | null;
  onSelect: (category: string) => void;
  /** Clears the selection: a click on the chart that misses every slice. */
  onClear: () => void;
}) {
  const data = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = palette.bucket(r.category);
      m.set(k, (m.get(k) ?? 0) + r.amount);
    }
    return Array.from(m, ([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => (a.category === OTHER ? 1 : b.category === OTHER ? -1 : b.amount - a.amount));
  }, [rows, palette]);
  const total = data.reduce((s, d) => s + d.amount, 0);
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  // The slice whose value is called out: the hovered one, else the selected
  // one (so a tap on a phone, where there is no hover, still shows it).
  const [hover, setHover] = useState<number | null>(null);
  const selectedIndex = selected ? data.findIndex((d) => d.category === selected) : -1;
  const shown = hover ?? (selectedIndex >= 0 ? selectedIndex : null);
  const dimmed = (i: number) =>
    hover !== null ? hover !== i : Boolean(selected) && data[i]?.category !== selected;

  return (
    <ChartCard title="Where it went">
      <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col 2xl:flex-row">
        {/* The ring is drawn smaller than the box so the hover callout has
            room outside it instead of covering the centre. */}
        <div
          className="relative h-64 w-80 max-w-full shrink-0"
          // A click anywhere in the chart that is not on a slice (the hole,
          // the space around the ring) removes the filter.
          onClick={(e) => {
            if (!(e.target as Element).closest(".recharts-sector")) onClear();
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="amount"
                nameKey="category"
                innerRadius={DONUT_INNER}
                outerRadius={DONUT_OUTER}
                paddingAngle={data.length > 1 ? 2 : 0}
                cornerRadius={6}
                stroke="none"
                isAnimationActive={false}
                labelLine={false}
                label={(props: unknown) => (
                  <DonutCallout
                    {...(props as CalloutProps)}
                    shown={shown}
                    colour={palette.colourOf(data[(props as CalloutProps).index]?.category ?? OTHER)}
                    percent={pct(data[(props as CalloutProps).index]?.amount ?? 0)}
                  />
                )}
                onMouseEnter={(_, i) => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={(_, i) => data[i] && onSelect(data[i].category)}
              >
                {data.map((d, i) => (
                  <Cell
                    key={d.category}
                    fill={palette.colourOf(d.category)}
                    fillOpacity={dimmed(i) ? 0.3 : 1}
                    cursor="pointer"
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs text-muted">Total</span>
            <span className="text-lg font-semibold tabular-nums">{compactINR(total)}</span>
          </div>
        </div>

        <ul className="w-full min-w-0 space-y-0.5">
          {data.map((d, i) => {
            const on = selected === d.category;
            return (
              <li key={d.category}>
                <button
                  type="button"
                  onClick={() => onSelect(d.category)}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition hover:bg-white/5 ${
                    dimmed(i) ? "opacity-50" : ""
                  } ${on || hover === i ? "bg-white/5" : ""}`}
                >
                  <Swatch colour={palette.colourOf(d.category)} />
                  <span className="min-w-0 flex-1 truncate">{d.category}</span>
                  <span className="tabular-nums text-muted">{pct(d.amount).toFixed(0)}%</span>
                  <span className="w-14 text-right font-semibold tabular-nums">{compactINR(d.amount)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-xs text-muted">
        {selected
          ? "Tap the empty part of the chart, or the same slice again, to remove the filter."
          : "Tap a slice or a row to filter the expense detail."}
      </p>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Category bars: every category this month, biggest first, rounded bars in
// the shared colours (categories outside the named seven are grey; the axis
// label names them).

export function CategoryBars({
  rows,
  palette,
}: {
  rows: { category: string; amount: number }[];
  palette: Palette;
}) {
  const data = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const c = categoryName(r.category);
      m.set(c, (m.get(c) ?? 0) + r.amount);
    }
    return Array.from(m, ([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 })).sort(
      (a, b) => b.amount - a.amount,
    );
  }, [rows]);
  const height = Math.max(160, data.length * 34 + 16);

  return (
    <ChartCard title="By category">
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="4 4" />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="category"
              width={96}
              tick={{ fill: MUTED, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              content={({ active, payload }) => {
                const d = active ? (payload?.[0]?.payload as { category: string; amount: number } | undefined) : undefined;
                if (!d) return null;
                return (
                  <div className={tooltipBox}>
                    <div className="font-semibold">{formatINR(d.amount)}</div>
                    <div className="text-muted">{d.category}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="amount" radius={[0, 6, 6, 0]} maxBarSize={22} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.category} fill={palette.colourOf(d.category)} />
              ))}
              <LabelList
                dataKey="amount"
                position="right"
                formatter={(v: unknown) => compactINR(Number(v))}
                style={{ fill: INK, fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
