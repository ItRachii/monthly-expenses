/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { ACCOUNT_ITEMS, NavLinks, mainItems } from "./NavLinks";
import { GroupsNav } from "./GroupsNav";
import type { SidebarGroup } from "@/lib/groups";
import { useSidebar } from "./SidebarContext";
import { doSignOut } from "@/lib/actions/auth";
import { ChevronRightIcon, LogOutIcon, MenuIcon } from "@/components/Icons";

export function Sidebar({
  name,
  image,
  unreadCount,
  statements = false,
  groups = [],
}: {
  name: string;
  image: string | null;
  unreadCount: number;
  /** Show the statement import entry. */
  statements?: boolean;
  /** The member's groups, most recently opened first, with unread counts. */
  groups?: SidebarGroup[];
}) {
  const { collapsed, setCollapsed } = useSidebar();

  return (
    <aside
      className={`hidden w-full shrink-0 border-b border-white/10 bg-surface/40 md:block md:border-b-0 md:border-r ${
        collapsed ? "md:w-16" : "md:w-64"
      }`}
    >
      {/* Stretches to the full page height (flex parent), while this inner
          panel sticks to the viewport so the nav stays reachable on long pages. */}
      <div
        className={`flex flex-col gap-6 p-4 md:sticky md:top-0 md:h-dvh md:overflow-y-auto ${
          collapsed ? "md:items-center md:px-2" : ""
        }`}
      >
        <div className={`flex items-center gap-3 ${collapsed ? "md:flex-col" : ""}`}>
          {/* The avatar is a shortcut to the profile page; the Account
              section below is the labelled route to the same screen. */}
          <Link
            href="/profile"
            aria-label="Profile"
            title="Profile"
            className="shrink-0 rounded-full outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary"
          >
            {image ? (
              <img
                src={image}
                alt=""
                className="h-9 w-9 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <ProfileAvatar />
            )}
          </Link>
          <span
            className={`flex-1 truncate text-sm font-semibold ${
              collapsed ? "md:hidden" : ""
            }`}
          >
            {name}
          </span>
          {/* Open: hamburger sits at the top-right. Collapsed rail: it moves
              to the top of the column above the avatar. */}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Minimise sidebar"}
            aria-expanded={!collapsed}
            className={`icon-btn ${collapsed ? "md:order-first" : ""}`}
          >
            {collapsed ? <ChevronRightIcon /> : <MenuIcon />}
          </button>
        </div>

        <div className={collapsed ? "hidden w-full md:block" : "w-full"}>
          <NavLinks
            items={mainItems(statements)}
            unreadCount={unreadCount}
            collapsed={collapsed}
            slots={{ "/groups": <GroupsNav groups={groups} collapsed={collapsed} /> }}
          />
        </div>

        {/* Account section: heading when open, a thin separator on the
            collapsed rail where the icon alone has to carry it. */}
        <div
          className={`w-full ${
            collapsed ? "hidden md:block md:border-t md:border-white/10 md:pt-3" : ""
          }`}
        >
          <h2
            className={`mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted ${
              collapsed ? "md:hidden" : ""
            }`}
          >
            Account
          </h2>
          <NavLinks items={ACCOUNT_ITEMS} collapsed={collapsed} ariaLabel="Account" />
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
              <LogOutIcon />
            </span>
          </button>
        </form>
      </div>
    </aside>
  );
}

function ProfileAvatar() {
  // Fallback when the signed-in user has no Google profile image: a gradient
  // person-in-circle, sized to fill the same 36px avatar slot as the photo.
  return (
    <svg viewBox="0 0 24 24" className="h-9 w-9" aria-hidden>
      <defs>
        <linearGradient id="profileBg" gradientUnits="userSpaceOnUse" x1="4" y1="20" x2="20" y2="4">
          <stop offset="0%" stopColor="#1E5FCF" />
          <stop offset="100%" stopColor="#1FB8B0" />
        </linearGradient>
        <linearGradient id="profilePerson" gradientUnits="userSpaceOnUse" x1="12" y1="6" x2="12" y2="23">
          <stop offset="0%" stopColor="#6FE0EA" />
          <stop offset="100%" stopColor="#2E84F5" />
        </linearGradient>
        <clipPath id="profileClip">
          <circle cx="12" cy="12" r="12" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="12" fill="url(#profileBg)" />
      <g clipPath="url(#profileClip)" fill="url(#profilePerson)">
        <circle cx="12" cy="9" r="3.1" />
        <path d="M4.6 23.6 A7.4 8.6 0 0 1 19.4 23.6 Z" />
      </g>
    </svg>
  );
}
