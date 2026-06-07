"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV_ICONS } from "./NavIcons";

// Mobile bottom tab bar (md+ uses the sidebar). Order per request.
const items = [
  { href: "/groups", label: "Groups" },
  { href: "/add", label: "Add" },
  { href: "/log", label: "Log" },
  { href: "/summary", label: "Summary" },
  { href: "/settlement", label: "Settle" },
  { href: "/", label: "Home" },
];

const contextAware = new Set(["/", "/add", "/log", "/summary", "/settlement"]);

export function MobileBottomNav() {
  const pathname = usePathname();
  const ctx = useSearchParams().get("ctx");

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-white/10 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {items.map((it) => {
        const active = pathname === it.href;
        const href =
          ctx && ctx !== "personal" && contextAware.has(it.href)
            ? `${it.href}?ctx=${encodeURIComponent(ctx)}`
            : it.href;
        const Icon = NAV_ICONS[it.href];
        return (
          <Link
            key={it.href}
            href={href}
            aria-label={it.label}
            aria-current={active ? "page" : undefined}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] transition ${
              active ? "font-semibold text-ink" : "text-muted"
            }`}
          >
            {active ? (
              <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" />
            ) : null}
            <span aria-hidden className="text-2xl leading-none">
              {Icon ? <Icon /> : null}
            </span>
            <span className="leading-none">{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
