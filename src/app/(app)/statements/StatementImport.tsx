"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PdfPasswordError, readPdfLines } from "@/lib/statements/pdf";
import { parseStatement } from "@/lib/statements/parse";
import type { ParsedStatement, RowKind, StatementRow } from "@/lib/statements/types";
import { importStatementAction } from "@/lib/actions/statements";
import { saveStatementSummaryAction } from "@/lib/actions/cards";
import type { SaveStatementInput } from "@/lib/cards";
import { applyKeys, lineagePayload, lineageWarnings, resolveLineage, type KnownInstalment } from "@/lib/statements/lineage";
import { getAddSetupAction } from "@/lib/actions/expenses";
import { CategorySelect } from "@/components/CategorySelect";
import { ChevronDownIcon, ReceiptIcon, XIcon } from "@/components/Icons";
import { mergeCategories } from "@/lib/constants";
import { formatINR } from "@/lib/format";

interface Opt {
  value: string;
  label: string;
}

type Phase = "pick" | "reading" | "review";

const TABS: { id: RowKind; label: string }[] = [
  { id: "domestic", label: "Domestic" },
  { id: "international", label: "International" },
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
  const [tab, setTab] = useState<RowKind>("domestic");
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
      const pages = await readPdfLines(f, pw || undefined);
      const p = parseStatement(pages, { filename: f.name });
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
      const first = TABS.find((t) => p.rows.some((r) => r.kind === t.id));
      setTab(first?.id ?? "domestic");
      setPhase("review");
    } catch (e) {
      setPhase("pick");
      if (e instanceof PdfPasswordError) {
        setNeedPassword(true);
        setWrongPassword(e.wrong);
        return;
      }
      setError(e instanceof Error ? e.message : "Could not read this PDF.");
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
  const tabRows = useMemo(
    () => rows.filter((r) => r.kind === tab).sort((a, b) => a.date.localeCompare(b.date)),
    [rows, tab],
  );
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

  function setAllInTab(on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      for (const r of tabRows) {
        if (r.credit || added.has(r.id)) continue;
        if (on) n.add(r.id);
        else n.delete(r.id);
      }
      return n;
    });
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
                HDFC Bank and ICICI Bank PDF statements. The file is read on this device: it is never
                uploaded. Your name, address, card number, phone and email are dropped before anything
                is read, and only the rows you choose to add are saved.
              </p>
            </div>
          </div>

          <label className="block">
            <span className="label">Statement PDF</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="input"
              disabled={phase === "reading"}
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
          </label>

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
              {TABS.map((t) => {
                const rs = rows.filter((r) => r.kind === t.id && !r.credit);
                const total = rs.reduce((s, r) => s + r.total, 0);
                return (
                  <div key={t.id} className="rounded-lg bg-white/5 p-3">
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

          <section className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex overflow-x-auto border-b border-white/10" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
                      tab === t.id ? "border-primary font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
                    }`}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                    <span className="ml-1 text-xs text-muted">{rows.filter((r) => r.kind === t.id).length}</span>
                  </button>
                ))}
              </div>
              {tabRows.length > 0 ? (
                <div className="flex gap-3 whitespace-nowrap text-xs">
                  <button type="button" className="text-muted hover:text-ink" onClick={() => setAllInTab(true)}>
                    Select all
                  </button>
                  <button type="button" className="text-muted hover:text-ink" onClick={() => setAllInTab(false)}>
                    None
                  </button>
                </div>
              ) : null}
            </div>

            {tabRows.length === 0 ? (
              <p className="text-sm text-muted">No {TABS.find((t) => t.id === tab)?.label.toLowerCase()} rows in this statement.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-8"></th>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="text-right">Total</th>
                      <th className="w-8"></th>
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
            )}

            <div className="flex flex-col gap-3 border-t border-white/10 pt-3 sm:flex-row sm:items-end sm:justify-between">
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
        <div key={label} className="rounded-lg bg-white/5 p-3">
          <div className="truncate text-xs uppercase tracking-wide text-muted">{label}</div>
          <div className={strong ? "text-base font-semibold" : "font-medium"}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function RowView({
  row,
  open,
  checked,
  isAdded,
  category,
  categories,
  onToggleOpen,
  onToggleChecked,
  onCategory,
}: {
  row: StatementRow;
  open: boolean;
  checked: boolean;
  isAdded: boolean;
  category: string;
  categories: string[];
  onToggleOpen: () => void;
  onToggleChecked: () => void;
  onCategory: (c: string) => void;
}) {
  const disabled = row.credit || isAdded;
  return (
    <>
      <tr
        className={`cursor-pointer transition hover:bg-white/5 ${isAdded ? "opacity-60" : ""}`}
        onClick={onToggleOpen}
        aria-expanded={open}
      >
        <td onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={checked && !isAdded}
            disabled={disabled}
            onChange={onToggleChecked}
            aria-label={`Select ${row.description}`}
            title={row.credit ? "Credits are not expenses" : isAdded ? "Already added" : undefined}
          />
        </td>
        <td className="whitespace-nowrap text-muted">{dayLabel(row.date)}</td>
        <td>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{row.description}</span>
            {row.credit ? <span className="pill">credit</span> : null}
            {isAdded ? <span className="pill">added</span> : null}
            {row.installment ? <span className="pill">EMI {row.installment}</span> : null}
            {row.loan?.last4 ? <span className="pill">loan …{row.loan.last4}</span> : null}
            {row.gstFor ? (
              <span className="pill" title={row.gstFor.matchedBy === "ref" ? "Cites the instalment's own reference" : "Matched by date and amount only"}>
                {row.gstFor.matchedBy === "ref" ? "traced by reference" : "traced by amount"}
              </span>
            ) : null}
            {row.untraced ? (
              <span className="pill border-amber-400/40 text-amber-300" title="Cites a reference that is not on record">
                untraced
              </span>
            ) : null}
            {row.foreign ? (
              <span className="pill">
                {row.foreign.currency} {row.foreign.amount.toFixed(2)}
              </span>
            ) : null}
            {row.parts.length > 1 ? <span className="text-xs text-muted">{row.parts.length} parts</span> : null}
          </div>
        </td>
        <td className={`whitespace-nowrap text-right font-semibold ${row.credit ? "text-emerald-400" : ""}`}>
          {row.credit ? "+" : ""}
          {formatINR(row.total)}
        </td>
        <td>
          <ChevronDownIcon className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </td>
      </tr>
      {open ? (
        <tr className="bg-white/[0.03]">
          <td colSpan={5} className="!py-3">
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
                    <tr className="border-t border-white/10 font-semibold">
                      <td className="pt-1 pr-3">Total</td>
                      <td className="pt-1 text-right">{formatINR(row.total)}</td>
                    </tr>
                  </tbody>
                </table>
                {row.foreign ? (
                  <div className="mt-2 space-y-0.5 text-xs text-muted">
                    <div>
                      {row.foreign.currency} {row.foreign.amount.toFixed(2)} at ₹{row.foreign.rate.toFixed(2)} per{" "}
                      {row.foreign.currency}
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
                  <div className="mt-2 text-xs text-amber-300">
                    Cites a reference that is not on record. Upload the statement that billed the charge it taxes.
                  </div>
                ) : null}
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Category</div>
                {isAdded ? (
                  <div className="text-sm">{category}</div>
                ) : (
                  <CategorySelect categories={categories} value={category} onChange={onCategory} />
                )}
                <div className="mt-2 text-xs text-muted">Date: {row.date}</div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
