"use client";

import { AlertTriangleIcon, CalendarIcon, DownloadIcon, FilterIcon, PeopleIcon, PencilIcon, ReceiptIcon, TrashIcon, XIcon } from "@/components/Icons";
import { FilterHeader, RowCheckbox, SearchBox, SelectAllCheckbox, SortHeader, StatusPill, Th, sortRows, tableDate, useSort } from "@/components/table/Table";
import { PendingFlagButton, PendingFlagNote } from "@/components/PendingFlag";
import { DateBadge } from "@/components/DateBadge";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseDTO } from "@/lib/expenses";
import { SETTLE_EPS, round2, shareFor } from "@/lib/settlementMath";
import { formatINR } from "@/lib/format";
import { deleteExpenseAction } from "@/lib/actions/expenses";
import { EditExpenseModal } from "../../log/ExpenseLog";
import { ExportButton } from "./ExportDialog";
import { PersonAvatar } from "@/components/Person";

interface Opt {
  value: string;
  label: string;
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Your involvement in a group expense row, Splitwise-style. */
function involvement(
  r: ExpenseDTO,
  selfKey: string,
  memberCount: number,
): { label: string; amount: number | null; tone: "lent" | "borrowed" | "muted" } {
  // "you paid" with nothing lent means the whole cost was yours: no balance.
  const share = shareFor(r, selfKey, memberCount);
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
  lent: "text-positive",
  borrowed: "text-negative",
  muted: "text-muted",
} as const;

type SortKey = "date" | "item" | "category" | "amount";
const ALL = "all";

/** "2026-09" to "Sep 2026". */
function monthTab(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_SHORT[(m ?? 1) - 1]} ${y}`;
}

// The expenses list. Filter tabs (the two latest months, All, and Flagged
// when something needs attention), a toolbar with the count and total,
// bulk delete, export and search. Desktop shows a sortable table with a
// checkbox per row and edit/delete at the end; phones keep compact rows,
// where a long press opens edit and delete.
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
  const [query, setQuery] = useState("");
  const [sort, onSort] = useSort<SortKey>({ key: "date", dir: "desc" }, ["date", "amount"]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  // Month filter, beside the search: every month with expenses, newest
  // first, or all of them. Flagged is a separate toggle.
  const months = useMemo(
    () => Array.from(new Set(rows.map((r) => r.date.slice(0, 7)))).sort((a, b) => b.localeCompare(a)),
    [rows],
  );
  const flaggedCount = rows.filter((r) => r.flag).length;
  const [monthPick, setMonth] = useState<string | null>(null);
  // Until one is picked, the latest month; a pick that disappears (its last
  // expense deleted) falls back the same way.
  const month = monthPick === ALL || (monthPick && months.includes(monthPick)) ? monthPick : (months[0] ?? ALL);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const onlyFlagged = flaggedOnly && flaggedCount > 0;

  const payerLabel = (v: string) => nameMap[v] ?? v;

  // "Paid by" filter, from the table heading (groups only): one member or everyone.
  const [payer, setPayer] = useState<string | null>(null);
  const pickPayer = (v: string | null) => {
    setPayer(v);
    setSelected(new Set());
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inTab = rows.filter(
      (r) =>
        (month === ALL || r.date.startsWith(month)) &&
        (!onlyFlagged || Boolean(r.flag)) &&
        (!payer || r.payer === payer) &&
        (!q ||
          r.item.toLowerCase().includes(q) ||
          (r.category || "").toLowerCase().includes(q) ||
          (r.receiptMerchant ?? "").toLowerCase().includes(q) ||
          (!isPersonal && payerLabel(r.payer).toLowerCase().includes(q))),
    );
    return sortRows(inTab, sort, (r, k) =>
      k === "date" ? r.date : k === "amount" ? r.amount : k === "category" ? r.category || "Uncategorised" : r.item,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, month, onlyFlagged, payer, query, sort, isPersonal, nameMap]);
  const shownTotal = round2(shown.reduce((s, r) => s + r.amount, 0));

  // Selection only covers rows still on show; a deleted or filtered-out row drops out.
  const picked = shown.filter((r) => selected.has(r.id));
  const pickedTotal = round2(picked.reduce((s, r) => s + r.amount, 0));
  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function setAllShown(on: boolean) {
    setSelected(on ? new Set(shown.map((r) => r.id)) : new Set());
  }

  // Rows that appeared since the last render (your own add, or another
  // member's picked up by the live refresh) glow briefly.
  const seen = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const ids = rows.map((r) => r.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const prev = seen.current;
    const added = ids.filter((id) => !prev.has(id));
    seen.current = new Set(ids);
    if (added.length === 0) return;
    setFresh(new Set(added));
    const t = window.setTimeout(() => setFresh(new Set()), 4000);
    return () => window.clearTimeout(t);
  }, [rows]);

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

  /** Deletes the ticked expenses one by one, each with the same checks as a single delete. */
  function removePicked() {
    const ids = picked.map((r) => r.id);
    startTransition(async () => {
      for (const id of ids) await deleteExpenseAction(id);
      setSelected(new Set());
      setConfirmBulk(false);
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
      {/* Toolbar: count and total (or the selection's), bulk delete, export, search. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-muted" aria-live="polite">
          {picked.length > 0 ? (
            <>
              <span className="font-semibold text-ink">{picked.length} selected</span> · {formatINR(pickedTotal)}
            </>
          ) : (
            <>
              {shown.length} expense{shown.length === 1 ? "" : "s"} · <span className="font-semibold text-ink">{formatINR(shownTotal)}</span>
            </>
          )}
        </span>
        <button
          type="button"
          className="chip-btn max-md:hidden"
          disabled={picked.length === 0 || pending}
          onClick={() => setConfirmBulk(true)}
        >
          <TrashIcon className="h-4 w-4 text-negative" />
          Delete
        </button>
        <ExportButton ctx={ctx} minDate={minDate} maxDate={maxDate} className="chip-btn">
          <DownloadIcon className="h-4 w-4 text-muted" />
          Export
        </ExportButton>
        {flaggedCount > 0 ? (
          <button
            type="button"
            aria-pressed={onlyFlagged}
            className={`chip-btn ${onlyFlagged ? "border-warning/50 bg-warning/10" : ""}`}
            onClick={() => {
              setFlaggedOnly((f) => !f);
              setSelected(new Set());
            }}
          >
            <AlertTriangleIcon className="h-4 w-4 text-warning" />
            Flagged {flaggedCount}
          </button>
        ) : null}
        {payer ? (
          <button
            type="button"
            className="chip-btn border-primary/40 bg-primary/10"
            onClick={() => pickPayer(null)}
            aria-label={`Clear filter: paid by ${payerLabel(payer)}`}
            title={`Paid by ${payerLabel(payer)}`}
          >
            <FilterIcon className="h-4 w-4 text-primary-light" />
            <span className="max-w-[8rem] truncate">{payerLabel(payer)}</span>
            <XIcon className="h-4 w-4 text-muted" />
          </button>
        ) : null}
        {/* Search and the month filter share a row, on phones too. */}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <SearchBox value={query} onChange={setQuery} placeholder="Search expenses" className="min-w-0 flex-1 sm:w-64 sm:flex-none" />
          <label className="relative shrink-0">
            <span className="sr-only">Month</span>
            <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted sm:block" />
            {/* Month names only: the toolbar already gives the count and total
                of what is shown, and a narrow menu leaves the search room. */}
            <select
              className="select w-auto py-2 pl-3 pr-8 sm:pl-9"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setSelected(new Set());
              }}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthTab(m)}
                </option>
              ))}
              <option value={ALL}>All months</option>
            </select>
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {query.trim() ? `No expenses match "${query.trim()}".` : payer ? `No expenses paid by ${payerLabel(payer)}${month === ALL ? "" : ` in ${monthTab(month)}`}.` : "No expenses here."}
        </p>
      ) : (
        <>
        {/* Desktop: the table. Both layouts are in the page and CSS picks one,
            so there is no flash of the wrong one before scripts run. */}
        <div className="hidden overflow-hidden rounded-xl border border-ink/10 md:block">
          <table className="list-table">
            <thead>
              <tr>
                <th scope="col" className="w-12 px-3 py-3">
                  <SelectAllCheckbox selected={picked.length} total={shown.length} onChange={setAllShown} label="Select all expenses shown" />
                </th>
                <SortHeader label="Date" sortKey="date" sort={sort} onSort={onSort} className="w-28" />
                <SortHeader label="Item" sortKey="item" sort={sort} onSort={onSort} />
                <SortHeader label="Category" sortKey="category" sort={sort} onSort={onSort} className="w-32" />
                {isPersonal ? null : (
                  <FilterHeader
                    label="Paid by"
                    allLabel="Everyone"
                    allIcon={
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink/[0.08] text-muted">
                        <PeopleIcon className="h-4 w-4" />
                      </span>
                    }
                    options={payerOptions.map((o) => ({
                      value: o.value,
                      label: o.label,
                      icon: <PersonAvatar id={o.value} interactive={false} />,
                    }))}
                    value={payer}
                    onChange={pickPayer}
                    className="w-28"
                  />
                )}
                {isPersonal ? null : <Th className="w-36">Status</Th>}
                <SortHeader label="Amount" sortKey="amount" sort={sort} onSort={onSort} align="right" className="w-32" />
                <Th align="center" className="w-24">
                  Action
                </Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <ExpenseTableRow
                  key={r.id}
                  row={r}
                  checked={selected.has(r.id)}
                  isNew={fresh.has(r.id)}
                  paidBy={isPersonal ? null : r.payer}
                  inv={isPersonal ? null : involvement(r, selfKey, memberCount)}
                  pending={pending}
                  onToggle={() => toggle(r.id)}
                  onEdit={() => setEditing(r)}
                  onDelete={() => setActionsFor({ expense: r, confirm: true })}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Phones: compact rows; a long press opens edit and delete. */}
        <div className="space-y-2 md:hidden">
          <p className="text-xs text-muted">Press and hold an expense to edit or delete it.</p>
          <div className="card divide-y divide-ink/5 p-0">
            {shown.map((r) => {
              return (
                <ExpenseRow
                  key={r.id}
                  item={r.item}
                  receiptMerchant={r.receiptMerchant}
                  flag={r.flag}
                  date={r.date}
                  amount={r.amount}
                  paidBy={isPersonal ? null : payerLabel(r.payer)}
                  category={r.category || "Uncategorised"}
                  inv={isPersonal ? null : involvement(r, selfKey, memberCount)}
                  isDesktop={false}
                  isNew={fresh.has(r.id)}
                  pending={pending}
                  onOpenActions={() => setActionsFor({ expense: r, confirm: false })}
                  onEdit={() => setEditing(r)}
                  onDelete={() => setActionsFor({ expense: r, confirm: true })}
                />
              );
            })}
          </div>
        </div>
        </>
      )}

      {confirmBulk ? (
        <BulkDeleteDialog
          count={picked.length}
          total={pickedTotal}
          grouped={!isPersonal}
          pending={pending}
          onConfirm={removePicked}
          onClose={() => setConfirmBulk(false)}
        />
      ) : null}

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

/** One expense as a table row (desktop). */
function ExpenseTableRow({
  row,
  checked,
  isNew,
  paidBy,
  inv,
  pending,
  onToggle,
  onEdit,
  onDelete,
}: {
  row: ExpenseDTO;
  checked: boolean;
  isNew: boolean;
  /** Payer's member key; null in Personal. */
  paidBy: string | null;
  inv: ReturnType<typeof involvement> | null;
  pending: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [flagOpen, setFlagOpen] = useState(false);
  return (
    // 700ms is on purpose: past the 300ms UI budget, but this is the slow
    // fade-out of the "just added" highlight, not a reply to a click.
    <tr data-selected={checked || undefined} className={`duration-700 hover:bg-ink/[0.03] ${isNew ? "!bg-primary/15" : ""}`}>
      <td>
        <RowCheckbox checked={checked} onChange={onToggle} label={`Select ${row.item}`} />
      </td>
      <td className="whitespace-nowrap text-muted">{tableDate(row.date)}</td>
      <td className="max-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-semibold" title={row.item}>
            {row.item}
          </span>
          {row.receiptMerchant ? (
            <span className="shrink-0 rounded bg-ink/5 px-1 py-0.5 text-[10px] text-muted" title={`From scanned receipt: ${row.receiptMerchant}`}>
              <ReceiptIcon className="inline h-3 w-3 align-[-1px]" />
            </span>
          ) : null}
          {row.flag ? <PendingFlagButton reason={row.flag} open={flagOpen} onToggle={() => setFlagOpen((o) => !o)} /> : null}
        </div>
        {row.flag && flagOpen ? <PendingFlagNote reason={row.flag} /> : null}
      </td>
      <td className="truncate text-muted">{row.category || "Uncategorised"}</td>
      {paidBy !== null ? (
        <td>
          <PersonAvatar id={paidBy} />
        </td>
      ) : null}
      {inv ? (
        <td>
          <StatusPill tone={inv.tone === "lent" ? "positive" : inv.tone === "borrowed" ? "negative" : "neutral"}>
            {inv.amount !== null ? `${inv.label.replace(/^you/, "You")} ${formatINR(inv.amount)}` : inv.label.replace(/^./, (c) => c.toUpperCase())}
          </StatusPill>
        </td>
      ) : null}
      <td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatINR(row.amount)}</td>
      <td>
        <div className="flex items-center justify-center gap-1">
          <button type="button" className="icon-btn" onClick={onEdit} disabled={pending} aria-label={`Edit ${row.item}`} title="Edit">
            <PencilIcon />
          </button>
          <button
            type="button"
            className="icon-btn text-negative hover:text-negative"
            onClick={onDelete}
            disabled={pending}
            aria-label={`Delete ${row.item}`}
            title="Delete"
          >
            <TrashIcon />
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Confirms deleting the ticked expenses. */
function BulkDeleteDialog({
  count,
  total,
  grouped,
  pending,
  onConfirm,
  onClose,
}: {
  count: number;
  total: number;
  grouped: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bulk-delete-title"
        className="modal-pop card w-full max-w-sm space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="bulk-delete-title" className="section-title">
          Delete {count} expense{count === 1 ? "" : "s"}?
        </h2>
        <p className="text-sm text-muted">
          {formatINR(total)} in total. This cannot be undone{grouped ? ", and everyone in the group is told" : ""}.
        </p>
        <div className="flex justify-end gap-2">
          <button ref={cancel} type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={pending}>
            {pending ? "Deleting…" : `Delete ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

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
  flag,
  date,
  amount,
  paidBy,
  category,
  inv,
  isDesktop,
  isNew,
  pending,
  onOpenActions,
  onEdit,
  onDelete,
}: {
  item: string;
  receiptMerchant: string | null;
  /** Why the row needs attention, shown behind a warning icon; null when nothing is pending. */
  flag: string | null;
  /** ISO date, shown as the month over the day. */
  date: string;
  amount: number;
  /** Payer's display name; null in Personal, where there is only you. */
  paidBy: string | null;
  category: string;
  inv: ReturnType<typeof involvement> | null;
  isDesktop: boolean;
  /** Just added: highlighted for a few seconds. */
  isNew: boolean;
  pending: boolean;
  onOpenActions: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [flagOpen, setFlagOpen] = useState(false);
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
    // 700ms is on purpose: past the 300ms UI budget, but this is the slow
    // fade-out of the "just added" highlight, not a reply to a tap. Faster
    // and the eye misses which row was new.
    <div
      {...(isDesktop ? {} : pressable)}
      className={`flex items-center gap-3 px-3 py-2.5 transition-colors duration-700 ${
        isNew ? "bg-primary/15" : ""
      } ${
        isDesktop
          ? ""
          : "cursor-default touch-pan-y select-none outline-none transition [-webkit-touch-callout:none] focus-visible:bg-ink/5 active:bg-ink/5"
      }`}
    >
      <DateBadge iso={date} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {item}
          {receiptMerchant ? (
            <span
              className="ml-1 rounded bg-ink/5 px-1 py-0.5 text-[10px] text-muted"
              title={`From scanned receipt: ${receiptMerchant}`}
            >
              <ReceiptIcon className="inline h-3 w-3 align-[-1px]" />
            </span>
          ) : null}
          {flag ? <PendingFlagButton reason={flag} open={flagOpen} onToggle={() => setFlagOpen((o) => !o)} /> : null}
        </div>
        {flag && flagOpen ? <PendingFlagNote reason={flag} /> : null}
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
          className="icon-btn text-negative hover:text-negative"
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
  const row = "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-base transition hover:bg-ink/5 disabled:opacity-50";

  return (
    <div
      className="sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-4"
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
        className="sheet card w-full space-y-1 rounded-b-none p-3 md:max-w-sm md:rounded-xl"
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
              className={`${row} text-negative`}
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
