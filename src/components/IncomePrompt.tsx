"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "@/components/Icons";
import { dismissIncomePromptAction, saveIncomeAction } from "@/lib/actions/income";

/** Digits with an optional decimal point and up to two decimals. */
export function isMoneyInput(v: string): boolean {
  return v === "" || /^\d*\.?\d{0,2}$/.test(v);
}

/**
 * Asks for the monthly income. As a popup (existing users without one) it
 * offers "Remind me later" and "Skip"; opened from the Personal page it only
 * has Cancel. Either way it saves through the same action.
 */
export function IncomeDialog({
  variant,
  onClose,
}: {
  variant: "popup" | "inline";
  onClose: () => void;
}) {
  const [income, setIncome] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const popup = variant === "popup";

  // Escape counts as "Remind me later" for the popup, Cancel otherwise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) (popup ? dismiss("later") : onClose());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!income.trim()) {
      setError("Enter your monthly income, or choose Skip.");
      return;
    }
    startTransition(async () => {
      const res = await saveIncomeAction(income);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
      onClose();
    });
  }

  function dismiss(choice: "later" | "skipped") {
    startTransition(async () => {
      await dismissIncomePromptAction(choice);
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="sheet-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="income-title"
        onSubmit={save}
        className="modal-pop card w-full max-w-md space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="income-title" className="section-title">
              What is your monthly income?
            </h2>
            <p className="mt-1 text-sm text-muted">
              Your fixed take-home pay. We use it to show what you save each month after personal
              spending and your share in groups.
            </p>
          </div>
          {!popup ? (
            <button type="button" className="icon-btn shrink-0" onClick={onClose} aria-label="Close">
              <XIcon />
            </button>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor="income-amount">
            Monthly income (₹)
          </label>
          <input
            id="income-amount"
            className="input"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 50000"
            value={income}
            onChange={(e) => {
              if (isMoneyInput(e.target.value)) setIncome(e.target.value);
              setError(null);
            }}
            autoFocus
          />
          <p className="mt-1 text-xs text-muted">You can change it any time on your profile.</p>
        </div>

        {error ? <div className="alert-error">{error}</div> : null}

        <button type="submit" className="btn-primary w-full" disabled={pending}>
          {pending ? "Saving…" : "Save income"}
        </button>
        {popup ? (
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={pending}
              onClick={() => dismiss("later")}
            >
              Remind me later
            </button>
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={pending}
              onClick={() => dismiss("skipped")}
            >
              Skip
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}

/** Mounted by the app layout when an existing user should see the popup. */
export function IncomePromptHost() {
  const [open, setOpen] = useState(true);
  return open ? <IncomeDialog variant="popup" onClose={() => setOpen(false)} /> : null;
}

/** Opens the income dialog from anywhere, e.g. the Personal page's reminder. */
export function AddIncomeButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open ? <IncomeDialog variant="inline" onClose={() => setOpen(false)} /> : null}
    </>
  );
}
