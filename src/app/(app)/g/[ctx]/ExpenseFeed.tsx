"use client";

import { AlertTriangleIcon, CalendarIcon, ChevronDownIcon, DownloadIcon, PeopleIcon, PencilIcon, ReceiptIcon, TrashIcon } from "@/components/Icons";
import { ActiveFilters, DateRangeHeader, FilterHeader, RowCheckbox, rangeLabel, type DateRange, SearchBox, SelectAllCheckbox, SortHeader, StatusPill, Th, sortRows, tableDate, useSort } from "@/components/table/Table";
import { PendingFlagButton, PendingFlagNote } from "@/components/PendingFlag";
import { DateBadge } from "@/components/DateBadge";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseDTO } from "@/lib/expenses";
import { SETTLE_EPS, paidFor, payersOf, round2, shareFor } from "@/lib/settlementMath";
import { formatINR, listNames } from "@/lib/format";
import { deleteExpenseAction } from "@/lib/actions/expenses";
import { EditExpenseModal } from "@/components/EditExpenseModal";
import { ExportButton } from "./ExportDialog";
import { PersonAvatar, PersonAvatars } from "@/components/Person";
import type { DeletedExpense, NotificationFocus } from "@/lib/notifications";
import { landingFor, placeGhosts, type Landing } from "@/lib/landing";
import { entryValue, groupReceipts, type ReceiptGroup } from "@/lib/receiptGroups";
import { LandingNote, LandingPill, landedNotifications, useLandingScroll } from "@/components/Landing";

