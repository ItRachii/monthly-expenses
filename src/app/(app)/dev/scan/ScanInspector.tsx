"use client";

import { useCallback, useEffect, useState } from "react";
import { FileDropzone } from "@/components/FileDropzone";
import { prepareImage } from "@/lib/scanner/prepareImage";
import { parseReceipt } from "@/lib/receipt/parse";
import type { ScanItem, ScanResult } from "@/lib/scanner/lines";
import type { ParsedReceipt } from "@/lib/receipt/types";
import { formatINR } from "@/lib/format";

interface Health {
  available: boolean;
  ms: number;
}

interface Run {
  imageUrl: string;
  sentBytes: number;
  originalBytes: number;
  roundTripMs: number;
  text: string;
  result: ScanResult & { ms?: number };
  parsed: ParsedReceipt;
}

/** The boxes the scanner returned, drawn over the image that was sent. */
function Overlay({ run, showCells, showBlocks }: { run: Run; showCells: boolean; showBlocks: boolean }) {
  const page = run.result.pages[0];
  if (!page) return null;
  const rect = (it: ScanItem, i: number, cls: string) => {
    const [l, t, r, b] = it.box;
    return <rect key={i} x={l} y={t} width={r - l} height={b - t} className={cls} fill="none" vectorEffect="non-scaling-stroke" />;
  };
  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={run.imageUrl} alt="image sent to the scanner" className="block w-full rounded-md" />
      <svg viewBox={`0 0 ${page.width} ${page.height}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        {showBlocks ? run.result.items.filter((it) => it.page === page.page).map((it, i) => rect(it, i, "stroke-ink/50 [stroke-dasharray:6_4] [stroke-width:1.5]")) : null}
        {showCells ? (run.result.cells ?? []).filter((it) => it.page === page.page).map((it, i) => rect(it, i, "stroke-primary [stroke-width:2]")) : null}
      </svg>
    </div>
  );
}

export function ScanInspector() {
  const [health, setHealth] = useState<Health | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [showCells, setShowCells] = useState(true);
  const [showBlocks, setShowBlocks] = useState(false);

  const check = useCallback(async () => {
    setHealth(null);
    const t0 = performance.now();
    try {
      const res = await fetch("/api/scan", { cache: "no-store" });
      const body = res.ok ? ((await res.json()) as { available?: boolean }) : null;
      setHealth({ available: !!body?.available, ms: Math.round(performance.now() - t0) });
    } catch {
      setHealth({ available: false, ms: Math.round(performance.now() - t0) });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // Revoke the previous preview when a new run replaces it.
  useEffect(() => () => {
    if (run) URL.revokeObjectURL(run.imageUrl);
  }, [run]);

  async function scan() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const image = await prepareImage(file);
      const t0 = performance.now();
      const res = await fetch("/api/scan?debug=1", {
        method: "POST",
        headers: { "Content-Type": image.type || "application/octet-stream" },
        body: image,
      });
      const roundTripMs = Math.round(performance.now() - t0);
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string; debug?: Run["result"] };
      if (!res.ok || typeof body.text !== "string" || !body.debug) {
        setError(`Scan failed: HTTP ${res.status}${body.error ? `, ${body.error}` : ""}${res.ok && !body.debug ? ", no debug data (is this address in DEVELOPER_EMAILS?)" : ""}`);
        return;
      }
      setRun({
        imageUrl: URL.createObjectURL(image),
        sentBytes: image.size,
        originalBytes: file.size,
        roundTripMs,
        text: body.text,
        result: body.debug,
        parsed: parseReceipt(body.text),
      });
    } catch (e) {
      setError(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const itemSum = run ? run.parsed.items.reduce((s, it) => s + it.amount, 0) : 0;
  const total = run?.parsed.detectedTotal ?? null;
  const rows = run ? run.text.split("\n") : [];

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h2 className="section-title">1. Scanner</h2>
        {health ? (
          <div className={health.available ? "alert-success" : "alert-error"}>
            {health.available ? "Reachable" : "Not reachable (DOCLING_URL, DOCLING_SECRET, Docker or ngrok)"}: health check took {health.ms} ms
          </div>
        ) : (
          <div className="text-sm text-muted">Checking…</div>
        )}
        <button type="button" className="btn-secondary" onClick={() => void check()}>
          Check again
        </button>
      </div>

      <div className="card space-y-3">
        <h2 className="section-title">2. Image</h2>
        <FileDropzone
          label="Choose a receipt image"
          accept="image/*"
          action="to inspect"
          hint="One image. It is re-encoded as JPEG first, exactly like the scan screen does."
          onFiles={(fs) => {
            setFile(fs[0] ?? null);
            setRun(null);
          }}
          onReject={() => setError("That is not an image.")}
        />
        {file ? <div className="text-sm">{file.name}</div> : null}
        <button type="button" className="btn-primary w-full" disabled={!file || busy} onClick={() => void scan()}>
          {busy ? "Scanning…" : "Scan"}
        </button>
        {error ? <div className="alert-error">{error}</div> : null}
      </div>

      {run ? (
        <>
          <div className="card space-y-2">
            <h2 className="section-title">3. Timings and size</h2>
            <table className="data-table">
              <tbody>
                <tr><td>Scanner (Docling)</td><td>{run.result.ms ?? "?"} ms</td></tr>
                <tr><td>Round trip (browser, Vercel, ngrok, scanner)</td><td>{run.roundTripMs} ms</td></tr>
                <tr><td>Image picked</td><td>{(run.originalBytes / 1024).toFixed(0)} KB</td></tr>
                <tr><td>Image sent</td><td>{(run.sentBytes / 1024).toFixed(0)} KB, {run.result.pages[0]?.width} x {run.result.pages[0]?.height} px</td></tr>
                <tr><td>OCR pieces / layout blocks</td><td>{run.result.cells?.length ?? "none (old scanner)"} / {run.result.items.length}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card space-y-3">
            <h2 className="section-title">4. What the OCR found</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showCells} onChange={(e) => setShowCells(e.target.checked)} />
                <span className="text-primary-light">OCR pieces</span> (used by the app)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showBlocks} onChange={(e) => setShowBlocks(e.target.checked)} />
                <span className="text-muted">Layout blocks</span> (dashed)
              </label>
            </div>
            <Overlay run={run} showCells={showCells} showBlocks={showBlocks} />
          </div>

          <div className="card space-y-2">
            <h2 className="section-title">5. Rows rebuilt ({rows.length})</h2>
            <ol className="space-y-1 font-mono text-xs">
              {rows.map((r, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-6 shrink-0 text-right text-muted">{i + 1}</span>
                  <span className="break-all">{r}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="card space-y-3">
            <h2 className="section-title">6. What the parser made</h2>
            <table className="data-table">
              <tbody>
                <tr><td>Merchant</td><td>{run.parsed.merchant}</td></tr>
                <tr><td>Date</td><td>{run.parsed.purchasedOn ?? "not found"}</td></tr>
                <tr><td>Total on receipt</td><td>{total != null ? formatINR(total) : "not found"}</td></tr>
                <tr><td>Tax on receipt</td><td>{run.parsed.detectedTax != null ? formatINR(run.parsed.detectedTax) : "not found"}</td></tr>
                <tr>
                  <td>Items add up to</td>
                  <td className={total != null && Math.abs(itemSum - total) > 0.5 ? "font-semibold text-negative" : ""}>
                    {formatINR(itemSum)}
                    {total != null ? (Math.abs(itemSum - total) > 0.5 ? `, ${formatINR(total - itemSum)} short of the total` : ", matches the total") : ""}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Item</th><th>Category</th><th>Qty</th><th>Amount</th><th>GST</th></tr>
                </thead>
                <tbody>
                  {run.parsed.items.length === 0 ? (
                    <tr><td colSpan={5} className="text-muted">No items</td></tr>
                  ) : (
                    run.parsed.items.map((it, i) => (
                      <tr key={i}>
                        <td>{it.description}</td>
                        <td>{it.category}</td>
                        <td>{it.qty ?? ""}</td>
                        <td>{formatINR(it.amount)}</td>
                        <td>{it.gstRate != null ? `${it.gstRate}% (${formatINR(it.gstAmount ?? 0)})` : ""}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <details className="card">
            <summary className="cursor-pointer text-sm font-semibold">7. Raw scanner result (JSON)</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(run.result, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </div>
  );
}
