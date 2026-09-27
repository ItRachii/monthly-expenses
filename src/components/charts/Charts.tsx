"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS } from "@/lib/constants";
import { formatINR } from "@/lib/format";

const axisTick = { fill: "#8B9DB8", fontSize: 12 };
const tooltipStyle = {
  background: "#1C1F26",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  color: "#FAFAFA",
};
const money = (v: unknown) => formatINR(Number(v));

const RADIAN = Math.PI / 180;

// Draws each slice's value just outside the donut (paired with a leader line).
function renderPieValueLabel({
  cx = 0,
  cy = 0,
  midAngle = 0,
  outerRadius = 0,
  value = 0,
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  value?: number;
}) {
  const r = outerRadius + 16;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#FAFAFA"
      fontSize={12}
      textAnchor={x >= cx ? "start" : "end"}
      dominantBaseline="central"
    >
      {formatINR(value)}
    </text>
  );
}

export function CategoryPie({
  data,
  selected,
  onSelect,
}: {
  data: { category: string; amount: number }[];
  selected?: string | null;
  onSelect?: (category: string) => void;
}) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="category"
            innerRadius={52}
            outerRadius={98}
            label={renderPieValueLabel}
            labelLine={{ stroke: "rgba(255,255,255,0.25)" }}
            onClick={(_, index) => {
              const cat = data[index]?.category;
              if (cat) onSelect?.(cat);
            }}
          >
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                fillOpacity={selected && selected !== entry.category ? 0.3 : 1}
                cursor={onSelect ? "pointer" : undefined}
              />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={money} />
          <Legend wrapperStyle={{ fontSize: 12, color: "#8B9DB8" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// The bar colors come from per-category <Cell>s, which Recharts does not pass
// to the default tooltip (it uses the series fill). Render our own so the
// tooltip text matches the hovered bar's color.
function CategoryBarTooltip({
  active,
  payload,
  colorOf,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: { category: string } }>;
  colorOf: (category: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const category = payload[0].payload.category;
  const color = colorOf(category);
  return (
    <div style={tooltipStyle} className="px-3 py-2 text-sm">
      <div className="mb-0.5 flex items-center gap-2 font-semibold" style={{ color }}>
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
        {category}
      </div>
      <div>amount : {money(payload[0].value)}</div>
    </div>
  );
}

export function CategoryBar({ data }: { data: { category: string; amount: number }[] }) {
  const sorted = [...data].sort((a, b) => a.amount - b.amount);
  // Same mapping used for the <Cell>s below, keyed by category so the tooltip
  // resolves the identical color.
  const colorOf = (category: string) => {
    const i = sorted.findIndex((d) => d.category === category);
    return CHART_COLORS[(i < 0 ? 0 : i) % CHART_COLORS.length];
  };
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sorted} layout="vertical" margin={{ left: 20 }}>
          <XAxis type="number" tick={axisTick} />
          <YAxis type="category" dataKey="category" width={90} tick={axisTick} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
            content={<CategoryBarTooltip colorOf={colorOf} />}
          />
          <Bar dataKey="amount">
            {sorted.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly trend: one column per month, stacked by category.
//
// Colours follow the category, never its rank within a month: the seven
// biggest categories over the whole history get the seven hues in fixed
// order (biggest at the bottom of every column), and everything else folds
// into a neutral "Other" on top. Validated with the dataviz skill's
// validate_palette.js against the card surface #1C1F26 (dark): lightness,
// CVD and normal-vision separation of stack neighbours, and 3:1 contrast all
// pass; "Other" is grey on purpose, so only its chroma check fails.
const STACK_HUES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"];
const OTHER = "Other";
const OTHER_HUE = "#6e737d";
const SURFACE = "#1C1F26";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthTick(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} '${y.slice(2)}`;
}

/** ₹1.2k / ₹15k / ₹1.1L: short enough for axis ticks and column caps. */
function compactINR(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(n >= 1000000 ? 0 : 1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(n)}`;
}

type TrendRow = { month: string; total: number } & Record<string, number | string>;

function buildTrend(rows: { date: string; category: string; amount: number }[]) {
  const name = (c: string) => c.trim() || "Uncategorised";
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(name(r.category), (totals.get(name(r.category)) ?? 0) + r.amount);
  const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const named = ranked.slice(0, STACK_HUES.length);
  const keys = ranked.length > named.length ? [...named, OTHER] : named;
  const colour = new Map<string, string>(named.map((c, i) => [c, STACK_HUES[i]]));
  colour.set(OTHER, OTHER_HUE);
  const bucket = (c: string) => (colour.has(c) && c !== OTHER ? c : OTHER);

  const byMonth = new Map<string, TrendRow>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    let row = byMonth.get(month);
    if (!row) {
      row = { month, total: 0 } as TrendRow;
      for (const k of keys) row[k] = 0;
      byMonth.set(month, row);
    }
    const k = bucket(name(r.category));
    row[k] = Math.round(((row[k] as number) + r.amount) * 100) / 100;
    row.total = Math.round((row.total + r.amount) * 100) / 100;
  }
  const data = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
  return { data, keys, colour };
}

function TrendTooltip({
  active,
  label,
  payload,
  keys,
  colour,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ payload: TrendRow }>;
  keys: string[];
  colour: Map<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  // Top of the stack first, so the list reads in the same order as the column.
  const lines = [...keys].reverse().filter((k) => (row[k] as number) > 0);
  return (
    <div style={tooltipStyle} className="min-w-[11rem] px-3 py-2 text-sm">
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <span className="text-muted">{label ? monthTick(label) : ""}</span>
        <span className="font-semibold">{formatINR(row.total)}</span>
      </div>
      {lines.map((k) => (
        <div key={k} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-muted">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: colour.get(k) }} />
            {k}
          </span>
          <span className="font-semibold">{formatINR(row[k] as number)}</span>
        </div>
      ))}
    </div>
  );
}

export function MonthlyTrend({
  rows,
}: {
  rows: { date: string; category: string; amount: number }[];
}) {
  const { data, keys, colour } = useMemo(() => buildTrend(rows), [rows]);
  const topKey = (row: TrendRow) => [...keys].reverse().find((k) => (row[k] as number) > 0);
  // Label every cap when there is room; on long histories only every other.
  const capEvery = data.length > 12 ? 2 : 1;

  return (
    <div className="space-y-3">
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="month" tickFormatter={monthTick} tick={axisTick} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.15)" }} />
            <YAxis tickFormatter={compactINR} tick={axisTick} tickLine={false} axisLine={false} width={52} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
              content={<TrendTooltip keys={keys} colour={colour} />}
            />
            {keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="month"
                fill={colour.get(k)}
                maxBarSize={48}
                isAnimationActive={false}
                // 1px surface stroke on each side = a 2px gap between segments;
                // only the top segment of each column gets rounded corners.
                shape={(props: unknown) => {
                  const p = props as React.ComponentProps<typeof Rectangle> & { payload: TrendRow };
                  return (
                    <Rectangle
                      {...p}
                      stroke={SURFACE}
                      strokeWidth={1}
                      radius={topKey(p.payload) === k ? [4, 4, 0, 0] : 0}
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
                          fill="#FAFAFA"
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

      {/* Legend in stack order (biggest first = bottom of each column). Recharts'
          own legend sorts alphabetically, which breaks that correspondence. */}
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        {keys.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colour.get(k) }} />
            {k}
          </li>
        ))}
      </ul>

      <details className="text-sm">
        <summary className="cursor-pointer select-none text-xs text-muted hover:text-ink">
          View as table
        </summary>
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
                  <td className="whitespace-nowrap">{monthTick(row.month)}</td>
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
    </div>
  );
}
