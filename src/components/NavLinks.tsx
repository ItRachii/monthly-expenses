"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const items = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/add", label: "Add Expense", icon: "➕" },
  { href: "/log", label: "Expense Log", icon: "📋" },
  { href: "/summary", label: "Monthly Summary", icon: "📊" },
  { href: "/settlement", label: "Settlement", icon: "💰" },
  { href: "/groups", label: "Groups", icon: "👥" },
  { href: "/profile", label: "Profile", icon: "👤" },
];

// Tabs that operate on the selected Personal/Group context. The Groups and
// Profile pages are context-agnostic, so we don't carry ?ctx into them.
const contextAware = new Set(["/", "/add", "/log", "/summary", "/settlement"]);

export function NavLinks() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ctx = searchParams.get("ctx");

  return (
    <nav className="flex flex-col gap-1">
      {items.map((it) => {
        const active = pathname === it.href;
        // Preserve the selected group across navigation (personal = no ?ctx).
        const href =
          ctx && ctx !== "personal" && contextAware.has(it.href)
            ? `${it.href}?ctx=${encodeURIComponent(ctx)}`
            : it.href;
        return (
          <Link
            key={it.href}
            href={href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              active
                ? "bg-primary/15 font-semibold text-ink"
                : "text-muted hover:bg-white/5 hover:text-ink"
            }`}
          >
            <span aria-hidden>{it.icon}</span>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
