"use client";

import { monthLabel } from "@/lib/format";

export { monthLabel };

// Compact month picker that sits on the same line as a section title, so the
// control is next to the content it filters instead of floating alone.
export function MonthSelect({
  months,
  value,
  onChange,
}: {
  months: string[];
  value: string;
  onChange: (month: string) => void;
}) {
  return (
    <select
      aria-label="Select month"
      className="select w-auto min-w-[8.5rem] shrink-0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {monthLabel(m)}
        </option>
      ))}
    </select>
  );
}
