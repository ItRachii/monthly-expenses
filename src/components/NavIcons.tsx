import type { FC } from "react";

// Gradient SVG nav icons recreated from the supplied artwork. Sized in em so
// they scale with the link font-size (small in the expanded sidebar, large in
// the collapsed rail) alongside the remaining emoji icons.
const cls = "h-[1.15em] w-[1.15em] shrink-0";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <defs>
        <linearGradient id="navHome" gradientUnits="userSpaceOnUse" x1="3" y1="3" x2="21" y2="21">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="55%" stopColor="#22B8D6" />
          <stop offset="100%" stopColor="#2BD4B0" />
        </linearGradient>
      </defs>
      <rect x="15.2" y="3.6" width="2.6" height="8" rx="0.6" fill="url(#navHome)" />
      <path d="M12 2.9 L21.8 11.6 H2.2 Z" fill="url(#navHome)" strokeLinejoin="round" />
      <path
        fillRule="evenodd"
        d="M5.6 11 H18.4 A0.9 0.9 0 0 1 19.3 11.9 V21 H4.7 V11.9 A0.9 0.9 0 0 1 5.6 11 Z M10.6 21 V16.3 A1.4 1.4 0 0 1 13.4 16.3 V21 Z"
        fill="url(#navHome)"
      />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <defs>
        <radialGradient id="navAdd" gradientUnits="userSpaceOnUse" cx="8.6" cy="10.4" r="9">
          <stop offset="0%" stopColor="#2BD4C8" />
          <stop offset="100%" stopColor="#2563EB" />
        </radialGradient>
      </defs>
      <circle cx="9.5" cy="12" r="6.4" fill="url(#navAdd)" />
      <g stroke="#FFFFFF" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M9.5 9.2 V14.8" strokeWidth="1.5" />
        <path d="M6.7 12 H12.3" strokeWidth="1.5" />
        <path d="M12.6 12 H20.4" strokeWidth="1.3" />
        <path d="M18.8 10.4 L20.6 12 L18.8 13.6" strokeWidth="1.3" />
      </g>
    </svg>
  );
}

function LogIcon() {
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <defs>
        <linearGradient id="navLog" gradientUnits="userSpaceOnUse" x1="4.8" y1="4.8" x2="16.4" y2="16.4">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#15C8A0" />
        </linearGradient>
      </defs>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.4" fill="#1FA89A" fillOpacity="0.22" />
      <rect x="6.8" y="6.8" width="11.5" height="11.5" rx="2.4" fill="#1FA89A" fillOpacity="0.4" />
      <rect x="4.8" y="4.8" width="11.6" height="11.6" rx="2.4" fill="url(#navLog)" />
      <g fill="#EAF6FF">
        <circle cx="7.6" cy="7.9" r="0.95" />
        <circle cx="7.6" cy="10.6" r="0.95" />
        <circle cx="7.6" cy="13.3" r="0.95" />
      </g>
      <g stroke="#EAF6FF" strokeWidth="1.1" strokeLinecap="round">
        <path d="M9.6 7.9 H14.2" />
        <path d="M9.6 10.6 H14" />
        <path d="M9.6 13.3 H13.6" />
      </g>
    </svg>
  );
}

function SummaryIcon() {
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <defs>
        <linearGradient id="navSummary" gradientUnits="userSpaceOnUse" x1="12" y1="19" x2="12" y2="6">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
      </defs>
      <rect x="7.3" y="13.5" width="3" height="5.5" rx="0.6" fill="url(#navSummary)" />
      <rect x="11.3" y="10.5" width="3" height="8.5" rx="0.6" fill="url(#navSummary)" />
      <rect x="15.3" y="7.5" width="3" height="11.5" rx="0.6" fill="url(#navSummary)" />
      <path
        d="M6.5 15.6 C 9 15, 10.6 11.6, 13 11.1 S 16.9 8.6, 18.8 8.2"
        stroke="#FFFFFF"
        strokeOpacity="0.7"
        strokeWidth="1"
        strokeLinecap="round"
        fill="none"
      />
      <g stroke="#E5ECF5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M5 4.5 V19 H20" />
        <path d="M3.7 6 L5 4.4 L6.3 6" />
        <path d="M18.6 17.7 L20.2 19 L18.6 20.3" />
      </g>
    </svg>
  );
}

