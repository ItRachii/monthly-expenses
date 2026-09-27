"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ICONS } from "./NavIcons";
import { useAddExpense } from "./AddExpense";

// Mobile bottom tab bar (md+ uses the sidebar). The old per-page tabs merged
// into the Splitwise-style home screen, so the bar is just the app shell now.
// "Add" opens the add-expense overlay on top of the current screen.
const BASE_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/add", label: "Add" },
  { href: "/notifications", label: "Alerts" },
  { href: "/profile", label: "Profile" },
];
const STATEMENTS = { href: "/statements", label: "Import" };

export function MobileBottomNav({ statements = false }: { statements?: boolean }) {
  const pathname = usePathname();
  const { open } = useAddExpense();
  const items = statements ? [...BASE_ITEMS.slice(0, 2), STATEMENTS, ...BASE_ITEMS.slice(2)] : BASE_ITEMS;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-white/10 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {items.map((it) => {
        const active = pathname === it.href;
        const Icon = NAV_ICONS[it.href];
        const className = `relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] transition ${
          active ? "font-semibold text-ink" : "text-muted"
        }`;
        const content = (
          <>
            {active ? (
              <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" />
            ) : null}
            <span aria-hidden className="text-2xl leading-none">
              {Icon ? <Icon /> : null}
            </span>
            <span className="leading-none">{it.label}</span>
          </>
        );
        return it.href === "/add" ? (
          <button key={it.href} type="button" onClick={() => open()} aria-label={it.label} className={className}>
            {content}
          </button>
        ) : (
          <Link
            key={it.href}
            href={it.href}
            aria-label={it.label}
            aria-current={active ? "page" : undefined}
            className={className}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
