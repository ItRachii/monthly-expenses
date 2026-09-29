"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { NAV_ICONS } from "./NavIcons";

export interface NavItem {
  href: string;
  label: string;
}

// Desktop sidebar links. Per-context pages (log/summary/settlement) merged
// into the home screen + /g/[ctx] tabs, so the nav is just the app shell.
const MAIN_ITEMS: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/notifications", label: "Notifications" },
  { href: "/groups", label: "Groups" },
];

// Card statement import. Shown only where the feature flag is on.
export const STATEMENTS_ITEM: NavItem = { href: "/statements", label: "Statements" };

export function mainItems(statements: boolean): NavItem[] {
  return statements ? [...MAIN_ITEMS, STATEMENTS_ITEM] : MAIN_ITEMS;
}

// "Account" section under the main nav: where the user edits their profile.
export const ACCOUNT_ITEMS: NavItem[] = [
  { href: "/profile", label: "Profile" },
];

export function NavLinks({
  items = MAIN_ITEMS,
  unreadCount = 0,
  collapsed = false,
  ariaLabel,
  slots = {},
}: {
  items?: NavItem[];
  unreadCount?: number;
  collapsed?: boolean;
  ariaLabel?: string;
  /** Replaces the plain link for an href, e.g. the expandable Groups entry. */
  slots?: Record<string, ReactNode>;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={ariaLabel} className="flex flex-col gap-1">
      {items.map((it) => {
        if (slots[it.href]) return <div key={it.href}>{slots[it.href]}</div>;
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
                collapsed ? "md:text-2xl" : "text-lg"
              } ${active ? "text-primary-light" : ""
              }`}
            >
              {Icon ? <Icon filled={active} /> : null}
              {showBadge && collapsed ? (
                <span className="absolute -right-1 -top-1 hidden h-2.5 w-2.5 rounded-full bg-primary md:block" />
              ) : null}
            </span>
            <span className={`flex-1 ${collapsed ? "md:hidden" : ""}`}>
              {it.label}
            </span>
            {showBadge ? (
              <span
                // A fixed minimum width, so the sidebar (sized to its links)
                // does not shift as the count goes from 9 to 10.
                className={`min-w-[2.25rem] rounded-full bg-primary px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-white ${
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
