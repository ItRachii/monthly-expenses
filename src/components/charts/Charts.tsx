"use client";

import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
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

export function CategoryPie({ data }: { data: { category: string; amount: number }[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="amount" nameKey="category" innerRadius={55} outerRadius={110}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
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

export function MonthlyTrend({ data }: { data: { month: string; amount: number }[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="month" tick={axisTick} />
          <YAxis tick={axisTick} />
          <Tooltip contentStyle={tooltipStyle} formatter={money} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
          <Bar dataKey="amount" name="Total" fill="#4C72B0" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
