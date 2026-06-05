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
  className = "max-w-xs",
}: {
  label: string;
  options: ContextOption[];
  current: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    const value = e.target.value;
    // Personal is the default, so it carries no ?ctx (keeps URLs clean and
    // matches the sidebar nav). Stay on the current page either way.
    if (value === "personal") params.delete("ctx");
    else params.set("ctx", value);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className={className}>
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
