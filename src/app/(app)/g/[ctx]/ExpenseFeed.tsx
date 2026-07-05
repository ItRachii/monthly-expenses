"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseDTO } from "@/lib/expenses";
import { SPLIT_EQUAL } from "@/lib/constants";
import { SETTLE_EPS, round2 } from "@/lib/settlementMath";
import { formatINR } from "@/lib/format";
import { deleteExpenseAction } from "@/lib/actions/expenses";
import { EditExpenseModal } from "../../log/ExpenseLog";

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
      : { label: "you paid", amount: r.amount, tone: "muted" };
  }
  const borrowed = round2(share);
  return borrowed > SETTLE_EPS
    ? { label: "you borrowed", amount: borrowed, tone: "borrowed" }
    : { label: "not involved", amount: null, tone: "muted" };
}

// Splitwise-style expense feed: rows grouped by month, each month section
// collapsible (latest month open by default), with edit/delete and CSV export.
export function ExpenseFeed({
  rows,
  nameMap,
  categories,
  payerOptions,
  splitOptions,
  isPersonal,
  selfKey,
  memberCount,
}: {
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
  const splitLabel = (v: string) => (v === SPLIT_EQUAL ? "Equal Split" : nameMap[v] ?? v);

  function exportCsv() {
    const header = ["Date", "Category", "Item", "Amount", "Payer", "Split"];
    const lines = rows.map((r) =>
      [r.date, r.category, r.item, r.amount.toFixed(2), payerLabel(r.payer), splitLabel(r.split)]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "expenses_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function remove(id: number) {
    if (!confirm("Delete this expense?")) return;
    startTransition(async () => {
      await deleteExpenseAction(id);
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
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="w-9 shrink-0 text-center leading-tight">
                      <div className="text-[10px] uppercase text-muted">
                        {MONTH_SHORT[(m ?? 1) - 1]}
                      </div>
                      <div className="text-base font-semibold">
                        {String(d).padStart(2, "0")}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {r.item}
                        {r.receiptMerchant ? (
                          <span
                            className="ml-1 rounded bg-white/5 px-1 py-0.5 text-[10px] text-muted"
                            title={`From scanned receipt: ${r.receiptMerchant}`}
                          >
                            🧾
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {isPersonal
                          ? r.category
                          : `${payerLabel(r.payer)} paid ${formatINR(r.amount)} · ${r.category}`}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {isPersonal ? (
                        <div className="text-sm font-semibold">{formatINR(r.amount)}</div>
                      ) : inv ? (
                        <>
                          <div
                            className={`text-[10px] ${
                              inv.tone === "lent"
                                ? "text-emerald-400"
                                : inv.tone === "borrowed"
                                ? "text-orange-400"
                                : "text-muted"
                            }`}
                          >
                            {inv.label}
                          </div>
                          {inv.amount != null ? (
                            <div
                              className={`text-sm font-semibold ${
                                inv.tone === "lent"
                                  ? "text-emerald-400"
                                  : inv.tone === "borrowed"
                                  ? "text-orange-400"
                                  : ""
                              }`}
                            >
                              {formatINR(inv.amount)}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        className="text-muted hover:text-ink disabled:opacity-50"
                        onClick={() => setEditing(r)}
                        disabled={pending}
                        aria-label="Edit expense"
                        title="Edit"
                      >
                        ✏️
                      </button>
                      <button
                        className="text-red-400 hover:text-red-300 disabled:opacity-50"
                        onClick={() => remove(r.id)}
                        disabled={pending}
                        aria-label="Delete expense"
                        title="Delete"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      ))}

      <button className="btn-secondary" onClick={exportCsv}>
        Export to CSV
      </button>

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
