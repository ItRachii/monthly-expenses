"use client";

/* eslint-disable @next/next/no-img-element */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Members are shown by their Google photo instead of their name. Names still
// back everything else (search, selects, messages, screen readers): the photo
// carries the name as its accessible label, a hover title, and a tap bubble.

interface People {
  names: Record<string, string>;
  images: Record<string, string>;
}

const PeopleContext = createContext<People>({ names: {}, images: {} });

export function PeopleProvider({
  names,
  images,
  children,
}: People & { children: React.ReactNode }) {
  return <PeopleContext.Provider value={{ names, images }}>{children}</PeopleContext.Provider>;
}

export function usePersonName() {
  const { names } = useContext(PeopleContext);
  return (key: string) => names[key] ?? key;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// A steady hue per member, so two people without a photo still differ.
function hueFor(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}

const SIZES = {
  xs: "h-4 w-4 text-[7px]",
  sm: "h-6 w-6 text-[9px]",
  md: "h-8 w-8 text-[11px]",
} as const;

/**
 * A member's photo (or initials when there is none). `interactive` makes it a
 * button that shows the name on tap, for phones where there is no hover; turn
 * it off inside rows that already own the press (long-press rows).
 */
export function PersonAvatar({
  id,
  size = "sm",
  interactive = true,
  className = "",
}: {
  /** The member's wire key. */
  id: string;
  size?: keyof typeof SIZES;
  interactive?: boolean;
  className?: string;
}) {
  const { names, images } = useContext(PeopleContext);
  const name = names[id] ?? "Unknown member";
  const src = images[id];
  const [broken, setBroken] = useState(false);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!bubble) return;
    const hide = () => setBubble(null);
    const t = window.setTimeout(hide, 2500);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("pointerdown", hide);
    window.addEventListener("keydown", hide);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("pointerdown", hide);
      window.removeEventListener("keydown", hide);
    };
  }, [bubble]);

  const face =
    src && !broken ? (
      <img
        src={src}
        alt={interactive ? "" : name}
        title={interactive ? undefined : name}
        className={`${SIZES[size]} shrink-0 rounded-full object-cover`}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    ) : (
      <span
        role={interactive ? undefined : "img"}
        aria-label={interactive ? undefined : name}
        aria-hidden={interactive || undefined}
        title={interactive ? undefined : name}
        className={`${SIZES[size]} inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white`}
        style={{ backgroundColor: `hsl(${hueFor(id)} 45% 42%)` }}
      >
        {initials(name)}
      </span>
    );

  if (!interactive) {
    return <span className={`inline-flex shrink-0 align-middle ${className}`}>{face}</span>;
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={name}
        title={name}
        className={`inline-flex shrink-0 rounded-full align-middle outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (bubble) return setBubble(null);
          const r = ref.current!.getBoundingClientRect();
          setBubble({ x: r.left + r.width / 2, y: r.top });
        }}
      >
        {face}
      </button>
      {bubble
        ? createPortal(
            <span
              className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-full"
              style={{ left: Math.min(Math.max(bubble.x, 64), window.innerWidth - 64), top: bubble.y - 6 }}
            >
              <span
                role="status"
                className="toast-in block whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-background shadow-lg"
              >
                {name}
              </span>
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * Several members side by side, overlapping like a stack of coins; each
 * photo keeps its own name label and tap bubble.
 */
export function PersonAvatars({
  ids,
  size = "sm",
  interactive = true,
  className = "",
}: {
  ids: string[];
  size?: keyof typeof SIZES;
  interactive?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center ${className}`}>
      {ids.map((id, i) => (
        <PersonAvatar
          key={id}
          id={id}
          size={size}
          interactive={interactive}
          className={`rounded-full ring-2 ring-surface ${i > 0 ? "-ml-1.5" : ""}`}
        />
      ))}
    </span>
  );
}
