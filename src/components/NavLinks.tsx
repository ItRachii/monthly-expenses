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
            <span
              aria-hidden
              className={`relative leading-none ${
                collapsed ? "md:text-4xl" : ""
              }`}
            >
              {it.href === "/" ? <HomeIcon /> : it.icon}
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

// Gradient house used for the Home item, approximating the supplied artwork.
// Sized in em so it scales with the link font-size (small when expanded, large
// in the collapsed rail) alongside the emoji icons.
function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.15em] w-[1.15em] shrink-0" aria-hidden>
      <defs>
        <linearGradient
          id="sidebarHomeGrad"
          gradientUnits="userSpaceOnUse"
          x1="3"
          y1="3"
          x2="21"
          y2="21"
        >
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="55%" stopColor="#22B8D6" />
          <stop offset="100%" stopColor="#2BD4B0" />
        </linearGradient>
      </defs>
      {/* chimney (behind the roof) */}
      <rect x="15.2" y="3.6" width="2.6" height="8" rx="0.6" fill="url(#sidebarHomeGrad)" />
      {/* roof */}
      <path d="M12 2.9 L21.8 11.6 H2.2 Z" fill="url(#sidebarHomeGrad)" strokeLinejoin="round" />
      {/* body with a door cut out */}
      <path
        fillRule="evenodd"
        d="M5.6 11 H18.4 A0.9 0.9 0 0 1 19.3 11.9 V21 H4.7 V11.9 A0.9 0.9 0 0 1 5.6 11 Z M10.6 21 V16.3 A1.4 1.4 0 0 1 13.4 16.3 V21 Z"
        fill="url(#sidebarHomeGrad)"
      />
    </svg>
  );
}
