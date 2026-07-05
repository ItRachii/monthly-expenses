"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ICONS } from "./NavIcons";

// Desktop sidebar links. Per-context pages (log/summary/settlement) merged
// into the home screen + /g/[ctx] tabs, so the nav is just the app shell.
const items = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/add", label: "Add Expense", icon: "➕" },
  { href: "/notifications", label: "Notifications", icon: "🔔" },
  { href: "/groups", label: "Groups", icon: "👥" },
];

export function NavLinks({
  unreadCount = 0,
  collapsed = false,
}: {
  unreadCount?: number;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {items.map((it) => {
        const active = pathname === it.href;
        const showBadge = it.href === "/notifications" && unreadCount > 0;
        const Icon = NAV_ICONS[it.href];
        return (
          <Link
            key={it.href}
            href={it.href}
            title={collapsed ? it.label : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-base transition ${
              active
                ? "bg-primary/15 font-semibold text-ink"
                : "text-muted hover:bg-white/5 hover:text-ink"
            } ${collapsed ? "md:justify-center md:px-2" : ""}`}
          >
            <span
              aria-hidden
              className={`relative leading-none ${
                collapsed ? "md:text-4xl" : "text-lg"
              }`}
            >
              {Icon ? <Icon /> : it.icon}
              {showBadge && collapsed ? (
                <span className="absolute -right-1 -top-1 hidden h-2.5 w-2.5 rounded-full bg-primary md:block" />
              ) : null}
            </span>
            <span className={`flex-1 ${collapsed ? "md:hidden" : ""}`}>
              {it.label}
            </span>
            {showBadge ? (
              <span
                className={`rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-white ${
                  collapsed ? "md:hidden" : ""
                }`}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
