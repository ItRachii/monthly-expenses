"use client";

import { PencilIcon, ReceiptIcon, TrashIcon } from "@/components/Icons";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseDTO } from "@/lib/expenses";
import { SPLIT_EQUAL } from "@/lib/constants";
import { SETTLE_EPS, round2 } from "@/lib/settlementMath";
import { formatINR } from "@/lib/format";
import { deleteExpenseAction } from "@/lib/actions/expenses";
import { EditExpenseModal } from "../../log/ExpenseLog";
import { ExportButton } from "./ExportDialog";

interface Opt {
  value: string;
  label: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1]} ${y}`;
}

/** Your involvement in a group expense row, Splitwise-style. */
function involvement(
  r: ExpenseDTO,
  selfKey: string,
  memberCount: number,
): { label: string; amount: number | null; tone: "lent" | "borrowed" | "muted" } {
  // "you paid" with nothing lent means the whole cost was yours: no balance.
  const share =
    r.split === SPLIT_EQUAL
      ? memberCount > 0
        ? r.amount / memberCount
        : 0
      : r.split === selfKey
      ? r.amount
      : 0;
  if (r.payer === selfKey) {
    const lent = round2(r.amount - share);
    return lent > SETTLE_EPS
      ? { label: "you lent", amount: lent, tone: "lent" }
      : { label: "no balance", amount: null, tone: "muted" };
  }
  const borrowed = round2(share);
  return borrowed > SETTLE_EPS
    ? { label: "you borrowed", amount: borrowed, tone: "borrowed" }
    : { label: "not involved", amount: null, tone: "muted" };
}

const TONE = {
  lent: "text-emerald-400",
  borrowed: "text-red-400",
  muted: "text-muted",
} as const;

// Splitwise-style expense feed: rows grouped by month, each month section
// collapsible (latest month open by default). Edit/delete live in an action
// sheet opened by long-pressing a row (or right-click / keyboard), plus Excel export.
export function ExpenseFeed({
  ctx,
  rows,
  nameMap,
  categories,
  payerOptions,
  splitOptions,
  isPersonal,
  selfKey,
  memberCount,
}: {
  ctx: string;
  rows: ExpenseDTO[];
  nameMap: Record<string, string>;
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
  isPersonal: boolean;
  selfKey: string;
  memberCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ExpenseDTO | null>(null);
  const [actionsFor, setActionsFor] = useState<{ expense: ExpenseDTO; confirm: boolean } | null>(
    null,
  );
  const isDesktop = useIsDesktop();
  // Months the user explicitly toggled; anything untouched follows the
  // default of "latest month open, the rest minimised".
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const sections = useMemo(() => {
    const map = new Map<string, ExpenseDTO[]>();
    for (const r of rows) {
      const k = r.date.slice(0, 7);
      const list = map.get(k);
      if (list) list.push(r);
      else map.set(k, [r]);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, list]) => ({
        key,
        list,
        total: round2(list.reduce((s, r) => s + r.amount, 0)),
      }));
  }, [rows]);

  const latest = sections[0]?.key;
  const isOpen = (key: string) => toggled[key] ?? key === latest;

  const payerLabel = (v: string) => nameMap[v] ?? v;

  // rows arrive newest first, so the range bounds are the ends of the list.
  const maxDate = rows[0]?.date ?? "";
  const minDate = rows[rows.length - 1]?.date ?? "";

  function remove(id: number) {
    startTransition(async () => {
      await deleteExpenseAction(id);
      setActionsFor(null);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="alert-info">
        No expenses recorded yet. Tap <strong>Add expense</strong> to get started.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted md:hidden">Press and hold an expense to edit or delete it.</p>
      {sections.map((sec) => (
        <section key={sec.key} className="space-y-1">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-left transition hover:bg-white/5"
            aria-expanded={isOpen(sec.key)}
            onClick={() => setToggled((t) => ({ ...t, [sec.key]: !isOpen(sec.key) }))}
          >
            <span className="text-sm font-semibold text-muted">
              {monthLabel(sec.key)}
              <span className="ml-2 font-normal">
                · {sec.list.length} expense{sec.list.length === 1 ? "" : "s"}
              </span>
            </span>
            <span className="flex items-center gap-2 text-sm text-muted">
              {formatINR(sec.total)}
              <span
                aria-hidden
                className={`inline-block transition-transform ${
                  isOpen(sec.key) ? "rotate-180" : ""
                }`}
              >
                ▾
              </span>
            </span>
          </button>

          {isOpen(sec.key) ? (
            <div className="card divide-y divide-white/5 p-0">
              {sec.list.map((r) => {
                const [, m, d] = r.date.split("-").map(Number);
                const inv = isPersonal ? null : involvement(r, selfKey, memberCount);
                return (
                  <ExpenseRow
                    key={r.id}
                    item={r.item}
                    receiptMerchant={r.receiptMerchant}
                    month={MONTH_SHORT[(m ?? 1) - 1]}
                    day={String(d).padStart(2, "0")}
                    amount={r.amount}
                    paidBy={isPersonal ? null : payerLabel(r.payer)}
                    category={r.category || "Uncategorised"}
                    inv={inv}
                    isDesktop={isDesktop}
                    pending={pending}
                    onOpenActions={() => setActionsFor({ expense: r, confirm: false })}
                    onEdit={() => setEditing(r)}
                    onDelete={() => setActionsFor({ expense: r, confirm: true })}
                  />
                );
              })}
            </div>
          ) : null}
        </section>
      ))}

      <ExportButton ctx={ctx} minDate={minDate} maxDate={maxDate} />

      {actionsFor ? (
        <ExpenseActions
          expense={actionsFor.expense}
          startConfirming={actionsFor.confirm}
          pending={pending}
          onEdit={() => {
            setEditing(actionsFor.expense);
            setActionsFor(null);
          }}
          onDelete={() => remove(actionsFor.expense.id)}
          onClose={() => setActionsFor(null)}
        />
      ) : null}

      {editing ? (
        <EditExpenseModal
          expense={editing}
          categories={categories}
          payerOptions={payerOptions}
          splitOptions={splitOptions}
          nameMap={nameMap}
          isPersonal={isPersonal}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;
// Same breakpoint as the app shell (Tailwind md): below it the phone layout
// and bottom nav show, at or above it the desktop sidebar does.
const DESKTOP_QUERY = "(min-width: 768px)";

/** True on desktop widths. False during SSR and the first client render. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

/**
 * One expense row, two layouts:
 * - Phone: the amount paid sits under the item name, your share on the right.
 *   Press and hold (or the keyboard: Enter, Space, the Menu key, Shift+F10)
 *   opens the edit/delete sheet.
 * - Desktop: "X paid" + amount and your share as two aligned columns, with
 *   edit and delete icons at the end of the row. No long press.
 */
function ExpenseRow({
  item,
  receiptMerchant,
  month,
  day,
  amount,
  paidBy,
  category,
  inv,
  isDesktop,
  pending,
  onOpenActions,
  onEdit,
  onDelete,
}: {
  item: string;
  receiptMerchant: string | null;
  month: string;
  day: string;
  amount: number;
  /** Payer's display name; null in Personal, where there is only you. */
  paidBy: string | null;
  category: string;
  inv: ReturnType<typeof involvement> | null;
  isDesktop: boolean;
  pending: boolean;
  onOpenActions: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  function cancel() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }
  useEffect(() => cancel, []);
  useEffect(() => {
    if (isDesktop) cancel();
  }, [isDesktop]);

  const pressable = {
    role: "button",
    tabIndex: 0,
    "aria-haspopup": "dialog" as const,
    "aria-label": `${item}, ${formatINR(amount)}. Press and hold for edit or delete.`,
    onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        fired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          fired.current = true;
          timer.current = null;
          navigator.vibrate?.(10);
          onOpenActions();
        }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_TOLERANCE_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      // Android fires this on long press too; skip it when the timer already
      // opened the sheet.
      e.preventDefault();
      cancel();
      if (!fired.current) onOpenActions();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (
        e.key === "Enter" ||
        e.key === " " ||
        e.key === "ContextMenu" ||
        (e.shiftKey && e.key === "F10")
      ) {
        e.preventDefault();
        onOpenActions();
      }
    },
  };

  return (
    <div
      {...(isDesktop ? {} : pressable)}
      className={`flex items-center gap-3 px-3 py-2.5 ${
        isDesktop
          ? ""
          : "cursor-default touch-pan-y select-none outline-none transition [-webkit-touch-callout:none] focus-visible:bg-white/5 active:bg-white/5"
      }`}
    >
      <div className="w-9 shrink-0 text-center leading-tight">
        <div className="text-[10px] uppercase text-muted">{month}</div>
        <div className="text-base font-semibold">{day}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {item}
          {receiptMerchant ? (
            <span
              className="ml-1 rounded bg-white/5 px-1 py-0.5 text-[10px] text-muted"
              title={`From scanned receipt: ${receiptMerchant}`}
            >
              <ReceiptIcon className="inline h-3 w-3 align-[-1px]" />
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">
          <span className="md:hidden">
            {paidBy ? `${paidBy} paid ` : null}
            <span className="text-sm font-semibold text-ink">{formatINR(amount)}</span>
            {" · "}
          </span>
          {category}
        </div>
      </div>
      {/* Desktop only: who paid and the full amount as its own column. */}
      <div className="hidden w-28 shrink-0 text-right md:block">
        <div className="truncate text-[11px] text-muted">{paidBy ? `${paidBy} paid` : "spent"}</div>
        <div className="text-sm font-semibold text-ink">{formatINR(amount)}</div>
      </div>
      {inv ? (
        <div className="w-24 shrink-0 text-right md:w-28">
          <div className={`truncate text-[11px] ${TONE[inv.tone]}`}>{inv.label}</div>
          <div className={`text-sm font-semibold ${TONE[inv.tone]}`}>
            {formatINR(inv.amount ?? 0)}
          </div>
        </div>
      ) : null}
      {/* Desktop only: inline edit/delete. Phones use the long-press sheet. */}
      <div className="hidden shrink-0 items-center gap-1 md:flex">
        <button
          type="button"
          className="icon-btn"
          onClick={onEdit}
          disabled={pending}
          aria-label={`Edit ${item}`}
          title="Edit"
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          className="icon-btn text-red-400 hover:text-red-300"
          onClick={onDelete}
          disabled={pending}
          aria-label={`Delete ${item}`}
          title="Delete"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

/** Bottom sheet (centred dialog on desktop) with Edit and a confirmed Delete. */
function ExpenseActions({
  expense,
  startConfirming = false,
  pending,
  onEdit,
  onDelete,
  onClose,
}: {
  expense: ExpenseDTO;
  /** Open directly on the delete confirmation (desktop trash icon). */
  startConfirming?: boolean;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(startConfirming);
  const first = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // The finger that long-pressed to open the sheet is still down; lifting it
  // produces a click on whatever is now under it (the backdrop or an action).
  // Ignore pointer clicks until a fresh press starts inside the sheet.
  // Keyboard activation (detail 0) is always allowed.
  const armed = useRef(false);

  // Focus the first action on open and again when the delete step appears.
  useEffect(() => {
    first.current?.focus();
  }, [confirming]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [, m, d] = expense.date.split("-").map(Number);
  const row = "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-base transition hover:bg-white/5 disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-4"
      onPointerDownCapture={() => {
        armed.current = true;
      }}
      onClickCapture={(e) => {
        if (e.detail !== 0 && !armed.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Actions for ${expense.item}`}
        className="card w-full space-y-1 rounded-b-none p-3 md:max-w-sm md:rounded-xl"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="px-3 pb-2 pt-1">
          <div className="truncate font-semibold">{expense.item}</div>
          <div className="text-xs text-muted">
            {formatINR(expense.amount)} · {MONTH_SHORT[(m ?? 1) - 1]} {d}
          </div>
        </div>

        {confirming ? (
          <div className="space-y-3 px-3 py-2">
            <p className="text-sm">Delete this expense? This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                ref={first}
                type="button"
                className="btn-danger flex-1"
                disabled={pending}
                onClick={onDelete}
              >
                <TrashIcon className="h-4 w-4" />
                {pending ? "Deleting…" : "Delete"}
              </button>
              <button
                type="button"
                className="btn-secondary flex-1"
                disabled={pending}
                onClick={() => (startConfirming ? onClose() : setConfirming(false))}
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <>
            <button ref={first} type="button" className={row} onClick={onEdit}>
              <PencilIcon className="h-5 w-5 text-muted" />
              Edit expense
            </button>
            <button
              type="button"
              className={`${row} text-red-400`}
              onClick={() => setConfirming(true)}
            >
              <TrashIcon />
              Delete expense
            </button>
            <button type="button" className={`${row} justify-center text-muted`} onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
