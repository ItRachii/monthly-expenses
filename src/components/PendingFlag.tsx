"use client";

import { useState } from "react";
import { AlertTriangleIcon } from "./Icons";

/**
 * Warning icon next to an expense that needs attention. The reason shows on
 * hover through the native tooltip, and on tap or click as a note below,
 * for phones that have no hover.
 */
export function PendingFlagButton({ reason, open, onToggle }: { reason: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="ml-1 inline-flex rounded p-0.5 align-[-2px] text-warning hover:bg-amber-400/10"
      title={reason}
      aria-label="Needs attention"
      aria-expanded={open}
      data-flag
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <AlertTriangleIcon className="h-3.5 w-3.5" />
    </button>
  );
}

export function PendingFlagNote({ reason }: { reason: string }) {
  return (
    <div className="mt-1 whitespace-normal rounded-md border border-amber-400/30 bg-amber-400/5 px-2 py-1 text-xs text-warning" data-flag-note>
      {reason}
    </div>
  );
}

/** Icon and note together, with their own open state. */
export function PendingFlag({ reason }: { reason: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PendingFlagButton reason={reason} open={open} onToggle={() => setOpen((o) => !o)} />
      {open ? <PendingFlagNote reason={reason} /> : null}
    </>
  );
}
