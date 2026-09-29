"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PdfPasswordError, readPdfPages } from "@/lib/statements/pdf";
import { parseStatement } from "@/lib/statements/parse";
import { parseCsv, parseSheet } from "@/lib/statements/sheet";
import { readXlsx } from "@/lib/statements/xlsx";
import type { ParsedStatement, RowKind, StatementRow } from "@/lib/statements/types";
import { importStatementAction } from "@/lib/actions/statements";
import { saveStatementSummaryAction } from "@/lib/actions/cards";
import type { SaveStatementInput } from "@/lib/cards";
import { applyKeys, lineagePayload, lineageWarnings, resolveLineage, type KnownInstalment } from "@/lib/statements/lineage";
import { getAddSetupAction } from "@/lib/actions/expenses";
import { CategorySelect } from "@/components/CategorySelect";
import { Tabs } from "@/components/Tabs";
import { FileDropzone } from "@/components/FileDropzone";
import { EyeIcon, LabelIcon, ReceiptIcon, XIcon } from "@/components/Icons";
import { RowCheckbox, SearchBox, SelectAllCheckbox, SortHeader, StatusPill, Th, sortRows, tableDate, useSort } from "@/components/table/Table";
import { mergeCategories } from "@/lib/constants";
import { formatINR } from "@/lib/format";

interface Opt {
  value: string;
  label: string;
}

type Phase = "pick" | "reading" | "review";

type TabId = "all" | RowKind;
type SortKey = "date" | "description" | "amount";

const TABS: { id: TabId; label: string; shortLabel?: string }[] = [
  { id: "all", label: "All" },
  { id: "domestic", label: "Domestic" },
  { id: "international", label: "International", shortLabel: "Intl." },
  { id: "emi", label: "EMI" },
];

const BANK_LABEL: Record<ParsedStatement["bank"], string> = {
  hdfc: "HDFC Bank",
  icici: "ICICI Bank",
  unknown: "Card statement",
};

