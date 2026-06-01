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

export function CategoryBar({ data }: { data: { category: string; amount: number }[] }) {
  const sorted = [...data].sort((a, b) => a.amount - b.amount);
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sorted} layout="vertical" margin={{ left: 20 }}>
          <XAxis type="number" tick={axisTick} />
          <YAxis type="category" dataKey="category" width={90} tick={axisTick} />
          <Tooltip contentStyle={tooltipStyle} formatter={money} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
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
