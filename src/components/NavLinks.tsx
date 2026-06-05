"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const items = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/add", label: "Add Expense", icon: "➕" },
  { href: "/log", label: "Expense Log", icon: "📋" },
  { href: "/summary", label: "Monthly Summary", icon: "📊" },
  { href: "/settlement", label: "Settlement", icon: "💰" },
  { href: "/notifications", label: "Notifications", icon: "🔔" },
  { href: "/groups", label: "Groups", icon: "👥" },
  { href: "/profile", label: "Profile", icon: "👤" },
];

// Tabs that operate on the selected Personal/Group context. The Groups and
// Profile pages are context-agnostic, so we don't carry ?ctx into them.
const contextAware = new Set(["/", "/add", "/log", "/summary", "/settlement"]);

export function NavLinks({
  unreadCount = 0,
  collapsed = false,
}: {
  unreadCount?: number;
  collapsed?: boolean;
}) {
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
        const showBadge = it.href === "/notifications" && unreadCount > 0;
        return (
          <Link
            key={it.href}
            href={href}
            title={collapsed ? it.label : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              active
                ? "bg-primary/15 font-semibold text-ink"
                : "text-muted hover:bg-white/5 hover:text-ink"
            } ${collapsed ? "md:justify-center md:px-2" : ""}`}
          >
            <span aria-hidden className="relative">
              {it.icon}
              {showBadge && collapsed ? (
                <span className="absolute -right-1.5 -top-1.5 hidden h-2 w-2 rounded-full bg-primary md:block" />
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
