"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AddExpenseForm } from "@/app/(app)/add/AddExpenseForm";
import { getAddSetupAction } from "@/lib/actions/expenses";
import { SPLIT_EQUAL } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import type { AddSetup } from "@/lib/addSetup";
import { XIcon } from "@/components/Icons";

interface Opt {
  value: string;
  label: string;
}

interface OpenOptions {
  /** Context to add to. Defaults to the current group page, then the last used. */
  ctx?: string;
  /** Fix the context (group screen): no dropdown, the name is shown instead. */
  lock?: boolean;
}

const AddExpenseCtx = createContext<{ open: (o?: OpenOptions) => void } | null>(null);

export function useAddExpense() {
  const c = useContext(AddExpenseCtx);
  if (!c) throw new Error("useAddExpense must be used inside AddExpenseProvider");
  return c;
}

const LAST_KEY = "ledger.lastAddCtx";
const readLast = () => {
  try {
    return window.localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};
const writeLast = (ctx: string) => {
  try {
    window.localStorage.setItem(LAST_KEY, ctx);
  } catch {
    // Storage unavailable: the default just won't be remembered.
  }
};

/**
 * Mounted once in the app layout. Owns the Add Expense overlay so every entry
 * point (home button, group screen, sidebar, bottom nav) opens the same form
 * on top of the current screen instead of navigating away.
 */
export function AddExpenseProvider({
  contexts,
  offlineOwner,
  children,
}: {
  /** "Personal" first, then the user's groups. */
  contexts: Opt[];
  offlineOwner: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [state, setState] = useState<{ ctx: string; lock: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const open = useCallback(
    (o: OpenOptions = {}) => {
      const known = (c: string | null | undefined) =>
        c && contexts.some((x) => x.value === c) ? c : null;
      const pageCtx = pathname.match(/^\/g\/([^/]+)/)?.[1];
      const ctx =
        known(o.ctx) ??
        known(pageCtx ? decodeURIComponent(pageCtx) : null) ??
        known(readLast()) ??
        contexts[1]?.value ??
        "personal";
      setState({ ctx, lock: Boolean(o.lock && known(o.ctx)) });
    },
    [contexts, pathname],
  );

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <AddExpenseCtx.Provider value={{ open }}>
      {children}
      {state ? (
        <AddExpenseOverlay
          contexts={contexts}
          initialCtx={state.ctx}
          locked={state.lock}
          offlineOwner={offlineOwner}
          onClose={() => setState(null)}
          onSaved={(msg, ctx) => {
            writeLast(ctx);
            setState(null);
            setToast(msg);
          }}
        />
      ) : null}
      {toast ? (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 md:bottom-8"
        >
          <div className="toast-in rounded-lg border border-emerald-500/30 bg-surface px-4 py-2.5 text-sm text-positive shadow-xl">
            {toast}
          </div>
        </div>
      ) : null}
    </AddExpenseCtx.Provider>
  );
}

/** Button that opens the overlay. Usable from server components. */
export function AddExpenseButton({
  ctx,
  lock,
  className,
  children,
}: OpenOptions & { className?: string; children: React.ReactNode }) {
  const { open } = useAddExpense();
  return (
    <button type="button" className={className} onClick={() => open({ ctx, lock })}>
      {children}
    </button>
  );
}

function AddExpenseOverlay({
  contexts,
  initialCtx,
  locked,
  offlineOwner,
  onClose,
  onSaved,
}: {
  contexts: Opt[];
  initialCtx: string;
  locked: boolean;
  offlineOwner: string;
  onClose: () => void;
  onSaved: (message: string, ctx: string) => void;
}) {
  const [ctx, setCtx] = useState(initialCtx);
  const cache = useRef(new Map<string, AddSetup>());
  const [setup, setSetup] = useState<AddSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Load (or reuse) the form options for the chosen context.
  useEffect(() => {
    let live = true;
    setError(null);
    const hit = cache.current.get(ctx);
    if (hit) {
      setSetup(hit);
      return;
    }
    setSetup(null);
    getAddSetupAction(ctx)
      .then((res) => {
        if (!live) return;
        if (res.ok) {
          cache.current.set(ctx, res.setup);
          setSetup(res.setup);
        } else setError(res.error);
      })
      .catch(() => live && setError("offline"));
    return () => {
      live = false;
    };
  }, [ctx]);

  // Escape closes; the page behind does not scroll while the overlay is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  const name = contexts.find((c) => c.value === ctx)?.label ?? setup?.name ?? "";

  return (
    <div
      className="sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add expense"
        className="sheet card max-h-[92dvh] w-full space-y-4 overflow-y-auto overscroll-contain rounded-b-none md:max-w-xl md:rounded-xl"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="section-title">Add expense</h2>
            {locked ? (
              <p className="truncate text-sm text-muted">
                to <span className="font-semibold text-ink">{name}</span>
              </p>
            ) : null}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        {locked ? null : (
          <div>
            <label className="label" htmlFor="add-ctx">
              Add to
            </label>
            <select id="add-ctx" className="select" value={ctx} onChange={(e) => setCtx(e.target.value)}>
              {contexts.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {error ? (
          <div className="alert-error">
            {error === "offline" ? (
              <>
                Couldn&apos;t load this form. If you&apos;re offline,{" "}
                <Link href={`/add?ctx=${encodeURIComponent(ctx)}`} className="underline" onClick={onClose}>
                  open the full Add Expense page
                </Link>
                , which works offline.
              </>
            ) : (
              error
            )}
          </div>
        ) : !setup ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-ink/5" />
            ))}
          </div>
        ) : (
          <AddExpenseForm
            key={setup.ctx}
            bare
            ctx={setup.ctx}
            isPersonal={setup.isPersonal}
            categories={setup.categories}
            payerOptions={setup.payerOptions}
            splitOptions={setup.splitOptions}
            defaultPayer={setup.defaultPayer}
            defaultSplit={SPLIT_EQUAL}
            memberCount={setup.memberCount}
            offlineOwner={offlineOwner}
            onSaved={({ item, amount, offline }) =>
              onSaved(
                offline
                  ? `Saved offline: ${item}, ${formatINR(amount)}. It will sync when you're back online.`
                  : `Added ${item}, ${formatINR(amount)}, to ${setup.name}.`,
                setup.ctx,
              )
            }
          />
        )}

        <p className="text-xs text-muted">
          Have a receipt?{" "}
          <Link href={`/add?ctx=${encodeURIComponent(ctx)}`} className="underline" onClick={onClose}>
            Scan it on the full Add Expense page
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