function monthLabel(period: string | null): string {
  if (!period) return "";
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** How to read a file: by extension first, then by type. */
function fileKind(f: File): "pdf" | "xlsx" | "csv" | "xls" {
  const name = f.name.toLowerCase();
  if (name.endsWith(".xlsx") || f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (name.endsWith(".csv") || f.type === "text/csv") return "csv";
  if (name.endsWith(".xls") || f.type === "application/vnd.ms-excel") return "xls";
  return "pdf";
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function StatementImport({
  contexts,
  loanSalt,
  known,
}: {
  contexts: Opt[];
  /** Per-user salt for keying loan numbers and references in the browser. */
  loanSalt: string;
  /** EMI instalments on record, to trace GST charges billed later. */
  known: KnownInstalment[];
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [sort, onSort] = useSort<SortKey>({ key: "date", dir: "asc" }, ["amount"]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [ctx, setCtx] = useState(contexts[0]?.value ?? "personal");
  const [ctxCategories, setCtxCategories] = useState<string[]>([]);
  const [importing, startImport] = useTransition();
  const [result, setResult] = useState<{ count: number; ctx: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [summarySaved, setSummarySaved] = useState(false);
  const [savingSummary, startSaveSummary] = useTransition();

  // Categories already used in the chosen destination, so the picker offers them.
  useEffect(() => {
    let live = true;
    getAddSetupAction(ctx)
      .then((res) => {
        if (live && res.ok) setCtxCategories(res.setup.categories);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ctx]);

  async function run(f: File, pw?: string) {
    setError(null);
    setPhase("reading");
    try {
      // Every format is read on this device; nothing is uploaded.
      const kind = fileKind(f);
      if (kind === "xls") throw new Error("Old .xls files are not supported. Open the file and save it as .xlsx or CSV.");
      const p =
        kind === "xlsx"
          ? parseSheet(await readXlsx(await f.arrayBuffer()), { filename: f.name })
          : kind === "csv"
            ? parseSheet([parseCsv(await f.text())], { filename: f.name })
            : parseStatement(await readPdfPages(f, pw || undefined), { filename: f.name });
      // Loan numbers and references become keyed hashes here; the digits
      // are forgotten before anything is shown or sent.
      await applyKeys(p, loanSalt);
      p.warnings.push(...lineageWarnings(resolveLineage(p.rows, known)));
      setSummarySaved(false);
      setParsed(p);
      setSelected(new Set(p.rows.filter((r) => !r.credit).map((r) => r.id)));
      setAdded(new Set());
      setCategories(Object.fromEntries(p.rows.map((r) => [r.id, r.category])));
      setExpanded(null);
      setResult(null);
      setNeedPassword(false);
      setWrongPassword(false);
      setTab("all");
      setQuery("");
      setPhase("review");
    } catch (e) {
      setPhase("pick");
      if (e instanceof PdfPasswordError) {
        setNeedPassword(true);
        setWrongPassword(e.wrong);
        return;
      }
      setError(e instanceof Error ? e.message : "Could not read this file.");
    }
  }

  function pick(f: File | null) {
    setFile(f);
    setPassword("");
    setNeedPassword(false);
    setWrongPassword(false);
    setParsed(null);
    if (f) void run(f);
  }

  function reset() {
    setFile(null);
    setParsed(null);
    setPhase("pick");
    setPassword("");
    setNeedPassword(false);
    setWrongPassword(false);
    setError(null);
    setResult(null);
  }

  const rows = parsed?.rows ?? [];
  // The rows on show: this tab, matching the search (description or
  // category), in the chosen order.
  const tabRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = rows.filter(
      (r) =>
        (tab === "all" || r.kind === tab) &&
        (!q || r.description.toLowerCase().includes(q) || (categories[r.id] ?? r.category).toLowerCase().includes(q)),
    );
    return sortRows(shown, sort, (r, k) => (k === "date" ? r.date : k === "amount" ? (r.credit ? -r.total : r.total) : r.description));
  }, [rows, tab, query, sort, categories]);
  const selectable = tabRows.filter((r) => !r.credit && !added.has(r.id));
  const selectedShown = selectable.filter((r) => selected.has(r.id)).length;
  const selectedRows = rows.filter((r) => selected.has(r.id) && !added.has(r.id));
  const selectedTotal = selectedRows.reduce((s, r) => s + r.total, 0);
  const allCategories = useMemo(
    () => mergeCategories([...ctxCategories, ...Object.values(categories)]),
    [ctxCategories, categories],
  );
  const ctxLabel = contexts.find((c) => c.value === ctx)?.label ?? "Personal";
  const summaryInput: SaveStatementInput | null =
    parsed?.summary && parsed.card && parsed.period
      ? {
          bank: parsed.bank,
          last4: parsed.card.last4,
          product: parsed.card.product,
          period: parsed.period,
          summary: parsed.summary,
          totals: {
            domestic: rows.filter((r) => r.kind === "domestic" && !r.credit).reduce((s, r) => s + r.total, 0),
            international: rows.filter((r) => r.kind === "international" && !r.credit).reduce((s, r) => s + r.total, 0),
            emi: rows.filter((r) => r.kind === "emi" && !r.credit).reduce((s, r) => s + r.total, 0),
          },
        }
      : null;

  const lineage = parsed ? lineagePayload(parsed.rows, parsed.period) : null;

  function saveSummary() {
    if (!summaryInput) return;
    setError(null);
    startSaveSummary(async () => {
      const res = await saveStatementSummaryAction(summaryInput, lineage ?? undefined);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSummarySaved(true);
      router.refresh();
    });
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function setAllShown(on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      for (const r of selectable) {
        if (on) n.add(r.id);
        else n.delete(r.id);
      }
      return n;
    });
  }

  /** Bulk action: one category for every selected row. */
  function categoriseSelected(c: string) {
    if (!c) return;
    setCategories((m) => ({ ...m, ...Object.fromEntries(selectedRows.map((r) => [r.id, c])) }));
  }

  function doImport() {
    if (selectedRows.length === 0) return;
    setError(null);
    startImport(async () => {
      const res = await importStatementAction({
        ctx,
        summary: summaryInput && !summarySaved ? summaryInput : undefined,
        lineage: lineage ?? undefined,
        rows: selectedRows.map((r) => ({
          date: r.date,
          item: r.description,
          amount: r.total,
          category: categories[r.id] ?? r.category,
          untracedRefKey: r.untraced && r.taxRefKey ? r.taxRefKey : null,
        })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAdded((a) => new Set([...a, ...selectedRows.map((r) => r.id)]));
      setSelected(new Set());
      setResult({ count: res.count, ctx });
      if (res.summarySaved) setSummarySaved(true);
      router.refresh();
    });
  }

  async function copyDebug() {
    if (!parsed) return;
    const text = [
      `bank: ${parsed.bank}`,
      `statement date: ${parsed.statementDate ?? "?"}`,
      ...parsed.warnings.map((w) => `warning: ${w}`),
      "",
      ...parsed.redactedLines,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the text below and copy it by hand.");
    }
  }

  return (
    <div className="space-y-4">
      {phase !== "review" ? (
        <section className="card space-y-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-primary">
              <ReceiptIcon />
            </span>
            <div className="space-y-1">
              <h2 className="section-title">Import a credit card statement</h2>
              <p className="text-sm text-muted">
                HDFC Bank and ICICI Bank statements as PDF, Excel (.xlsx) or CSV. The file is read on this device: it is never
                uploaded. Your name, address, card number, phone and email are dropped before anything
                is read, and only the rows you choose to add are saved.
              </p>
            </div>
          </div>

          <FileDropzone
            label="Statement file"
            accept=".pdf,application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
            disabled={phase === "reading"}
            onFiles={(fs) => pick(fs[0] ?? null)}
            onReject={(fs) => setError(`${fs[0].name} is not a PDF, Excel (.xlsx) or CSV file.`)}
            hint="Supported formats: PDF, Excel (.xlsx), CSV. Read on this device, never uploaded."
          >
            {file ? (
              <span className="max-w-full truncate rounded-full bg-ink/[0.06] px-3 py-1 text-xs text-ink">
                {phase === "reading" ? "Reading " : ""}
                {file.name}
              </span>
            ) : null}
          </FileDropzone>

          {needPassword && file ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(file, password);
              }}
            >
              <label className="block">
                <span className="label">PDF password</span>
                <input
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  autoComplete="off"
                />
              </label>
              {wrongPassword ? <div className="alert-error">That password did not open the file.</div> : null}
              <p className="text-xs text-muted">
                Bank statements are usually locked. The password is often the first four letters of your
                name in capitals followed by your date of birth as DDMM. It stays on this device.
              </p>
              <button type="submit" className="btn-primary" disabled={!password || phase === "reading"}>
                Unlock and read
              </button>
            </form>
          ) : null}

          {phase === "reading" ? <div className="alert-info">Reading the statement…</div> : null}
          {error ? <div className="alert-error">{error}</div> : null}
        </section>
      ) : null}

      {phase === "review" && parsed ? (
        <>
          <section className="card space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="section-title">
                  {BANK_LABEL[parsed.bank]}
                  {parsed.period ? <span className="font-normal text-muted"> · {monthLabel(parsed.period)}</span> : null}
                </h2>
                <p className="truncate text-sm text-muted">{file?.name}</p>
              </div>
              <button type="button" className="icon-btn" aria-label="Close statement" title="Close" onClick={reset}>
                <XIcon />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              {TABS.filter((t) => t.id !== "all").map((t) => {
                const rs = rows.filter((r) => r.kind === t.id && !r.credit);
                const total = rs.reduce((s, r) => s + r.total, 0);
                return (
                  <div key={t.id} className="rounded-lg bg-ink/5 p-3">
                    <div className="truncate text-xs uppercase tracking-wide text-muted">{t.label}</div>
                    <div className="font-semibold">{formatINR(total)}</div>
                    <div className="text-xs text-muted">
                      {rs.length} row{rs.length === 1 ? "" : "s"}
                    </div>
                  </div>
                );
              })}
            </div>
            {parsed.warnings.map((w) => (
              <div key={w} className="alert-warning">
                {w}
              </div>
            ))}
            {result ? (
              <div className="alert-success">
                Added {result.count} expense{result.count === 1 ? "" : "s"} to{" "}
                <Link href={result.ctx === "personal" ? "/g/personal" : `/g/${encodeURIComponent(result.ctx)}`} className="font-semibold underline">
                  {contexts.find((c) => c.value === result.ctx)?.label ?? "Personal"}
                </Link>
                .
              </div>
            ) : null}
            {error ? <div className="alert-error">{error}</div> : null}
          </section>

          {parsed.summary ? (
            <section className="card space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="section-title">Statement summary</h2>
                  <p className="text-sm text-muted">
                    {parsed.card
                      ? `${BANK_LABEL[parsed.bank]} •••• ${parsed.card.last4}${parsed.card.product ? ` · ${parsed.card.product}` : ""}`
                      : "Card number not found in this statement, so the summary cannot be filed."}
                  </p>
                </div>
                {summaryInput ? (
                  summarySaved ? (
                    <span className="pill">Saved to your cards</span>
                  ) : (
                    <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={savingSummary} onClick={saveSummary}>
                      {savingSummary ? "Saving…" : "Save to my cards"}
                    </button>
                  )
                ) : null}
              </div>
              <SummaryGrid summary={parsed.summary} />
            </section>
          ) : null}

          <section className="card space-y-4">
            {/* The border runs the full width of the card; the tab underline sits on it. */}
            <div className="border-b border-ink/10">
              <Tabs
                label="Statement rows"
                tabs={TABS.map((t) => ({ ...t, count: t.id === "all" ? rows.length : rows.filter((r) => r.kind === t.id).length }))}
                value={tab}
                onChange={(t) => {
                  setTab(t);
                  setExpanded(null);
                }}
              />
            </div>

            {/* Toolbar: what is selected, bulk actions on it, and search. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm text-muted" aria-live="polite">
                {selectedRows.length > 0 ? (
                  <>
                    <span className="font-semibold text-ink">{selectedRows.length} selected</span> · {formatINR(selectedTotal)}
                  </>
                ) : (
                  "Tick the rows to add"
                )}
              </span>
              <label className={`chip-btn relative ${selectedRows.length === 0 ? "pointer-events-none opacity-45" : "cursor-pointer"}`}>
                <LabelIcon className="h-4 w-4 text-muted" />
                Set category
                {/* The native select sits over the chip: a real menu on every device. */}
                <select
                  aria-label="Set category for the selected rows"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value=""
                  disabled={selectedRows.length === 0}
                  onChange={(e) => categoriseSelected(e.target.value)}
                >
                  <option value="">Set category</option>
                  {allCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="chip-btn" disabled={selectedRows.length === 0} onClick={() => setSelected(new Set())}>
                <XIcon className="h-4 w-4 text-muted" />
                Clear
              </button>
              <SearchBox value={query} onChange={setQuery} placeholder="Search rows" className="w-full sm:ml-auto sm:w-64" />
            </div>

            {tab === "emi" && parsed.loans.length > 0 ? (
              <div className="rounded-lg border border-ink/10 p-3 text-sm" data-loans>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Loans on this card, as the statement lists them</div>
                <ul className="space-y-1">
                  {parsed.loans.map((l, i) => (
                    <li key={i}>
                      <span className="font-medium">
                        {l.type ?? "Loan"} …{l.last4 ?? "?"}
                      </span>
                      {l.amount !== null ? <>: {formatINR(l.amount)}</> : null}
                      {l.bookedOn ? <> booked {l.bookedOn}</> : null}
                      {l.tenureMonths !== null ? <> for {l.tenureMonths} months</> : null}
                      {l.ratePct !== null ? <> at {l.ratePct}%</> : null}.
                      {l.remainingMonths !== null ? <> {l.remainingMonths} months left</> : null}
                      {l.principalOutstanding !== null ? <>, {formatINR(l.principalOutstanding)} principal</> : null}
                      {l.interestPayable !== null ? <> and {formatINR(l.interestPayable)} interest outstanding</> : null}.
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted">Shown for reference. Only the instalments you add are saved.</p>
              </div>
            ) : null}

            {tabRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                {query.trim()
                  ? `No rows match "${query.trim()}".`
                  : `No ${tab === "all" ? "" : `${TABS.find((t) => t.id === tab)?.label.toLowerCase()} `}rows in this statement.`}
              </p>
            ) : (
              <>
                {/* Desktop: the table. */}
                <div className="hidden overflow-hidden rounded-xl border border-ink/10 md:block">
                  <table className="list-table">
                    <thead>
                      <tr>
                        <th scope="col" className="w-12 px-3 py-3">
                          <SelectAllCheckbox selected={selectedShown} total={selectable.length} onChange={setAllShown} label="Select all rows shown" />
                        </th>
                        <SortHeader label="Date" sortKey="date" sort={sort} onSort={onSort} className="w-32" />
                        <SortHeader label="Description" sortKey="description" sort={sort} onSort={onSort} />
                        <Th className="w-40">Category</Th>
                        <Th className="w-28">Status</Th>
                        <SortHeader label="Amount" sortKey="amount" sort={sort} onSort={onSort} align="right" className="w-32" />
                        <Th align="center" className="w-20">
                          Details
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {tabRows.map((r) => (
                        <RowView
                          key={r.id}
                          row={r}
                          open={expanded === r.id}
                          checked={selected.has(r.id)}
                          isAdded={added.has(r.id)}
                          category={categories[r.id] ?? r.category}
                          categories={allCategories}
                          onToggleOpen={() => setExpanded((x) => (x === r.id ? null : r.id))}
                          onToggleChecked={() => toggle(r.id)}
                          onCategory={(c) => setCategories((m) => ({ ...m, [r.id]: c }))}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Phones: the same rows, stacked. */}
                <div className="md:hidden">
                  <label className="mb-2 flex items-center gap-3 px-1 text-sm text-muted">
                    <SelectAllCheckbox selected={selectedShown} total={selectable.length} onChange={setAllShown} label="Select all rows shown" />
                    Select all ({selectable.length})
                  </label>
                  <ul className="divide-y divide-ink/[0.06] overflow-hidden rounded-xl border border-ink/10">
                    {tabRows.map((r) => (
                      <PhoneRow
                        key={r.id}
                        row={r}
                        open={expanded === r.id}
                        checked={selected.has(r.id)}
                        isAdded={added.has(r.id)}
                        category={categories[r.id] ?? r.category}
                        categories={allCategories}
                        onToggleOpen={() => setExpanded((x) => (x === r.id ? null : r.id))}
                        onToggleChecked={() => toggle(r.id)}
                        onCategory={(c) => setCategories((m) => ({ ...m, [r.id]: c }))}
                      />
                    ))}
                  </ul>
                </div>
              </>
            )}

            <div className="flex flex-col gap-3 border-t border-ink/10 pt-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="block sm:w-64">
                <span className="label">Add to</span>
                <select className="select" value={ctx} onChange={(e) => setCtx(e.target.value)}>
                  {contexts.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-primary"
                disabled={selectedRows.length === 0 || importing}
                onClick={doImport}
              >
                {importing
                  ? "Adding…"
                  : `Add ${selectedRows.length} selected to ${ctxLabel} · ${formatINR(selectedTotal)}`}
              </button>
            </div>
          </section>

          <details className="card">
            <summary className="cursor-pointer select-none text-sm font-semibold text-muted">
              Something look wrong? Anonymised statement text
            </summary>
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-muted">
                These are the only lines the parser saw, after card numbers, references and contact
                details were removed. Share them to get the parser fixed for your statement layout.
              </p>
              <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={copyDebug}>
                {copied ? "Copied" : "Copy anonymised text"}
              </button>
              {parsed.unparsed.length > 0 ? (
                <div className="alert-warning">
                  Not read: {parsed.unparsed.map((u) => u.text).join(" | ")}
                </div>
              ) : null}
              <pre className="max-h-64 overflow-auto rounded-lg bg-black/30 p-3 text-xs">
                {parsed.redactedLines.join("\n")}
              </pre>
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}

function SummaryGrid({ summary }: { summary: NonNullable<ParsedStatement["summary"]> }) {
  const money = (n: number | null) => (n === null ? "not printed" : formatINR(n));
  const date = (iso: string | null) => {
    if (!iso) return "not printed";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  };
  const cells: [string, string, boolean?][] = [
    ["Total amount due", money(summary.totalDue), true],
    ["Minimum due", money(summary.minimumDue)],
    ["Due date", date(summary.dueDate)],
    ["Previous dues", money(summary.previousDues)],
    ["Payments and credits", money(summary.paymentsCredits)],
    ["Purchases and debits", money(summary.purchases)],
    ["Finance charges", money(summary.financeCharges)],
    ["Credit limit", money(summary.creditLimit)],
    ["Available credit", money(summary.availableCredit)],
    ["Available cash", money(summary.availableCash)],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
      {cells.map(([label, value, strong]) => (
        <div key={label} className="rounded-lg bg-ink/5 p-3">
          <div className="truncate text-xs uppercase tracking-wide text-muted">{label}</div>
          <div className={strong ? "text-base font-semibold" : "font-medium"}>{value}</div>
        </div>
      ))}
    </div>
  );
}

interface RowProps {
  row: StatementRow;
  open: boolean;
  checked: boolean;
  isAdded: boolean;
  category: string;
  categories: string[];
  onToggleOpen: () => void;
  onToggleChecked: () => void;
  onCategory: (c: string) => void;
}

/** A row's state as a pill: added, a credit, untraced GST, or new. */
function statusOf(row: StatementRow, isAdded: boolean) {
  if (isAdded) return <StatusPill tone="positive">Added</StatusPill>;
  if (row.credit) return <StatusPill tone="info" title="Credits are not expenses">Credit</StatusPill>;
  if (row.untraced)
    return (
      <StatusPill tone="warning" title="Cites a reference that is not on record. Can be added now; it is traced once that statement is uploaded.">
        Untraced
      </StatusPill>
    );
  return <StatusPill tone="neutral">New</StatusPill>;
}

/** The small facts under a description: instalment, loan, tracing, currency. */
function RowTags({ row }: { row: StatementRow }) {
  const tags: string[] = [];
  if (row.installment) tags.push(`EMI ${row.installment}`);
  if (row.loan?.last4) tags.push(`loan …${row.loan.last4}`);
  if (row.gstFor) tags.push(row.gstFor.matchedBy === "ref" ? "traced by reference" : "traced by amount");
  if (row.foreign) tags.push(`${row.foreign.currency} ${row.foreign.amount.toFixed(2)}`);
  if (row.parts.length > 1) tags.push(`${row.parts.length} parts`);
  if (tags.length === 0) return null;
  return <div className="mt-0.5 truncate text-xs text-muted">{tags.join(" · ")}</div>;
}

function Amount({ row }: { row: StatementRow }) {
  return (
    <span className={`whitespace-nowrap font-semibold tabular-nums ${row.credit ? "text-positive" : ""}`}>
      {row.credit ? "+" : ""}
      {formatINR(row.total)}
    </span>
  );
}

function RowView({ row, open, checked, isAdded, category, categories, onToggleOpen, onToggleChecked, onCategory }: RowProps) {
  const disabled = row.credit || isAdded;
  return (
    <>
      <tr
        data-selected={(checked && !isAdded) || undefined}
        className={`cursor-pointer hover:bg-ink/[0.03] ${isAdded ? "opacity-60" : ""}`}
        onClick={onToggleOpen}
        aria-expanded={open}
      >
        <td onClick={(e) => e.stopPropagation()}>
          <RowCheckbox
            checked={checked && !isAdded}
            disabled={disabled}
            onChange={onToggleChecked}
            label={`Select ${row.description}`}
            title={row.credit ? "Credits are not expenses" : isAdded ? "Already added" : undefined}
          />
        </td>
        <td className="whitespace-nowrap text-muted">{tableDate(row.date)}</td>
        <td className="max-w-0">
          <div className="truncate font-semibold" title={row.description}>
            {row.description}
          </div>
          <RowTags row={row} />
        </td>
        <td className="truncate text-muted">{category}</td>
        <td>{statusOf(row, isAdded)}</td>
        <td className="text-right">
          <Amount row={row} />
        </td>
        <td className="text-center" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`icon-btn mx-auto ${open ? "bg-primary/10 text-primary-light" : "text-primary-light"}`}
            onClick={onToggleOpen}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} details for ${row.description}`}
            title={open ? "Hide details" : "Details"}
          >
            <EyeIcon />
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="bg-ink/[0.03]">
          <td colSpan={7} className="!py-4">
            <RowDetails row={row} isAdded={isAdded} category={category} categories={categories} onCategory={onCategory} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function PhoneRow({ row, open, checked, isAdded, category, categories, onToggleOpen, onToggleChecked, onCategory }: RowProps) {
  const disabled = row.credit || isAdded;
  return (
    <li data-selected={(checked && !isAdded) || undefined} className={`data-[selected]:bg-primary/[0.06] ${isAdded ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3 p-3">
        <div className="pt-0.5">
          <RowCheckbox
            checked={checked && !isAdded}
            disabled={disabled}
            onChange={onToggleChecked}
            label={`Select ${row.description}`}
            title={row.credit ? "Credits are not expenses" : isAdded ? "Already added" : undefined}
          />
        </div>
        <button type="button" onClick={onToggleOpen} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{row.description}</span>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {tableDate(row.date)} · {category}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1 text-sm">
            <Amount row={row} />
            {statusOf(row, isAdded)}
          </span>
        </button>
      </div>
      {open ? (
        <div className="border-t border-ink/[0.06] bg-ink/[0.03] p-3">
          <RowDetails row={row} isAdded={isAdded} category={category} categories={categories} onCategory={onCategory} />
        </div>
      ) : null}
    </li>
  );
}

/** A row opened up: its breakdown, loan or GST notes, and its category. */
function RowDetails({
  row,
  isAdded,
  category,
  categories,
  onCategory,
}: {
  row: StatementRow;
  isAdded: boolean;
  category: string;
  categories: string[];
  onCategory: (c: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Breakdown</div>
        <table className="w-full text-sm">
          <tbody>
            {row.parts.map((p, i) => (
              <tr key={i}>
                <td className="py-0.5 pr-3 text-muted">{p.label}</td>
                <td className="py-0.5 text-right">{formatINR(p.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-ink/10 font-semibold">
              <td className="pt-1 pr-3">Total</td>
              <td className="pt-1 text-right">{formatINR(row.total)}</td>
            </tr>
          </tbody>
        </table>
        {row.foreign ? (
          <div className="mt-2 space-y-0.5 text-xs text-muted">
            <div>
              {row.foreign.currency} {row.foreign.amount.toFixed(2)} at ₹{row.foreign.rate.toFixed(2)} per {row.foreign.currency}
            </div>
            <div>
              Effective rate with markup and GST: ₹{row.foreign.effectiveRate.toFixed(2)} per {row.foreign.currency}
            </div>
          </div>
        ) : null}
        {row.kind === "emi" ? (
          <div className="mt-2 text-xs text-muted">
            Loan …{row.loan?.last4 ?? "?"}
            {row.loan?.instalmentNo ? ` · instalment #${row.loan.instalmentNo}` : ""}
            {row.parts.some((p) => p.kind === "gst")
              ? ""
              : ". GST on this interest is billed in a later statement and will be traced back here by its reference."}
          </div>
        ) : null}
        {row.gstFor ? (
          <div className="mt-2 text-xs text-muted">
            Belongs to instalment #{row.gstFor.instalmentNo ?? "?"} of loan …{row.gstFor.loanLast4 ?? "?"}, billed on {row.gstFor.date}
            {row.gstFor.matchedBy === "ref" ? ", matched by its reference." : ", matched by date and amount."}
          </div>
        ) : null}
        {row.untraced ? (
          <div className="mt-2 text-xs text-warning">
            Cites a reference that is not on record. Upload the statement that billed the charge it taxes. You can add this row now: the
            expense carries a warning until that statement is uploaded, and is then traced to its instalment by the reference and renamed.
          </div>
        ) : null}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Category</div>
        {isAdded ? <div className="text-sm">{category}</div> : <CategorySelect categories={categories} value={category} onChange={onCategory} />}
        <div className="mt-2 text-xs text-muted">Date: {row.date}</div>
      </div>
    </div>
  );
}
