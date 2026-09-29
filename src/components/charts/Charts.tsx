"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { monthLabel } from "@/components/MonthSelect";
import { TrendingDownIcon, TrendingUpIcon } from "@/components/Icons";
import { DRAW_MS, useCountUp, useReducedMotion } from "./motion";

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
// Theme colours for SVG attributes and styles: CSS variables, so the charts
// follow the light or dark theme (globals.css, [data-theme]).
const MUTED = "rgb(var(--c-muted))";
const INK = "rgb(var(--c-ink))";
const GRID = "rgb(var(--c-ink) / 0.08)";
const RISE = "rgb(var(--c-negative))";
const FALL = "rgb(var(--c-positive))";
const PRIMARY = "rgb(var(--c-primary))";

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
  // A category literally called "Other" is never named: it joins the grey
  // overflow bucket, or the charts would draw two series called "Other".
  const named = Array.from(totals.entries())
    .filter(([c]) => c !== OTHER)
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

/** Exact rupees with Indian grouping: ₹1,23,456.78. */
export const exactINR = formatINR;

/** ₹1.2k / ₹15k / ₹1.1L: short enough for axis ticks and caps. */
function compactINR(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(n >= 1000000 ? 0 : 1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(n)}`;
}

const tooltipBox = "rounded-lg border border-ink/10 bg-surface px-3 py-2 text-sm shadow-xl";

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

// The strong curves from globals.css, for Recharts' own animations.
const STRONG_EASE_OUT = "cubic-bezier(0.23,1,0.32,1)" as const;
const STRONG_EASE_IN_OUT = "cubic-bezier(0.65,0,0.35,1)" as const;

/** Rupees that count up to their value (see useCountUp). */
function CountUpINR({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useCountUp(value, (n) => {
    if (ref.current) ref.current.textContent = exactINR(n);
  });
  return (
    <span ref={ref} className={className}>
      {exactINR(value)}
    </span>
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
  const id = useId();
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
  const [lx, ly] = pts[pts.length - 1];
  const area = `${d} L${lx},${H} L${pts[0][0]},${H} Z`;
  // Glass line: a soft glow under a crisp stroke, a tinted fill fading to
  // nothing, and a dot on this month. It draws left to right, then the fill
  // and the dot settle in (globals.css, .spark-*). Keyed on the values, so a
  // new month redraws it.
  return (
    <svg key={values.join(",")} width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity={0.28} />
          <stop offset="100%" stopColor={colour} stopOpacity={0} />
        </linearGradient>
        <filter id={`${id}-glow`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation={2.5} />
        </filter>
      </defs>
      <path className="spark-area" d={area} fill={`url(#${id}-fill)`} />
      <path className="spark-line" d={d} pathLength={1} fill="none" stroke={colour} strokeWidth={5} strokeOpacity={0.35} strokeLinecap="round" filter={`url(#${id}-glow)`} />
      <path className="spark-line" d={d} pathLength={1} fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" />
      <circle className="spark-dot" cx={lx} cy={ly} r={5} fill={colour} fillOpacity={0.25} />
      <circle className="spark-dot" cx={lx} cy={ly} r={2.5} fill={colour} />
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
  unit,
}: {
  title: string;
  value: number;
  /** Values for the sparkline, oldest first, ending with this month. */
  history: number[];
  /** Last month's value, or null when there is no earlier month. */
  previous: number | null;
  /** "spend": up is red, down is green. "gain": the reverse. "neutral": direction only. */
  tone: "spend" | "gain" | "neutral";
  money?: boolean;
  /** "percent": the value is a percent; the change is shown in percentage points. */
  unit?: "percent";
}) {
  const percent = unit === "percent";
  const text = (n: number) => (percent || !money ? String(Math.round(n)) : inr.format(n)).split(".");
  const [whole, frac] = text(value);
  // The figure counts up to its value when the tab opens, and from the old
  // figure to the new one when the month changes.
  const wholeRef = useRef<HTMLSpanElement>(null);
  const fracRef = useRef<HTMLSpanElement>(null);
  useCountUp(value, (n) => {
    const [w, f] = text(n);
    if (wholeRef.current) wholeRef.current.textContent = w;
    if (fracRef.current && f !== undefined) fracRef.current.textContent = `.${f}`;
  });
  const change = percent
    ? previous === null
      ? null
      : value - previous
    : previous && previous > 0
      ? ((value - previous) / previous) * 100
      : null;
  const up = change !== null && change > 0;
  const colour =
    change === null || Math.abs(change) < 0.05
      ? MUTED
      : tone === "neutral"
        ? MUTED
        : up === (tone === "spend")
          ? RISE
          : FALL;
  const Arrow = up ? TrendingUpIcon : TrendingDownIcon;

  return (
    // Phones fit two per row: tighter padding, smaller figure, and the
    // sparkline goes (the change line below still says which way it moved).
    <div className="card flex min-w-0 flex-col gap-3 max-sm:gap-2 max-sm:p-4">
      <div className="truncate text-sm text-muted max-sm:text-xs">{title}</div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-2xl font-semibold tabular-nums max-sm:text-lg">
          {money && !percent ? "₹" : ""}
          <span ref={wholeRef}>{whole}</span>
          {frac ? (
            <span ref={fracRef} className="text-sm font-medium text-muted">
              .{frac}
            </span>
          ) : null}
          {percent ? "%" : ""}
        </div>
        <div className="max-sm:hidden">
          <Sparkline values={history} colour={colour === MUTED ? PRIMARY : colour} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        {change === null ? (
          <span className="text-muted">No earlier month</span>
        ) : (
          <>
            <span className="flex items-center gap-1 font-semibold" style={{ color: colour }}>
              <Arrow className="h-4 w-4" />
              {percent ? `${Math.abs(change)} pts` : `${Math.abs(change).toFixed(1)}%`}
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
        <span className="text-muted">{label ? monthLabel(label) : ""}</span>
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
  const reduced = useReducedMotion();

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
            <Tooltip cursor={{ fill: "rgb(var(--c-ink) / 0.04)" }} content={<TrendTooltip keys={keys} palette={palette} />} />
            {keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="month"
                fill={palette.colourOf(k)}
                maxBarSize={64}
                // Columns rise from the axis, each category a beat after the
                // one below it, so every month visibly adds up.
                isAnimationActive={!reduced}
                animationBegin={i * 70}
                animationDuration={DRAW_MS - 150}
                animationEasing={STRONG_EASE_OUT}
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
                  <td className="whitespace-nowrap">{monthLabel(row.month)}</td>
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

// The hole is wide enough for an exact six-figure total (₹1,23,456.78).
const DONUT_INNER = 66;
const DONUT_OUTER = 88;
const RAD = Math.PI / 180;
const CALLOUT_FONT = `600 13px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

let measureCtx: CanvasRenderingContext2D | null = null;
/** Rendered width of callout text, so it can be kept inside the chart box. */
function textWidth(text: string): number {
  if (typeof document === "undefined") return text.length * 7.5;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 7.5;
  measureCtx.font = CALLOUT_FONT;
  return measureCtx.measureText(text).width;
}

// Ring layout, shared by the Pie and the callout layer drawn over it.
const DONUT_START = 90; // 12 o'clock
const DONUT_END = -270; // clockwise, once round
const DONUT_PAD = 2;
const DONUT_MIN_ANGLE = 8;

/**
 * Each slice's middle angle, worked out the way Recharts lays the ring out
 * (recharts/lib/polar/Pie.js, computePieSectors): padding between slices,
 * and the minimum angle only when some slice would otherwise fall below it.
 * The callout layer needs these because Recharts' own labels are not
 * redrawn when the hovered slice changes while its animation is on.
 */
function sliceMidAngles(values: number[]): number[] {
  const delta = DONUT_END - DONUT_START;
  const abs = Math.abs(delta);
  const sign = Math.sign(delta);
  const pad = values.length <= 1 ? 0 : DONUT_PAD;
  const nonZero = values.filter((v) => v !== 0).length;
  const sum = values.reduce((a, v) => a + v, 0);
  if (sum <= 0) return values.map(() => DONUT_START);
  const minAngle = values.length > 1 ? DONUT_MIN_ANGLE : 0;
  const needsMin = minAngle > 0 && values.some((v) => v !== 0 && (v / sum) * abs < minAngle);
  const min = needsMin ? minAngle : 0;
  const real = abs - nonZero * min - (abs >= 360 ? nonZero : nonZero - 1) * pad;
  let end = DONUT_START;
  return values.map((v, i) => {
    const start = i ? end + sign * pad * (v !== 0 ? 1 : 0) : DONUT_START;
    end = start + sign * ((v !== 0 ? min : 0) + (v / sum) * real);
    return (start + end) / 2;
  });
}

/** The element's size, kept current as it resizes. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

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
 * slice's middle, then the category and its share (muted) over the exact
 * amount (ink). The only place a slice's figures show: the donut has no list.
 * Rendered only for the slice being hovered or selected. It sits beside the
 * ring when the text fits in the chart box; otherwise (narrow phones, slices
 * near 3 or 9 o'clock) the leader bends up or down to the nearest empty corner
 * of the box, above or below the ring, and the text sits there against the
 * box edge, so it neither overlaps the ring nor gets clipped.
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
  name,
}: CalloutProps & { shown: number | null; colour: string; percent: number; name: string }) {
  if (index !== shown) return <g />;
  const amount = exactINR(value);
  const share = `${name} · ${percent.toFixed(percent < 10 ? 1 : 0)}%`;
  // The share line is 11px; measured at the 13px bold font it runs a little
  // wide, which only errs towards the roomier corner placement.
  const width = Math.max(textWidth(amount), textWidth(share) * 0.85);
  const boxW = cx * 2;
  const cos = Math.cos(-midAngle * RAD);
  const sin = Math.sin(-midAngle * RAD);
  const right = cos >= 0;
  const sx = cx + (outerRadius + 3) * cos;
  const sy = cy + (outerRadius + 3) * sin;
  const mx = cx + (outerRadius + 14) * cos;
  const my = cy + (outerRadius + 14) * sin;
  const ex = mx + (right ? 10 : -10);
  const tx = ex + (right ? 5 : -5);
  const fitsBeside = right ? tx + width <= boxW - 2 : tx - width >= 2;

  if (fitsBeside) {
    const anchor = right ? "start" : "end";
    return (
      <g pointerEvents="none">
        <path d={`M${sx},${sy}L${mx},${my}L${ex},${my}`} stroke={colour} strokeWidth={1.5} fill="none" />
        <circle cx={ex} cy={my} r={2.5} fill={colour} />
        <text x={tx} y={my} dy={-4} textAnchor={anchor} fill={MUTED} fontSize={11}>
          {share}
        </text>
        <text x={tx} y={my} dy={12} textAnchor={anchor} fill={INK} fontSize={13} fontWeight={600}>
          {amount}
        </text>
      </g>
    );
  }

  // Corner placement: out from the slice, then up (top half) or down
  // (bottom half) to the ring's top or bottom edge, where the box corners are
  // empty; the text stacks beyond that point, flush with the box edge.
  const up = sin < 0;
  const kx = cx + (outerRadius + 10) * cos;
  const ky = cy + (outerRadius + 10) * sin;
  const dotY = up ? cy - outerRadius + 4 : cy + outerRadius - 4;
  const edgeX = right ? boxW - 2 : 2;
  const anchor = right ? "end" : "start";
  return (
    <g pointerEvents="none">
      <path d={`M${sx},${sy}L${kx},${ky}L${kx},${dotY}`} stroke={colour} strokeWidth={1.5} fill="none" />
      <circle cx={kx} cy={dotY} r={2.5} fill={colour} />
      <text x={edgeX} y={dotY} dy={up ? -24 : 18} textAnchor={anchor} fill={MUTED} fontSize={11}>
        {share}
      </text>
      <text x={edgeX} y={dotY} dy={up ? -8 : 34} textAnchor={anchor} fill={INK} fontSize={13} fontWeight={600}>
        {amount}
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
  const reduced = useReducedMotion();
  const midAngles = useMemo(() => sliceMidAngles(data.map((d) => d.amount)), [data]);
  const [boxRef, box] = useSize<HTMLDivElement>();

  return (
    <ChartCard title="Where it went">
      <div>
        {/* No list beside the ring: a slice's figures show only in its
            callout, outside the ring, clear of the total in the hole. The
            box spans the card so the callout usually fits beside the ring. */}
        <div
          ref={boxRef}
          className="relative h-72 w-full"
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
                paddingAngle={data.length > 1 ? DONUT_PAD : 0}
                // A sliver (a 0% "Other") still gets an arc wide enough to
                // hover or tap; its callout gives the true share.
                minAngle={data.length > 1 ? DONUT_MIN_ANGLE : 0}
                cornerRadius={6}
                stroke="none"
                // Clockwise from 12 o'clock, the ring sweeps round and fills
                // each category in turn while the total counts up.
                startAngle={DONUT_START}
                endAngle={DONUT_END}
                isAnimationActive={!reduced}
                animationDuration={DRAW_MS}
                animationEasing={STRONG_EASE_IN_OUT as "ease-in-out"}
                labelLine={false}
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
          {/* The callout for the hovered or selected slice, drawn over the
              chart outside the ring. */}
          {shown !== null && data[shown] && box.w > 0 ? (
            <svg className="pointer-events-none absolute inset-0" width={box.w} height={box.h} aria-hidden>
              <DonutCallout
                cx={box.w / 2}
                cy={box.h / 2}
                midAngle={midAngles[shown]}
                outerRadius={DONUT_OUTER}
                index={shown}
                value={data[shown].amount}
                shown={shown}
                colour={palette.colourOf(data[shown].category)}
                percent={pct(data[shown].amount)}
                name={data[shown].category}
              />
            </svg>
          ) : null}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs text-muted">Total</span>
            <CountUpINR value={total} className="text-[15px] font-semibold tabular-nums" />
          </div>
        </div>

        {/* Not shown, but still there for keyboards and screen readers: one
            button per slice. Tabbing onto one opens its callout on the ring,
            Enter filters, and a screen reader reads the figures. */}
        <ul className="sr-only" aria-label="Categories">
          {data.map((d, i) => (
            <li key={d.category}>
              <button
                type="button"
                onClick={() => onSelect(d.category)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-pressed={selected === d.category}
              >
                {d.category}, {pct(d.amount).toFixed(0)}%, {exactINR(d.amount)}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted">
        {selected ? (
          "Tap the empty part of the chart, or the same slice again, to remove the filter."
        ) : (
          <>
            <span className="[@media(pointer:coarse)]:hidden">Hover a slice to see what it cost; click it to filter the expense detail.</span>
            <span className="hidden [@media(pointer:coarse)]:inline">Tap a slice to see what it cost and filter the expense detail.</span>
          </>
        )}
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
  const reduced = useReducedMotion();
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
              cursor={{ fill: "rgb(var(--c-ink) / 0.04)" }}
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
            <Bar
              dataKey="amount"
              radius={[0, 6, 6, 0]}
              maxBarSize={22}
              isAnimationActive={!reduced}
              animationDuration={DRAW_MS - 150}
              animationEasing={STRONG_EASE_OUT}
            >
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