interface Opt {
  value: string;
  label: string;
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Your involvement in a group expense row (or a receipt's rows together), Splitwise-style. */
function involvement(
  rows: ExpenseDTO | ExpenseDTO[],
  selfKey: string,
  memberCount: number,
): { label: string; amount: number | null; tone: "lent" | "borrowed" | "muted" } {
  // What you put in against your share. Paying exactly your share (the whole
  // cost when it was all yours) leaves no balance either way.
  const list = Array.isArray(rows) ? rows : [rows];
  const share = list.reduce((s, r) => s + shareFor(r, selfKey, memberCount), 0);
  const paid = list.reduce((s, r) => s + paidFor(r, selfKey), 0);
  const net = round2(paid - share);
  if (net > SETTLE_EPS) return { label: "you lent", amount: net, tone: "lent" };
  if (net < -SETTLE_EPS) return { label: "you borrowed", amount: -net, tone: "borrowed" };
  return paid > 0 || share > 0
    ? { label: "no balance", amount: null, tone: "muted" }
    : { label: "not involved", amount: null, tone: "muted" };
}

const TONE = {
  lent: "text-positive",
  borrowed: "text-negative",
  muted: "text-muted",
} as const;

type SortKey = "date" | "item" | "category" | "amount";
const ALL = "all";
const categoryOf = (r: ExpenseDTO) => r.category || "Uncategorised";

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
  focus = null,
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
  /** Opened from a notification: the record to land on. */
  focus?: NotificationFocus | null;
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
  // Why the last delete failed, and which dialog started it ("bulk", or the
  // expense's id): shown there only, so a refusal that arrives after its
  // dialog was closed never turns up in the next one.
  const [deleteError, setDeleteError] = useState<{ from: "bulk" | number; text: string } | null>(null);
  const errorFor = (from: "bulk" | number) => (deleteError?.from === from ? deleteError.text : null);

  // Opened from a notification: highlight what it was about, or show what
  // was deleted crossed out where it was, on that month, filters cleared.
  const [landing, setLanding] = useState<Landing | null>(() =>
    focus && !landedNotifications.has(focus.id) ? landingFor(focus, rows) : null,
  );
  const marked = useMemo(() => new Set(landing?.kind === "expenses" ? landing.ids : []), [landing]);
  const ghosts = landing?.kind === "deleted" ? landing.ghosts : [];

  // Month filter, beside the search: every month with expenses, newest
  // first, or all of them. Flagged is a separate toggle. A deleted expense
  // being shown keeps its month listed even when it was the month's last.
  const months = useMemo(
    () =>
      Array.from(new Set([...rows.map((r) => r.date.slice(0, 7)), ...ghosts.map((g) => g.date.slice(0, 7))])).sort((a, b) =>
        b.localeCompare(a),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, landing],
  );
  const flaggedCount = rows.filter((r) => r.flag).length;
  const [monthPick, setMonth] = useState<string | null>(() => landing?.month ?? null);
  // Until one is picked, the latest month; a pick that disappears (its last
  // expense deleted) falls back the same way.
  const month = monthPick === ALL || (monthPick && months.includes(monthPick)) ? monthPick : (months[0] ?? ALL);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const onlyFlagged = flaggedOnly && flaggedCount > 0;

  const payerLabel = (r: ExpenseDTO) => listNames(payersOf(r).map((k) => nameMap[k] ?? k));

  // Column filters, from the table headings: one category, one payer
  // (groups only), a date range. A range replaces the month picker's scope,
  // and picking a month drops the range, so the two never contradict.
  const [payer, setPayer] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);
  const pickPayer = (v: string | null) => {
    setPayer(v);
    setSelected(new Set());
  };
  const pickCategory = (v: string | null) => {
    setCategory(v);
    setSelected(new Set());
  };
  const pickRange = (v: DateRange | null) => {
    setRange(v);
    if (v) setMonth(ALL);
    setSelected(new Set());
  };
  // Flagged shows every flagged expense whatever its month: turning it on
  // widens to All months (dropping a date range), and turning it off puts
  // back the month and range from before, unless another was picked since.
  const [beforeFlagged, setBeforeFlagged] = useState<{ month: string | null; range: DateRange | null } | null>(null);
  const toggleFlagged = () => {
    if (!onlyFlagged) {
      setBeforeFlagged({ month: monthPick, range });
      setMonth(ALL);
      setRange(null);
      setFlaggedOnly(true);
    } else {
      if (beforeFlagged && month === ALL && !range) {
        setMonth(beforeFlagged.month);
        setRange(beforeFlagged.range);
      }
      setBeforeFlagged(null);
      setFlaggedOnly(false);
    }
    setSelected(new Set());
  };
  const categoryOptions = useMemo(
    () =>
      Array.from(new Set(rows.map(categoryOf)))
        .sort((a, b) => a.localeCompare(b))
        .map((c) => ({ value: c, label: c })),
    [rows],
  );
  const filterCount = (payer ? 1 : 0) + (category ? 1 : 0) + (range ? 1 : 0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inTab = rows.filter(
      (r) =>
        (month === ALL || r.date.startsWith(month)) &&
        (!onlyFlagged || Boolean(r.flag)) &&
        (!payer || payersOf(r).includes(payer)) &&
        (!category || categoryOf(r) === category) &&
        (!range?.from || r.date >= range.from) &&
        (!range?.to || r.date <= range.to) &&
        (!q ||
          r.item.toLowerCase().includes(q) ||
          (r.category || "").toLowerCase().includes(q) ||
          (r.receiptMerchant ?? "").toLowerCase().includes(q) ||
          (!isPersonal && payerLabel(r).toLowerCase().includes(q))),
    );
    return inTab;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, month, onlyFlagged, payer, category, range, query, isPersonal, nameMap]);
  // A scanned receipt's rows fold into one entry, then the entries are
  // sorted, so a receipt sits where its own date, total or name puts it.
  const entries = useMemo(() => sortRows(groupReceipts(shown), sort, entryValue), [shown, sort]);
  const shownTotal = round2(shown.reduce((s, r) => s + r.amount, 0));
  // Deleted expenses from the notification, in their month and only while
  // nothing narrows the list (they matched no filter; they no longer exist).
  const narrowed = Boolean(query.trim()) || filterCount > 0 || onlyFlagged;
  const placed = placeGhosts(
    entries,
    narrowed ? [] : ghosts.filter((g) => month === ALL || g.date.startsWith(month)),
    sort.key === "date" ? sort.dir : null,
  );

  // A receipt's items list under it when it is opened. One a notification
  // points into is open from the start, and follows the notification when it
  // changes; a click flips whichever it was.
  const landingOpen = useMemo(
    () => new Set(rows.filter((r) => r.receiptId && marked.has(r.id)).map((r) => r.receiptId!)),
    [rows, marked],
  );
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  const isOpen = (id: string) => landingOpen.has(id) !== flipped.has(id);
  const toggleReceipt = (id: string) =>
    setFlipped((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  
  // Bring the highlighted (or crossed-out) record into view once.
  useLandingScroll(focus?.id ?? null, landing !== null);

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
  function setMany(ids: number[], on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
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

  function closeActions() {
    setActionsFor(null);
    setDeleteError(null);
  }

  /** Deletes one expense; if the server refuses, the sheet stays open and says why. */
  function remove(id: number) {
    setDeleteError(null);
    startTransition(async () => {
      const res = await deleteExpenseAction(id).catch(() => null);
      if (res?.ok) setActionsFor(null);
      else setDeleteError({ from: id, text: res?.error ?? "Something went wrong." });
      router.refresh();
    });
  }

  /**
   * Deletes the ticked expenses one by one, each with the same checks as a
   * single delete. Any the server refuses stay ticked, and the dialog stays
   * open to say how many and why.
   */
  function removePicked() {
    const ids = picked.map((r) => r.id);
    setDeleteError(null);
    startTransition(async () => {
      const failed: number[] = [];
      let reason: string | null = null;
      for (const id of ids) {
        const res = await deleteExpenseAction(id).catch(() => null);
        if (!res?.ok) {
          failed.push(id);
          reason ??= res?.error ?? "Something went wrong.";
        }
      }
      setSelected(new Set(failed));
      if (failed.length === 0) setConfirmBulk(false);
      else setDeleteError({ from: "bulk", text: `${failed.length} of ${ids.length} could not be deleted. ${reason}` });
      router.refresh();
    });
  }

  if (rows.length === 0 && !landing) {
    return (
      <div className="alert-info">
        No expenses recorded yet. Tap <strong>Add expense</strong> to get started.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {landing ? <LandingBanner landing={landing} month={month} onDismiss={() => setLanding(null)} /> : null}
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
          onClick={() => {
            setDeleteError(null);
            setConfirmBulk(true);
          }}
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
            onClick={toggleFlagged}
          >
            <AlertTriangleIcon className="h-4 w-4 text-warning" />
            Flagged {flaggedCount}
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
                setRange(null);
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

      {/* Active column filters, each removable on its own. */}
      <ActiveFilters
        filters={[
          range ? { label: `Date: ${rangeLabel(range)}`, onClear: () => pickRange(null) } : null,
          category ? { label: `Category: ${category}`, onClear: () => pickCategory(null) } : null,
          payer ? { label: `Paid by: ${nameMap[payer] ?? payer}`, onClear: () => pickPayer(null) } : null,
        ]}
        onClearAll={() => {
          setPayer(null);
          setCategory(null);
          setRange(null);
          setSelected(new Set());
        }}
      />

      {placed.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {query.trim()
            ? `No expenses match "${query.trim()}".`
            : filterCount > 0
              ? `No expenses match these filters${month === ALL ? "" : ` in ${monthTab(month)}`}.`
              : "No expenses here."}
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
                <DateRangeHeader label="Date" value={range} onChange={pickRange} min={minDate} max={maxDate} sort={{ sortKey: "date", sort, onSort }} className="w-28" />
                <SortHeader label="Item" sortKey="item" sort={sort} onSort={onSort} />
                <FilterHeader
                  label="Category"
                  allLabel="All categories"
                  options={categoryOptions}
                  value={category}
                  onChange={pickCategory}
                  sort={{ sortKey: "category" as SortKey, sort, onSort }}
                  className="w-32"
                />
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
                <SortHeader label="Amount" sortKey="amount" sort={sort} onSort={onSort} align="right" className="w-28" />
                <Th align="center" className="w-24">
                  Action
                </Th>
              </tr>
            </thead>
            <tbody>
              {placed.map(({ row: entry, ghost }, i) => {
                if (ghost) return <GhostTableRow key={`ghost-${i}`} ghost={ghost} columns={isPersonal ? 6 : 8} />;
                const tableRow = (r: ExpenseDTO, branch?: Branch) => (
                  <ExpenseTableRow
                    key={r.id}
                    row={r}
                    branch={branch}
                    mark={marked.has(r.id) && landing?.kind === "expenses" ? landing.verb : null}
                    checked={selected.has(r.id)}
                    isNew={fresh.has(r.id)}
                    paidBy={isPersonal ? null : payersOf(r)}
                    inv={isPersonal ? null : involvement(r, selfKey, memberCount)}
                    pending={pending}
                    onToggle={() => toggle(r.id)}
                    onEdit={() => setEditing(r)}
                    onDelete={() => {
                      setDeleteError(null);
                      setActionsFor({ expense: r, confirm: true });
                    }}
                  />
                );
                if (entry.row) return tableRow(entry.row);
                const group = entry.group;
                const open = isOpen(group.receiptId);
                return (
                  <Fragment key={`receipt-${group.receiptId}`}>
                    <ReceiptTableRow
                      group={group}
                      open={open}
                      picked={group.items.filter((r) => selected.has(r.id)).length}
                      isNew={group.items.some((r) => fresh.has(r.id))}
                      paidBy={isPersonal ? null : Array.from(new Set(group.items.flatMap(payersOf)))}
                      inv={isPersonal ? null : involvement(group.items, selfKey, memberCount)}
                      onToggleOpen={() => toggleReceipt(group.receiptId)}
                      onPick={(on) => setMany(group.items.map((r) => r.id), on)}
                    />
                    {open ? group.items.map((r, k) => tableRow(r, k === group.items.length - 1 ? "last" : "mid")) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Phones: compact rows; a long press opens edit and delete. */}
        <div className="space-y-2 md:hidden">
          <p className="text-xs text-muted">
            Press and hold an expense to edit or delete it.{placed.some((p) => p.row?.group) ? " Tap a receipt to see its items." : ""}
          </p>
          <div className="card divide-y divide-ink/5 p-0">
            {placed.map(({ row: entry, ghost }, i) => {
              if (ghost) return <GhostRow key={`ghost-${i}`} ghost={ghost} />;
              const phoneRow = (r: ExpenseDTO, branch?: Branch) => (
                <ExpenseRow
                  key={r.id}
                  id={r.id}
                  branch={branch}
                  mark={marked.has(r.id) && landing?.kind === "expenses" ? landing.verb : null}
                  item={r.item}
                  receiptMerchant={branch ? null : r.receiptMerchant}
                  flag={r.flag}
                  date={r.date}
                  amount={r.amount}
                  paidBy={isPersonal ? null : payerLabel(r)}
                  category={r.category || "Uncategorised"}
                  inv={isPersonal ? null : involvement(r, selfKey, memberCount)}
                  isNew={fresh.has(r.id)}
                  onOpenActions={() => {
                    setDeleteError(null);
                    setActionsFor({ expense: r, confirm: false });
                  }}
                />
              );
              if (entry.row) return phoneRow(entry.row);
              const group = entry.group;
              const open = isOpen(group.receiptId);
              return (
                <div key={`receipt-${group.receiptId}`}>
                  <ReceiptRow
                    group={group}
                    open={open}
                    isNew={group.items.some((r) => fresh.has(r.id))}
                    inv={isPersonal ? null : involvement(group.items, selfKey, memberCount)}
                    onToggleOpen={() => toggleReceipt(group.receiptId)}
                  />
                  {open ? <div className="pb-1">{group.items.map((r, k) => phoneRow(r, k === group.items.length - 1 ? "last" : "mid"))}</div> : null}
                </div>
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
          error={errorFor("bulk")}
          onConfirm={removePicked}
          onClose={() => {
            setConfirmBulk(false);
            setDeleteError(null);
          }}
        />
      ) : null}

      {actionsFor ? (
        <ExpenseActions
          expense={actionsFor.expense}
          startConfirming={actionsFor.confirm}
          pending={pending}
          error={errorFor(actionsFor.expense.id)}
          onEdit={() => {
            setEditing(actionsFor.expense);
            closeActions();
          }}
          onDelete={() => remove(actionsFor.expense.id)}
          onClose={closeActions}
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
  branch,
  mark,
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
  /** One item of an opened receipt, hung off it like a tree. */
  branch?: Branch;
  /** The record a notification is about: highlighted, with what happened. */
  mark: "added" | "edited" | null;
  checked: boolean;
  isNew: boolean;
  /** The payers' member keys; null in Personal. */
  paidBy: string[] | null;
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
    <tr
      data-selected={checked || undefined}
      data-expense-id={row.id}
      data-landing={mark ? "" : undefined}
      data-nested={branch ? "" : undefined}
      className={`duration-700 hover:bg-ink/[0.03] ${isNew ? "!bg-primary/15" : ""} ${mark ? "landing-mark" : ""}`}
    >
      <td>
        <RowCheckbox checked={checked} onChange={onToggle} label={`Select ${row.item}`} />
      </td>
      <td className="whitespace-nowrap text-muted">{branch ? null : tableDate(row.date)}</td>
      {/* The cell holds the branch line, so it runs the row's full height. */}
      <td className={`max-w-0 ${branch ? "relative" : ""}`}>
        {branch ? <BranchLine last={branch === "last"} left={TREE_LEFT} /> : null}
        <div className={`flex min-w-0 items-center gap-1.5 ${branch ? "pl-7" : ""}`}>
          <span className={`truncate ${branch ? "" : "font-semibold"}`} title={row.item}>
            {row.item}
          </span>
          {mark ? <MarkPill mark={mark} /> : null}
          {row.receiptMerchant && !branch ? (
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
          <PersonAvatars ids={paidBy} />
        </td>
      ) : null}
      {inv ? (
        <td>
          <StatusPill tone={inv.tone === "lent" ? "positive" : inv.tone === "borrowed" ? "negative" : "neutral"}>
            {inv.amount !== null ? `${inv.label.replace(/^you/, "You")} ${formatINR(inv.amount)}` : inv.label.replace(/^./, (c) => c.toUpperCase())}
          </StatusPill>
        </td>
      ) : null}
      <td className={`whitespace-nowrap text-right tabular-nums ${branch ? "" : "font-semibold"}`}>{formatINR(row.amount)}</td>
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

type Branch = "mid" | "last";

/**
 * The tree line on an opened receipt's item: the trunk down from the
 * receipt, curving into the item; it stops at the last one. `left` is the
 * trunk's place in px, inside a `relative` box as tall as the row.
 */
function BranchLine({ last, left }: { last: boolean; left: number }) {
  return (
    <>
      <span aria-hidden className="pointer-events-none absolute top-0 h-1/2 w-3.5 rounded-bl-lg border-b-2 border-l-2 border-ink/15" style={{ left }} />
      {last ? null : <span aria-hidden className="pointer-events-none absolute inset-y-0 border-l-2 border-ink/15" style={{ left }} />}
    </>
  );
}

/** The start of the trunk, under an opened receipt's title (`height` in px, from the row's bottom). */
function TrunkStart({ left, height }: { left: number; height: number }) {
  return <span aria-hidden className="pointer-events-none absolute bottom-0 border-l-2 border-ink/15" style={{ left, height }} />;
}

/** The words on a receipt's one row. */
function receiptSummary(group: ReceiptGroup<ExpenseDTO>) {
  return {
    merchant: group.merchant,
    total: group.total,
    category: group.category,
    count: `${group.items.length} items`,
    flagged: group.items.some((r) => r.flag),
  };
}

/** A scanned receipt as one table row (desktop): the total, opening to its items. */
function ReceiptTableRow({
  group,
  open,
  picked,
  isNew,
  paidBy,
  inv,
  onToggleOpen,
  onPick,
}: {
  group: ReceiptGroup<ExpenseDTO>;
  open: boolean;
  /** How many of its items are ticked. */
  picked: number;
  isNew: boolean;
  paidBy: string[] | null;
  inv: ReturnType<typeof involvement> | null;
  onToggleOpen: () => void;
  onPick: (on: boolean) => void;
}) {
  const items = group.items;
  const sum = receiptSummary(group);
  return (
    <tr
      data-receipt-id={items[0].receiptId}
      className={`cursor-pointer duration-700 hover:bg-ink/[0.03] ${isNew ? "!bg-primary/15" : ""}`}
      onClick={onToggleOpen}
    >
      <td onClick={(e) => e.stopPropagation()}>
        <SelectAllCheckbox selected={picked} total={items.length} onChange={onPick} label={`Select all items from ${sum.merchant}`} />
      </td>
      <td className="whitespace-nowrap text-muted">{tableDate(group.date)}</td>
      <td className="relative max-w-0">
        {open ? <TrunkStart left={TREE_LEFT} height={18} /> : null}
        <div className="flex min-w-0 items-center gap-1.5">
          <ReceiptIcon className="h-4 w-4 shrink-0 text-muted" />
          <span className="truncate font-semibold" title={sum.merchant}>
            {sum.merchant}
          </span>
          <span className="pill shrink-0 text-muted">{sum.count}</span>
          {/* Ticked items stay in the selection when it is closed: say so. */}
          {!open && picked > 0 ? <span className="pill shrink-0 border-primary/30 bg-primary/10 text-ink">{picked} selected</span> : null}
          {sum.flagged ? <AlertTriangleIcon className="h-4 w-4 shrink-0 text-warning" aria-label="An item needs attention" /> : null}
        </div>
      </td>
      <td className="truncate text-muted">{sum.category}</td>
      {paidBy !== null ? (
        <td onClick={(e) => e.stopPropagation()}>
          <PersonAvatars ids={paidBy} />
        </td>
      ) : null}
      {inv ? (
        <td>
          <StatusPill tone={inv.tone === "lent" ? "positive" : inv.tone === "borrowed" ? "negative" : "neutral"}>
            {inv.amount !== null ? `${inv.label.replace(/^you/, "You")} ${formatINR(inv.amount)}` : inv.label.replace(/^./, (c) => c.toUpperCase())}
          </StatusPill>
        </td>
      ) : null}
      <td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatINR(sum.total)}</td>
      <td>
        <div className="flex items-center justify-center">
          <button
            type="button"
            className="icon-btn"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} the ${sum.count} from ${sum.merchant}`}
            title={open ? "Hide items" : "Show items"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleOpen();
            }}
          >
            <ChevronDownIcon className={`h-5 w-5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// Where the tree's trunk runs, from the left edge of its row. Worked out
// from the sizes of what sits there, so a change to one shows up here:
// desktop, under the receipt icon (cell padding plus half the icon);
// phones, under the pill (row padding, date badge and gap, plus a little).
const CELL_PAD = 12;
const ICON = 16;
const DATE_BADGE = 36;
const ROW_GAP = 12;
const TREE_LEFT = CELL_PAD + ICON / 2 - 1;
const PHONE_TRUNK = CELL_PAD + DATE_BADGE + ROW_GAP + 10;

/** A scanned receipt as one row on phones: the total; a tap lists its items. */
function ReceiptRow({
  group,
  open,
  isNew,
  inv,
  onToggleOpen,
}: {
  group: ReceiptGroup<ExpenseDTO>;
  open: boolean;
  isNew: boolean;
  inv: ReturnType<typeof involvement> | null;
  onToggleOpen: () => void;
}) {
  const items = group.items;
  const sum = receiptSummary(group);
  return (
    <button
      type="button"
      data-receipt-id={items[0].receiptId}
      aria-expanded={open}
      aria-label={`${sum.merchant}, ${sum.count}, ${formatINR(sum.total)}. ${open ? "Hide" : "Show"} items.`}
      onClick={onToggleOpen}
      className={`relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-700 ${
        isNew ? "bg-primary/15" : ""
      } outline-none [-webkit-tap-highlight-color:transparent] focus-visible:bg-ink/5 active:bg-ink/5`}
    >
      {open ? <TrunkStart left={PHONE_TRUNK} height={8} /> : null}
      <DateBadge iso={group.date} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1 text-sm font-medium">
          <span className="truncate">{sum.merchant}</span>
          {sum.flagged ? <AlertTriangleIcon className="h-4 w-4 shrink-0 text-warning" aria-hidden /> : null}
        </div>
        {/* The total and the count; who paid and the categories are on each item. */}
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <span className="pill inline-flex shrink-0 items-center gap-1 text-muted">
            <ReceiptIcon className="h-3.5 w-3.5" />
            {sum.count}
          </span>
          <span className="shrink-0 text-sm font-semibold">{formatINR(sum.total)}</span>
        </div>
      </div>
      {inv ? (
        <div className="w-24 shrink-0 text-right">
          <div className={`truncate text-[11px] ${TONE[inv.tone]}`}>{inv.label}</div>
          <div className={`text-sm font-semibold ${TONE[inv.tone]}`}>{formatINR(inv.amount ?? 0)}</div>
        </div>
      ) : null}
      <ChevronDownIcon className={`h-5 w-5 shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

/** Confirms deleting the ticked expenses. */
function BulkDeleteDialog({
  count,
  total,
  grouped,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  count: number;
  total: number;
  grouped: boolean;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  // The latest onClose, read when Escape is pressed: the effect runs once,
  // so a re-render (a live refresh landing) does not move focus back to
  // Cancel while you are on Delete.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="sheet-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bulk-delete-title"
        className="modal-pop card w-full max-w-sm space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* After a partial failure the refused rows that are gone (deleted
            elsewhere) leave nothing ticked: only the reason and Close remain. */}
        <h2 id="bulk-delete-title" className="section-title">
          {count > 0 ? `Delete ${count} expense${count === 1 ? "" : "s"}?` : "Nothing left to delete"}
        </h2>
        {count > 0 ? (
          <p className="text-sm text-muted">
            {formatINR(total)} in total. This cannot be undone{grouped ? ", and everyone in the group is told" : ""}.
          </p>
        ) : null}
        {error ? (
          <div className="alert-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button ref={cancel} type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            {count > 0 ? "Cancel" : "Close"}
          </button>
          {count > 0 ? (
            <button type="button" className="btn-danger" onClick={onConfirm} disabled={pending}>
              {pending ? "Deleting…" : `Delete ${count}`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

/**
 * One expense row on phones (wider screens use the table): the amount paid
 * sits under the item name, your share on the right. Press and hold (or the
 * keyboard: Enter, Space, the Menu key, Shift+F10) opens the edit/delete
 * sheet.
 */
function ExpenseRow({
  id,
  branch,
  mark,
  item,
  receiptMerchant,
  flag,
  date,
  amount,
  paidBy,
  category,
  inv,
  isNew,
  onOpenActions,
}: {
  id: number;
  /** One item of an opened receipt, hung off it like a tree: one compact line, no date. */
  branch?: Branch;
  /** The record a notification is about: highlighted, with what happened. */
  mark: "added" | "edited" | null;
  item: string;
  receiptMerchant: string | null;
  /** Why the row needs attention, shown behind a warning icon; null when nothing is pending. */
  flag: string | null;
  /** ISO date, shown as the month over the day. */
  date: string;
  amount: number;
  /** The payers' names ("Golu and Peehu"); null in Personal, where there is only you. */
  paidBy: string | null;
  category: string;
  inv: ReturnType<typeof involvement> | null;
  /** Just added: highlighted for a few seconds. */
  isNew: boolean;
  onOpenActions: () => void;
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

  const press = `cursor-default touch-pan-y select-none outline-none transition [-webkit-touch-callout:none] focus-visible:bg-ink/5 active:bg-ink/5`;
  if (branch)
    return (
      <div
        {...pressable}
        data-expense-id={id}
        data-landing={mark ? "" : undefined}
        data-nested=""
        className={`relative flex items-center gap-2 py-2 pr-3 duration-700 ${isNew ? "bg-primary/15" : ""} ${mark ? "landing-mark" : ""} ${press}`}
        style={{ paddingLeft: PHONE_TRUNK + 22 }}
      >
        <BranchLine last={branch === "last"} left={PHONE_TRUNK} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1 text-sm">
            {mark ? <MarkPill mark={mark} className="mr-1" /> : null}
            <span className="truncate">{item}</span>
            {flag ? <PendingFlagButton reason={flag} open={flagOpen} onToggle={() => setFlagOpen((o) => !o)} /> : null}
          </div>
          {flag && flagOpen ? <PendingFlagNote reason={flag} /> : null}
          <div className="truncate text-xs text-muted">
            {category}
            {paidBy ? ` · ${paidBy} paid` : ""}
          </div>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{formatINR(amount)}</span>
      </div>
    );

  return (
    // 700ms is on purpose: past the 300ms UI budget, but this is the slow
    // fade-out of the "just added" highlight, not a reply to a tap. Faster
    // and the eye misses which row was new.
    <div
      {...pressable}
      data-expense-id={id}
      data-landing={mark ? "" : undefined}
      className={`flex items-center gap-3 px-3 py-2.5 transition-colors duration-700 ${
        isNew ? "bg-primary/15" : ""
      } ${mark ? "landing-mark" : ""} cursor-default touch-pan-y select-none outline-none transition [-webkit-touch-callout:none] focus-visible:bg-ink/5 active:bg-ink/5`}
    >
      <DateBadge iso={date} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {mark ? <MarkPill mark={mark} className="mr-1.5" /> : null}
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
        {/* The payer and the category each shorten on their own; the amount,
            the one figure that must stay readable, never does. */}
        <div className="mt-0.5 flex min-w-0 items-baseline gap-1 text-xs text-muted">
          {paidBy ? <span className="min-w-0 truncate">{paidBy} paid</span> : null}
          <span className="shrink-0 text-sm font-semibold text-ink">{formatINR(amount)}</span>
          <span className="shrink-0">·</span>
          <span className="min-w-0 truncate">{category}</span>
        </div>
      </div>
      {inv ? (
        <div className="w-24 shrink-0 text-right">
          <div className={`truncate text-[11px] ${TONE[inv.tone]}`}>{inv.label}</div>
          <div className={`text-sm font-semibold ${TONE[inv.tone]}`}>
            {formatINR(inv.amount ?? 0)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Bottom sheet (centred dialog on desktop) with Edit and a confirmed Delete. */
function ExpenseActions({
  expense,
  startConfirming = false,
  pending,
  error,
  onEdit,
  onDelete,
  onClose,
}: {
  expense: ExpenseDTO;
  /** Open directly on the delete confirmation (desktop trash icon). */
  startConfirming?: boolean;
  pending: boolean;
  /** Why the delete failed, if it did. */
  error: string | null;
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
            {error ? (
              <div className="alert-error" role="alert">
                {error}
              </div>
            ) : null}
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

/** "Added" or "Edited", on the row a notification was about. */
function MarkPill({ mark, className = "" }: { mark: "added" | "edited"; className?: string }) {
  return <LandingPill className={className}>{mark === "added" ? "Added" : "Edited"}</LandingPill>;
}

/** A deleted expense from a notification, crossed out where it used to be (desktop). */
function GhostTableRow({ ghost, columns }: { ghost: DeletedExpense; columns: number }) {
  return (
    <tr data-landing="" data-ghost className="landing-mark text-muted">
      <td />
      <td className="whitespace-nowrap">{tableDate(ghost.date)}</td>
      <td className="max-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate line-through" title={ghost.item}>
            {ghost.item}
          </span>
          <DeletedPill />
        </div>
      </td>
      <td className="truncate line-through">{ghost.category || "Uncategorised"}</td>
      {/* Paid by and Status (groups) have nothing to say about a deleted row. */}
      {Array.from({ length: columns - 6 }, (_, i) => (
        <td key={i} />
      ))}
      <td className="whitespace-nowrap text-right tabular-nums line-through">{formatINR(ghost.amount)}</td>
      <td />
    </tr>
  );
}

/** A deleted expense from a notification, crossed out where it used to be (phones). */
function GhostRow({ ghost }: { ghost: DeletedExpense }) {
  return (
    <div data-landing="" data-ghost className="landing-mark flex items-center gap-3 px-3 py-2.5 text-muted">
      <DateBadge iso={ghost.date} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <DeletedPill />
          <span className="truncate line-through">{ghost.item}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-1 text-xs">
          <span className="shrink-0 font-semibold line-through">{formatINR(ghost.amount)}</span>
          <span className="shrink-0">·</span>
          <span className="min-w-0 truncate line-through">{ghost.category || "Uncategorised"}</span>
        </div>
      </div>
    </div>
  );
}

function DeletedPill() {
  return <LandingPill tone="negative">Deleted</LandingPill>;
}

/** Says what the notification was about and where it is, with a way to clear it. */
function LandingBanner({ landing, month, onDismiss }: { landing: Landing; month: string; onDismiss: () => void }) {
  const where = month === ALL ? "" : ` in ${monthTab(month)}`;
  let text: string;
  if (landing.kind === "expenses") {
    const n = landing.ids.length;
    const gone = landing.missing;
    if (n === 0) {
      text =
        gone === 1
          ? "The expense from this notification is no longer in the group: it was deleted afterwards."
          : `None of the ${gone} expenses from this notification are in the group any more: they were deleted afterwards.`;
    } else {
      text = `${n === 1 ? "The expense" : `The ${n} expenses`} ${landing.verb === "edited" ? "edited" : "added"} in this notification ${n === 1 ? "is" : "are"} highlighted below${where}.`;
      if (gone > 0) text += ` ${gone} of them ${gone === 1 ? "has" : "have"} since been deleted.`;
    }
  } else if (landing.ghosts.length > 0) {
    text = `${landing.ghosts.length === 1 ? "This expense was" : `These ${landing.ghosts.length} expenses were`} deleted. ${landing.ghosts.length === 1 ? "It is" : "They are"} shown crossed out where ${landing.ghosts.length === 1 ? "it" : "they"} used to be${where}.`;
  } else {
    text = `${landing.count} expense${landing.count === 1 ? " was" : "s were"} deleted (${formatINR(landing.total)}), so there is nothing left to show.`;
  }
  return <LandingNote onDismiss={onDismiss}>{text}</LandingNote>;
}