function SettlementIcon() {
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <defs>
        <linearGradient id="navSettleBlue" gradientUnits="userSpaceOnUse" x1="3" y1="6" x2="14" y2="18">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1E63D0" />
        </linearGradient>
        <linearGradient id="navSettleTeal" gradientUnits="userSpaceOnUse" x1="10" y1="6" x2="21" y2="18">
          <stop offset="0%" stopColor="#2DD4BF" />
          <stop offset="100%" stopColor="#0E8F86" />
        </linearGradient>
      </defs>
      <circle cx="9.3" cy="12" r="6.3" fill="url(#navSettleBlue)" fillOpacity="0.85" />
      <circle cx="14.7" cy="12" r="6.3" fill="url(#navSettleTeal)" fillOpacity="0.8" />
      <g stroke="#FAFAFA" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M7.8 10.4 H14.4" />
        <path d="M12.9 9 L14.8 10.4 L12.9 11.8" />
        <path d="M16.2 13.6 H9.6" />
        <path d="M11.1 12.2 L9.2 13.6 L11.1 15" />
      </g>
    </svg>
  );
}

function GroupsIcon() {
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <defs>
        <linearGradient id="navGroupsBlue" gradientUnits="userSpaceOnUse" x1="3" y1="6" x2="11" y2="18">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1E4FC4" />
        </linearGradient>
        <linearGradient id="navGroupsTeal" gradientUnits="userSpaceOnUse" x1="13" y1="6" x2="21" y2="18">
          <stop offset="0%" stopColor="#2DD4BF" />
          <stop offset="100%" stopColor="#0E8F86" />
        </linearGradient>
        <linearGradient id="navGroupsPink" gradientUnits="userSpaceOnUse" x1="8" y1="5" x2="16" y2="19">
          <stop offset="0%" stopColor="#F472B6" />
          <stop offset="55%" stopColor="#E0489E" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <circle cx="6.6" cy="9.3" r="2.8" fill="url(#navGroupsBlue)" />
      <path d="M2.4 17 A4.2 4.8 0 0 1 10.8 17 Z" fill="url(#navGroupsBlue)" />
      <circle cx="17.4" cy="9.3" r="2.8" fill="url(#navGroupsTeal)" />
      <path d="M13.2 17 A4.2 4.8 0 0 1 21.6 17 Z" fill="url(#navGroupsTeal)" />
      <circle cx="12" cy="8.5" r="3.5" fill="url(#navGroupsPink)" />
      <path d="M6.4 18.2 A5.6 6 0 0 1 17.6 18.2 Z" fill="url(#navGroupsPink)" />
    </svg>
  );
}

function NotificationsIcon() {
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <defs>
        <linearGradient id="navBell" gradientUnits="userSpaceOnUse" x1="6" y1="5" x2="18" y2="18">
          <stop offset="0%" stopColor="#2F80ED" />
          <stop offset="100%" stopColor="#17D4C6" />
        </linearGradient>
      </defs>
      {/* The bell artwork is tall/narrow, so it filled less of the viewBox than
          the other icons and looked shrunk. Scale it up about its centre to
          match their footprint. */}
      <g transform="translate(12 12) scale(1.2) translate(-12 -11.05)">
        <circle cx="12" cy="3.4" r="1.4" fill="url(#navBell)" />
        <path
          d="M12 4.6 C 8.7 4.6, 8 7.4, 8 10.5 C 8 13.5, 7.3 15, 6.4 16 L 17.6 16 C 16.7 15, 16 13.5, 16 10.5 C 16 7.4, 15.3 4.6, 12 4.6 Z"
          fill="url(#navBell)"
        />
        <rect x="5.8" y="15.4" width="12.4" height="2.3" rx="1.15" fill="url(#navBell)" />
        <path d="M9.9 18 A2.1 2.1 0 0 0 14.1 18 Z" fill="url(#navBell)" />
      </g>
    </svg>
  );
}

// href -> custom icon. Items absent here fall back to their emoji.
export const NAV_ICONS: Record<string, FC> = {
  "/": HomeIcon,
  "/add": AddIcon,
  "/log": LogIcon,
  "/summary": SummaryIcon,
  "/settlement": SettlementIcon,
  "/notifications": NotificationsIcon,
  "/groups": GroupsIcon,
};
