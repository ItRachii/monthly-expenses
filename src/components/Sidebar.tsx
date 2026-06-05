/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { NavLinks } from "./NavLinks";
import { doSignOut } from "@/lib/actions/auth";

export function Sidebar({
  name,
  image,
  unreadCount,
}: {
  name: string;
  image: string | null;
  unreadCount: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`w-full shrink-0 border-b border-white/10 bg-surface/40 transition-[width] md:border-b-0 md:border-r ${
        collapsed ? "md:w-16" : "md:w-64"
      }`}
    >
      {/* Stretches to the full page height (flex parent), while this inner
          panel sticks to the viewport so the nav stays reachable on long pages. */}
      <div
        className={`flex flex-col gap-6 p-4 md:sticky md:top-0 md:h-screen md:overflow-y-auto ${
          collapsed ? "md:items-center md:px-2" : ""
        }`}
      >
        <div className={`flex items-center gap-3 ${collapsed ? "md:flex-col" : ""}`}>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Minimise sidebar"}
            aria-expanded={!collapsed}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-white/5 hover:text-ink"
          >
            {collapsed ? <ChevronRightIcon /> : <HamburgerIcon />}
          </button>

          {image ? (
            <img
              src={image}
              alt=""
              className="h-9 w-9 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="text-2xl">👤</span>
          )}
          <span
            className={`truncate text-sm font-semibold ${
              collapsed ? "md:hidden" : ""
            }`}
          >
            {name}
          </span>
        </div>

        <div className={collapsed ? "hidden w-full md:block" : "w-full"}>
          <NavLinks unreadCount={unreadCount} collapsed={collapsed} />
        </div>

        <form
          action={doSignOut}
          className={`mt-auto w-full ${collapsed ? "hidden md:block" : ""}`}
        >
          <button
            type="submit"
            title="Sign out"
            className={`btn-secondary w-full ${collapsed ? "md:px-0" : ""}`}
          >
            <span className={collapsed ? "md:hidden" : ""}>Sign out</span>
            <span className={collapsed ? "hidden md:inline" : "hidden"} aria-hidden>
              <LogoutIcon />
            </span>
          </button>
        </form>
      </div>
    </aside>
  );
}

function HamburgerIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
