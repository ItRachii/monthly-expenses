"use client";

import { useEffect } from "react";
import { XIcon } from "./Icons";

// Shared by the Expenses and Balances tabs when a notification is opened:
// bring the highlighted record into view once, and say what it was about.

// Notifications already landed on in this visit, so switching tabs and
// back does not jump to the record again.
export const landedNotifications = new Set<number>();

/**
 * Scrolls the first highlighted record ([data-landing]) on screen into the
 * middle of the view after the first paint, or the note when there is none.
 * Only the visible layout counts: phones and desktop render their own rows.
 */
export function useLandingScroll(notificationId: number | null, active: boolean) {
  useEffect(() => {
    if (notificationId === null || !active) return;
    landedNotifications.add(notificationId);
    const frame = window.requestAnimationFrame(() => {
      const target =
        Array.from(document.querySelectorAll<HTMLElement>("[data-landing]")).find((el) => el.getClientRects().length > 0) ??
        document.querySelector<HTMLElement>("[data-landing-note]");
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** What the notification was about and where it is, with a way to clear it. */
export function LandingNote({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div data-landing-note role="status" className="alert-info flex items-start gap-3">
      <p className="min-w-0 flex-1">{children}</p>
      <button type="button" className="icon-btn -m-1 shrink-0" aria-label="Dismiss" onClick={onDismiss}>
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

/** A small label on the highlighted record saying what happened to it. */
export function LandingPill({ children, tone = "primary", className = "" }: { children: React.ReactNode; tone?: "primary" | "negative"; className?: string }) {
  const colors = tone === "negative" ? "bg-negative/15 text-negative" : "bg-primary/20 text-primary-light";
  return (
    <span className={`inline-block shrink-0 rounded-full px-1.5 py-px align-[1px] text-[10px] font-semibold uppercase tracking-wide ${colors} ${className}`}>
      {children}
    </span>
  );
}
