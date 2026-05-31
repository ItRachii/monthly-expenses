"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface ContextOption {
  value: string;
  label: string;
}

export function ContextSelector({
  label,
  options,
  current,
}: {
  label: string;
  options: ContextOption[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("ctx", e.target.value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="max-w-xs">
      <label className="label">{label}</label>
      <select className="select" value={current} onChange={onChange}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
