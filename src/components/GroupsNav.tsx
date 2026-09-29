"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { GroupsIcon } from "./NavIcons";
import { MinusIcon, PlusIcon } from "./Icons";
import type { SidebarGroup } from "@/lib/groups";
import { SlidingName } from "./SlidingName";

/** How many recent groups the sidebar lists before "All groups". */
const RECENT = 5;
const OPEN_KEY = "sidebar.groups.open";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function unreadLabel(n: number): string {
  return `${n} unread notification${n === 1 ? "" : "s"}`;
}

function GroupAvatar({ name, active, size = "sm" }: { name: string; active: boolean; size?: "sm" | "lg" }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-md font-semibold transition-colors ${
        size === "lg" ? "h-8 w-8 text-xs" : "h-6 w-6 text-[10px]"
      } ${
        size === "lg"
          ? // Solid on the rail, where the tree line runs behind the avatars.
            active
            ? "bg-[color-mix(in_srgb,rgb(var(--c-primary))_25%,rgb(var(--c-surface)))] text-ink"
            : "bg-[color-mix(in_srgb,rgb(var(--c-ink))_7%,rgb(var(--c-surface)))] text-muted group-hover/item:text-ink"
          : active
            ? "bg-primary/30 text-ink"
            : "bg-ink/[0.07] text-muted group-hover/item:text-ink"
      }`}
    >
      {initials(name)}
    </span>
  );
}

/**
 * The Groups entry of the sidebar. Open, it lists the groups opened most
 * recently on a tree line, each with its unread notifications; the group on
 * screen is highlighted. On the collapsed rail the same groups show as
 * initials, with a dot when something is unread.
 */
export function GroupsNav({ groups, collapsed }: { groups: SidebarGroup[]; collapsed: boolean }) {
  const pathname = usePathname();
  const listId = useId();
  const [open, setOpen] = useState(true);

  // The fold is a per-device preference.
  useEffect(() => {
    try {
      const v = localStorage.getItem(OPEN_KEY);
      if (v !== null) setOpen(v === "1");
    } catch {
      // Storage may be blocked; stay open.
    }
  }, []);
  function toggle() {
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? "0" : "1");
      } catch {
        // Not remembered; still toggles.
      }
      return !o;
    });
  }

  const activeId = pathname.startsWith("/g/") ? decodeURIComponent(pathname.slice(3).split("/")[0]) : null;
  const active = activeId ? groups.find((g) => g.id === activeId) : undefined;
  // The group on screen is always listed, even when it is not among the recent ones.
  let shown = groups.slice(0, RECENT);
  if (active && !shown.includes(active)) shown = [active, ...shown.slice(0, RECENT - 1)];
  const more = groups.length - shown.length;
  const totalUnread = groups.reduce((s, g) => s + g.unread, 0);
  const onList = pathname === "/groups";
  const href = (id: string) => `/g/${encodeURIComponent(id)}`;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1">
        <Link
          href="/groups"
          title={totalUnread > 0 ? `Groups: ${unreadLabel(totalUnread)}` : "Groups"}
          className={`flex w-full items-center justify-center rounded-lg px-2 py-2 transition ${
            onList ? "bg-primary/15 text-ink" : "text-muted hover:bg-ink/5 hover:text-ink"
          }`}
        >
          <span aria-hidden className={`relative text-2xl leading-none ${onList || active ? "text-primary-light" : ""}`}>
            <GroupsIcon filled={onList || !!active} />
          </span>
          <span className="sr-only">Groups</span>
        </Link>
        {shown.length > 0 ? (
          <ul className="relative flex flex-col items-center gap-1.5 py-1">
            {/* The tree line behind the avatars. */}
            <span aria-hidden className="absolute bottom-2 top-0 w-px bg-ink/10" />
            {shown.map((g) => {
              const isActive = g.id === activeId;
              return (
                <li key={g.id} className="relative">
                  <Link
                    href={href(g.id)}
                    aria-current={isActive ? "page" : undefined}
                    title={g.unread > 0 ? `${g.name}: ${unreadLabel(g.unread)}` : g.name}
                    className={`group/item relative flex rounded-lg p-0.5 outline-none transition focus-visible:ring-2 focus-visible:ring-primary/70 ${
                      isActive ? "ring-1 ring-primary/60" : ""
                    }`}
                  >
                    <GroupAvatar name={g.name} active={isActive} size="lg" />
                    <span className="sr-only">{g.name}</span>
                    {g.unread > 0 ? (
                      <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-surface" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div
        className={`flex items-center rounded-lg transition ${
          onList ? "bg-primary/15" : "hover:bg-ink/5"
        }`}
      >
        <Link
          href="/groups"
          className={`flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-base ${
            onList ? "font-semibold text-ink" : active ? "text-ink" : "text-muted hover:text-ink"
          }`}
        >
          <span aria-hidden className={`text-lg leading-none ${onList || active ? "text-primary-light" : ""}`}>
            <GroupsIcon filled={onList || !!active} />
          </span>
          <span className="flex-1">Groups</span>
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={listId}
          aria-label={open ? "Hide recent groups" : "Show recent groups"}
          title={open ? "Hide recent groups" : "Show recent groups"}
          className="mr-1.5 rounded-md p-1.5 text-muted outline-none transition hover:bg-ink/[0.07] hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70"
        >
          {open ? <MinusIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
        </button>
      </div>

      {/* Grid rows animate the height from 0 to its content. Kept out of the
          sidebar's width measure: group names fit the width the page links
          set, and slide to show the rest. */}
      <div
        id={listId}
        inert={!open}
        className={`grid [contain:inline-size] transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          {/* The tree line runs under the Groups icon. */}
          <ul aria-label="Recent groups" className="ml-[21px] mt-1 space-y-0.5 border-l border-ink/10 py-0.5 pl-3">
            {shown.map((g) => {
              const isActive = g.id === activeId;
              return (
                <li key={g.id} className="relative">
                  {isActive ? <span aria-hidden className="absolute -left-[13px] inset-y-1 w-0.5 rounded-full bg-primary" /> : null}
                  <Link
                    href={href(g.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`slide-trigger group/item flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/70 ${
                      isActive ? "bg-ink/[0.07] font-medium text-ink" : "text-muted hover:bg-ink/[0.04] hover:text-ink"
                    }`}
                  >
                    <GroupAvatar name={g.name} active={isActive} />
                    <SlidingName text={g.name} className="min-w-0 flex-1" />
                    {g.unread > 0 ? (
                      <span
                        className="shrink-0 rounded-md bg-ink/[0.07] px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums text-ink/80"
                        title={unreadLabel(g.unread)}
                      >
                        {g.unread > 99 ? "99+" : g.unread}
                        <span className="sr-only"> unread</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
            {groups.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-muted">
                No groups yet.{" "}
                <Link href="/groups" className="text-primary-light hover:text-ink">
                  Create one
                </Link>
              </li>
            ) : null}
            {more > 0 ? (
              <li>
                <Link href="/groups" className="block rounded-lg px-2 py-1.5 text-xs text-muted transition hover:bg-ink/[0.04] hover:text-ink">
                  All groups ({groups.length})
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}
