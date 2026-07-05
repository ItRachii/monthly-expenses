"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ICONS } from "./NavIcons";

// Mobile bottom tab bar (md+ uses the sidebar). The old per-page tabs merged
// into the Splitwise-style home screen, so the bar is just the app shell now.
const items = [
  { href: "/", label: "Home" },
  { href: "/add", label: "Add" },
  { href: "/notifications", label: "Alerts" },
  { href: "/profile", label: "Profile" },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-white/10 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {items.map((it) => {
        const active = pathname === it.href;
        const Icon = NAV_ICONS[it.href];
        return (
          <Link
            key={it.href}
            href={it.href}
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
