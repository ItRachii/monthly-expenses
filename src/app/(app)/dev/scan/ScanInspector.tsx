"use client";

import { useCallback, useEffect, useState } from "react";
import { FileDropzone } from "@/components/FileDropzone";
import { prepareImage } from "@/lib/scanner/prepareImage";
import { NOT_A_PRICE, plainText, struckPrices, unstrikePrice, type ScanItem, type ScanResult } from "@/lib/scanner/lines";
import type { Tag } from "@/lib/scanner/pii";
import { ORDER_APPS, OTHER_APP } from "@/lib/receipt/quickCommerce";
import { billRows, orderRows, settleOrder, type BillReading, type RowPart } from "@/lib/receipt/orderBill";
import { readOrder, readOrderShots, readReceiptShots, type Completeness } from "@/lib/receipt/readOrder";
import type { ShotRow, Stitched } from "@/lib/receipt/stitch";
import { formatINR } from "@/lib/format";

interface Health {
  available: boolean;
  ms: number;
}

/** One image's scan. */
interface Run {
  name: string;
  imageUrl: string;
  sentBytes: number;
  originalBytes: number;
  roundTripMs: number;
  text: string;
  /** Its rows with their height, as Add Expense stitches them. */
  rows: ShotRow[];
  /** The file's time, the stitching's tie-break. */
  taken: number;
  result: ScanResult & { ms?: number };
}

// What each part of an order screenshot means for the reading.
const PART: Record<RowPart, string> = {
  "before-items": "Above the items heading: skipped",
  "items-heading": "Items heading: products start below",
  product: "Product row",
  "bill-wording": "Reads like a fee, discount or total: not a product",
  "order-heading": "Order heading (\"4 items\"): skipped",
  "bill-heading": "Bill heading: the bill starts here",
  breakdown: "How the item total was reached (MRP, product discount): already in the prices",
  bill: "Bill section",
};

function reading(r: BillReading): string {
  switch (r.kind) {
    case "item-total":
      return `Item total ${formatINR(r.amount)} (a check, not added)`;
    case "order-total":
      return `Order total ${formatINR(r.amount)}`;
    case "total":
      return `Total ${formatINR(r.amount)} (used if no order total)`;
    case "charge":
      return `Charge +${formatINR(r.amount)}`;
    case "discount":
      return `Discount ${formatINR(r.amount)}`;
    case "waived":
      return "Fee waived (FREE): not charged";
    case "info":
      return "Savings note: ignored";
    case "after-total":
      return "Below the total: ignored";
    case "breakdown":
      return "Not a charge";
    default:
      return "";
  }
}

// How each kind of detail is drawn and named.
const TAG_STYLE: Record<Tag["kind"], { stroke: string; text: string; label: string }> = {
  phone: { stroke: "stroke-orange-500", text: "text-orange-500", label: "Phone number" },
  address: { stroke: "stroke-fuchsia-500", text: "text-fuchsia-500", label: "Address" },
  name: { stroke: "stroke-pink-500", text: "text-pink-500", label: "Name" },
  email: { stroke: "stroke-teal-500", text: "text-teal-500", label: "Email or UPI id" },
  "order-id": { stroke: "stroke-sky-500", text: "text-sky-500", label: "Order number (kept)" },
};

/** How one screenshot's struck prices were found, kept for display. */
function strikeView(run: Run) {
  const all = run.result.cells?.length ? run.result.cells : run.result.items;
  // The scanner looked at the image and split each piece holding a struck
  // price; an older one did not, and the app guesses from the layout.
  const fromImage = !!run.result.strikeCheck;
  const split = new Map<string, ScanItem[]>();
  for (const p of all) if (p.from != null && !p.pii) split.set(p.from, [...(split.get(p.from) ?? []), p]);
  const pieces = all.filter((p) => !p.struck && !p.pii);
  const struck = fromImage ? new Map<ScanItem, ScanItem>() : struckPrices(pieces);
  const merged = fromImage ? [] : pieces.filter((p) => !struck.has(p) && unstrikePrice(p.text) !== p.text);
  return { fromImage, split, imageStruck: all.filter((p) => p.struck), struck, merged };
}

/** How the order's text (all its screenshots, put together) was read, kept for display. */
function orderView(text: string, order: ReturnType<typeof readOrder>) {
  const parts = orderRows(text);
  const bills = billRows(text);
  const inOrder = order.items.filter((it) => !it.repeat);
  const prices = inOrder.map((it) => it.amount);
  const settled = settleOrder(prices, order.bill.charges.map((c) => c.amount), order.bill.orderTotal);
  const share = new Map(inOrder.map((it, k) => [it, settled.shares?.[k] ?? 0]));
  return { parts, bills, order, settled, share, itemsSum: prices.reduce((a, b) => a + b, 0) };
}

/** The boxes the scanner returned, drawn over the image that was sent. */
function Overlay({
  run,
  showCells,
  showBlocks,
  struck = [],
  merged = [],
  showPii = false,
}: {
  run: Run;
  showCells: boolean;
  showBlocks: boolean;
  struck?: ScanItem[];
  merged?: ScanItem[];
  showPii?: boolean;
}) {
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
        {struck.map((it, i) => rect(it, i, "stroke-negative [stroke-width:4]"))}
        {merged.map((it, i) => rect(it, i, "stroke-warning [stroke-width:4]"))}
        {showPii
          ? (run.result.cells ?? run.result.items)
              .filter((it) => it.page === page.page && (it.pii || it.ref))
              .map((it, i) => rect(it, i, `${TAG_STYLE[(it.pii ?? it.ref)!.kind].stroke} [stroke-width:4] [stroke-dasharray:10_4]`))
          : null}
      </svg>
    </div>
  );
}

export function ScanInspector() {
  const [health, setHealth] = useState<Health | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<{ file: number; files: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  // The order is read as picked when scanned, whatever the picker says now.
  const [runApp, setRunApp] = useState<string>(OTHER_APP);
  const [pick, setPick] = useState(0);
  const [showCells, setShowCells] = useState(true);
  const [showBlocks, setShowBlocks] = useState(false);
  const [showPii, setShowPii] = useState(true);
  const [app, setApp] = useState<string>(OTHER_APP);

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

  // Revoke the previous previews when new runs replace them.
  useEffect(() => () => runs.forEach((r) => URL.revokeObjectURL(r.imageUrl)), [runs]);

  async function scan() {
    if (files.length === 0) return;
    setError(null);
    setRuns([]);
    const done: Run[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setBusy({ file: i + 1, files: files.length });
        const file = files[i];
        const image = await prepareImage(file);
        const t0 = performance.now();
        // An order is scanned as Add Expense does it, struck prices left out.
        const res = await fetch(app !== OTHER_APP ? "/api/scan?debug=1&order=1" : "/api/scan?debug=1", {
          method: "POST",
          headers: { "Content-Type": image.type || "application/octet-stream" },
          body: image,
        });
        const roundTripMs = Math.round(performance.now() - t0);
        const body = (await res.json().catch(() => ({}))) as { text?: string; rows?: ShotRow[]; error?: string; debug?: Run["result"] };
        if (!res.ok || typeof body.text !== "string" || !body.debug) {
          setError(
            `Scan of ${file.name} failed: HTTP ${res.status}${body.error ? `, ${body.error}` : ""}${res.ok && !body.debug ? ", no debug data (is this address in DEVELOPER_EMAILS?)" : ""}`,
          );
          return;
        }
        done.push({
          name: file.name,
          imageUrl: URL.createObjectURL(image),
          sentBytes: image.size,
          originalBytes: file.size,
          roundTripMs,
          text: body.text,
          rows: body.rows ?? body.text.split("\n").map((text, k, all) => ({ text, y: k / all.length })),
          taken: file.lastModified,
          result: body.debug,
        });
      }
      setRunApp(app);
      setPick(0);
      setRuns(done);
    } catch (e) {
      setError(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const run: Run | undefined = runs[pick];
  const isOrder = runApp !== OTHER_APP;
  // Exactly what Add Expense does with the same screenshots.
  const whole = runs.length && isOrder ? readOrderShots(runs.map((r) => r.rows), runApp, runs.map((r) => r.taken)) : null;
  const receipt = runs.length && !isOrder ? readReceiptShots(runs.map((r) => r.text)) : null;
  const sv = run && isOrder ? strikeView(run) : null;
  const rows = run ? run.text.split("\n") : [];
  const n = runs.length;

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
        <h2 className="section-title">2. Images</h2>
        <FileDropzone
          label="Choose receipt images or order screenshots"
          accept="image/*"
          multiple
          action="to inspect"
          hint="One or several, in any order, as in Add Expense. Each is re-encoded as JPEG first, exactly like Add Expense does."
          onFiles={(fs) => {
            setFiles(fs);
            setRuns([]);
          }}
          onReject={() => setError("That is not an image.")}
        />
        {files.length ? <div className="text-sm">{files.map((f, i) => `${i + 1}. ${f.name}`).join(", ")}</div> : null}
        <label className="block space-y-1 text-sm">
          <span>Ordered from</span>
          <select className="input" value={app} onChange={(e) => setApp(e.target.value)}>
            <option value={OTHER_APP}>A receipt (not an order)</option>
            {ORDER_APPS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <span className="block text-xs text-muted">An app reads the images as order screenshots, exactly like Add Expense.</span>
        </label>
        <button type="button" className="btn-primary w-full" disabled={files.length === 0 || busy !== null} onClick={() => void scan()}>
          {busy ? `Scanning ${busy.file} of ${busy.files}…` : `Scan ${files.length || ""} image${files.length === 1 ? "" : "s"}`}
        </button>
        {error ? <div className="alert-error">{error}</div> : null}
      </div>

      {run ? (
        <>
          {n > 1 ? (
            <div className="card space-y-2" data-pick>
              <div className="text-sm text-muted">Sections 3 to 7 are for one image at a time:</div>
              <div className="flex flex-wrap gap-2">
                {runs.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    className={i === pick ? "btn-primary" : "btn-secondary"}
                    aria-pressed={i === pick}
                    onClick={() => setPick(i)}
                  >
                    Image {i + 1}
                  </button>
                ))}
              </div>
              <div className="text-xs text-muted">{run.name}</div>
            </div>
          ) : null}

          <div className="card space-y-2">
            <h2 className="section-title">3. Timings and size{n > 1 ? `, image ${pick + 1}` : ""}</h2>
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
            <h2 className="section-title">4. What the OCR found{n > 1 ? `, image ${pick + 1}` : ""}</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showCells} onChange={(e) => setShowCells(e.target.checked)} />
                <span className="text-primary-light">OCR pieces</span> (used by the app)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showPii} onChange={(e) => setShowPii(e.target.checked)} />
                Personal details (dashed, by kind)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showBlocks} onChange={(e) => setShowBlocks(e.target.checked)} />
                <span className="text-muted">Layout blocks</span> (dashed)
              </label>
            </div>
            {sv ? (
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-negative">Red: struck-out price left out</span>
                <span className="text-warning">
                  {sv.fromImage ? "Amber: what was left of the piece, read again" : "Amber: two prices read as one, the price paid kept"}
                </span>
              </div>
            ) : null}
            <Overlay
              showPii={showPii}
              run={run}
              showCells={showCells}
              showBlocks={showBlocks}
              struck={sv ? (sv.fromImage ? sv.imageStruck : [...sv.struck.keys()]) : []}
              merged={sv ? (sv.fromImage ? [...sv.split.values()].flat().filter((p) => !p.struck) : sv.merged) : []}
            />
          </div>

          <PersonalDetails run={run} />

          <div className="card space-y-2">
            <h2 className="section-title">6. Rows rebuilt ({rows.length}){n > 1 ? `, image ${pick + 1}` : ""}</h2>
            <ol className="space-y-1 font-mono text-xs">
              {rows.map((r, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-6 shrink-0 text-right text-muted">{i + 1}</span>
                  <span className="break-all">{r}</span>
                </li>
              ))}
            </ol>
          </div>

          {sv ? <StruckSection sv={sv} /> : null}

          {whole ? (
            <>
              <StitchSection stitched={whole.stitched} complete={whole.complete} runs={runs} />
              <OrderSections ov={orderView(whole.stitched.text, whole.order)} complete={whole.complete} />
            </>
          ) : null}

          {receipt ? <ReceiptSection parsed={receipt.parsed} repeats={receipt.repeats} n={n} /> : null}

          <details className="card">
            <summary className="cursor-pointer text-sm font-semibold">Raw scanner result (JSON){n > 1 ? `, image ${pick + 1}` : ""}</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(run.result, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </div>
  );
}

/** What the receipt parser made of the images, read as one (as Add Expense does). */
function ReceiptSection({ parsed, repeats, n }: { parsed: ReturnType<typeof readReceiptShots>["parsed"]; repeats: boolean[]; n: number }) {
  const itemSum = parsed.items.reduce((s, it) => s + it.amount, 0);
  const total = parsed.detectedTotal ?? null;
  return (
    <div className="card space-y-3">
      <h2 className="section-title">8. What the parser made{n > 1 ? `, all ${n} images read as one` : ""}</h2>
      <table className="data-table">
        <tbody>
          <tr><td>Merchant</td><td>{parsed.merchant}</td></tr>
          <tr><td>Date</td><td>{parsed.purchasedOn ?? "not found"}</td></tr>
          <tr><td>Total on receipt</td><td>{total != null ? formatINR(total) : "not found"}</td></tr>
          <tr><td>Tax on receipt</td><td>{parsed.detectedTax != null ? formatINR(parsed.detectedTax) : "not found"}</td></tr>
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
            {parsed.items.length === 0 ? (
              <tr><td colSpan={5} className="text-muted">No items</td></tr>
            ) : (
              parsed.items.map((it, i) => (
                <tr key={i} className={repeats[i] ? "text-muted" : ""}>
                  <td>{it.description}{repeats[i] ? " (read again from an overlapping image, unticked)" : ""}</td>
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
  );
}

/** How the screenshots were put together into one order. */
function StitchSection({ stitched, complete, runs }: { stitched: Stitched; complete: Completeness; runs: Run[] }) {
  const label = (i: number) => `Image ${i + 1}`;
  return (
    <div className="card space-y-3" data-stitch>
      <h2 className="section-title">8. Putting the screenshots together</h2>
      <p className="text-sm text-muted">
        As Add Expense does it. The status bar and the header and footer every screenshot repeats are kept once. Screenshots
        are joined where they share rows (kept once, the fuller copy when an edge row is cut), or where the row cut at the
        bottom of one is the first of the next; the rest are placed by which holds the top of the order and which the bill
        total, then by when they were taken.
      </p>
      {runs.length > 1 ? (
        <>
          <div className="text-sm">
            Reading order: <span className="font-semibold">{stitched.order.map(label).join(", ")}</span>
          </div>
          {stitched.duplicates.length ? (
            <div className="text-sm">
              {stitched.duplicates.map((d, k) => `${label(d)} repeats ${label(stitched.duplicateOf[k])} and was left out.`).join(" ")}
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Join</th><th>How</th><th>Shared rows (kept once)</th><th>Cut rows dropped</th><th>Fuller copy kept</th></tr>
              </thead>
              <tbody>
                {stitched.joins.map((j, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{label(j.from)} to {label(j.to)}</td>
                    <td>
                      {j.how === "shared"
                        ? `${j.overlap} row${j.overlap === 1 ? "" : "s"} shared`
                        : j.how === "cut-row"
                          ? "a row cut at the edge of one"
                          : `nothing shared: placed ${j.why}`}
                    </td>
                    <td className="font-mono text-xs">{j.shared.join(" | ") || ""}</td>
                    <td className="font-mono text-xs">{j.dropped.join(" | ") || ""}</td>
                    <td className="font-mono text-xs">{j.fuller.map(([was, now]) => `${was} → ${now}`).join(" | ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-muted">
            Kept once from the edges: {[...stitched.chrome.top, ...stitched.chrome.bottom].join(" | ") || "nothing"}
          </div>
        </>
      ) : (
        <div className="text-sm text-muted">One screenshot: nothing to put together.</div>
      )}
      <table className="data-table">
        <tbody>
          <tr><td>The order says</td><td>{complete.expected != null ? `${complete.expected} items` : "no item count"}</td></tr>
          <tr><td>Items read</td><td>{complete.found}</td></tr>
          <tr><td>Short of the bill&apos;s item total</td><td>{complete.short != null ? formatINR(complete.short) : "no"}</td></tr>
          <tr><td>Bill total found</td><td>{complete.noTotal ? "no" : "yes"}</td></tr>
        </tbody>
      </table>
      {complete.missing ? (
        <div className="alert-warning">Add Expense would ask for the missing screenshots here.</div>
      ) : complete.checked ? (
        <div className="alert-success">The whole order is here, as far as the order itself says.</div>
      ) : (
        <div className="text-sm text-muted">This order shows no item count or item total to check against.</div>
      )}
    </div>
  );
}

/** One screenshot's struck prices: found in the image, or guessed from the layout by an older scanner. */
function StruckSection({ sv }: { sv: ReturnType<typeof strikeView> }) {
  return (
      <div className="card space-y-2">
        <h2 className="section-title">7. Struck-out prices</h2>
        {sv.fromImage ? (
          <>
            <p className="text-sm text-muted">
              Found by the scanner in the image: a thin line across the middle of a price, longer than any character and
              crossing the gaps between them. OCR can&apos;t see the line, so it mangles struck prices (&quot;Z175&quot;) or runs them
              into the price paid (&quot;30日297&quot;). Each such piece is split at the line, the struck part is left out and the
              rest is read again on its own.
            </p>
            {sv.split.size === 0 ? (
              <div className="text-sm text-muted">None on this screenshot.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>OCR read</th><th>Struck out (left out)</th><th>Kept</th></tr>
                </thead>
                <tbody>
                  {[...sv.split].map(([from, ps], i) => (
                    <tr key={i}>
                      <td className="font-mono">{from}</td>
                      <td className="font-mono text-negative">{ps.filter((p) => p.struck).map((p) => p.text).join(", ")}</td>
                      <td className="font-mono text-warning">{ps.filter((p) => !p.struck).map((p) => p.text).join(", ") || "nothing"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              This scanner doesn&apos;t look for strike lines (rebuild it to get that), so they are guessed from the layout: a
              price piece just under the price paid (same column, touching, no larger), or two prices run into one number.
            </p>
            {sv.struck.size === 0 && sv.merged.length === 0 ? (
              <div className="text-sm text-muted">None on this screenshot.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>OCR read</th><th>What was done</th></tr>
                </thead>
                <tbody>
                  {[...sv.struck].map(([low, high], i) => (
                    <tr key={`s${i}`}>
                      <td className="font-mono text-negative">{low.text}</td>
                      <td>Left out: sits under {high.text}, the price paid</td>
                    </tr>
                  ))}
                  {sv.merged.map((p, i) => (
                    <tr key={`m${i}`}>
                      <td className="font-mono text-warning">{p.text}</td>
                      <td>Read as struck {p.text.trim().slice(0, p.text.trim().length - unstrikePrice(p.text).length)}, paid {unstrikePrice(p.text)}: kept {unstrikePrice(p.text)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

  );
}

/** How the order's rows were read and what Add Expense makes of them. */
function OrderSections({ ov, complete }: { ov: ReturnType<typeof orderView>; complete: Completeness }) {
  const { check, shares } = ov.settled;
  const bill = ov.order.bill;
  // A product row with a price is an item; one without is a detail line ("1 pc (250 ml)").
  const became = (line: string) => {
    const it = ov.order.items.find((x) => line.trim().startsWith(x.read));
    if (it) return `Item: ${it.description}, ${formatINR(it.amount)}`;
    const text = plainText(line).trim();
    const of = text.length > 2 ? ov.order.items.find((x) => x.description.endsWith(text)) : undefined;
    if (of) return `Rest of the name above (it wraps): ${of.description}`;
    // The row's last number was part of its text, not a price piece of its own.
    if (line.includes(NOT_A_PRICE)) return `Not an item: its "${text.match(/[\d.,]+\W*$/)?.[0].trim()}" is part of the text, not a price in the price column`;
    return "No price: not an item";
  };
  return (
    <>
      <div className="card space-y-2">
        <h2 className="section-title">9. How each row was read</h2>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Row</th><th>Part of the screen</th><th>What it became</th></tr>
            </thead>
            <tbody>
              {ov.parts.map((r, i) => (
                <tr key={i} className={r.part === "product" ? "" : "text-muted"}>
                  <td>{i + 1}</td>
                  <td className="font-mono text-xs">{plainText(r.line)}</td>
                  <td>{PART[r.part]}</td>
                  <td>{r.part === "product" ? became(r.line) : reading(ov.bills[i].reading)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="section-title">10. The order, as Add Expense shows it</h2>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Parser read</th><th>Item</th><th>Qty</th><th>Category</th><th>Price</th><th>Share of charges</th><th>Expense</th></tr>
            </thead>
            <tbody>
              {ov.order.items.length === 0 ? (
                <tr><td colSpan={7} className="text-muted">No items</td></tr>
              ) : (
                ov.order.items.map((it, i) => {
                  const share = ov.share.get(it) ?? 0;
                  return (
                    <tr key={i} className={it.repeat ? "text-muted" : ""}>
                      <td className="font-mono text-xs">{it.read}</td>
                      <td>{it.description}{it.repeat ? " (repeat, unticked)" : ""}</td>
                      <td>{it.qty ?? ""}</td>
                      <td>{it.category}</td>
                      <td>{formatINR(it.amount)}</td>
                      <td>{it.repeat || !shares ? "" : formatINR(share)}</td>
                      <td>{it.repeat || !shares ? "" : formatINR(it.amount + share)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <table className="data-table">
          <tbody>
            <tr>
              <td>Items add up to</td>
              <td>
                {formatINR(ov.itemsSum)}
                {bill.itemTotal == null
                  ? ", no item total on the bill"
                  : Math.abs(ov.itemsSum - bill.itemTotal) <= 1
                    ? `, same as the bill's item total`
                    : bill.inPrices?.length && Math.abs(ov.itemsSum - bill.itemTotal - bill.inPrices.reduce((t, c) => t + c.amount, 0)) <= 1
                      ? `, the bill's item total ${formatINR(bill.itemTotal)} less the discounts already in the prices`
                      : `, the bill's item total says ${formatINR(bill.itemTotal)}: an item is missed or extra`}
              </td>
            </tr>
            {bill.charges.map((c, i) => (
              <tr key={i}><td>{c.label}</td><td>{c.amount < 0 ? formatINR(c.amount) : `+${formatINR(c.amount)}`}</td></tr>
            ))}
            {(bill.inPrices ?? []).map((c, i) => (
              <tr key={`in${i}`} className="text-muted">
                <td>{c.label}</td>
                <td>{formatINR(c.amount)}: already taken off the item prices (they add up to the item total less this), so not counted again</td>
              </tr>
            ))}
            <tr><td>Order total</td><td>{bill.orderTotal != null ? formatINR(bill.orderTotal) : "not found"}</td></tr>
          </tbody>
        </table>
        {complete.missing ? (
          <div className="alert-warning" data-missing>
            {complete.expected != null && complete.found < complete.expected ? `The order lists ${complete.expected} items, ${complete.found} were read. ` : ""}
            {complete.short != null ? `The items come to ${formatINR(complete.short)} less than the item total. ` : ""}
            {complete.noTotal ? "No bill total was read. " : ""}
            Add Expense asks for the missing screenshots.
          </div>
        ) : null}
        {check.status === "matched" ? (
          <div className="alert-success">
            Matches: items {formatINR(check.items)} and charges {formatINR(check.charges)} come to{" "}
            {formatINR(check.items + check.charges)}, the order total is {formatINR(check.total)}
            {check.diff !== 0 ? ` (${formatINR(check.diff)} rounding, inside the ₹1 allowed)` : ""}. The items carry{" "}
            {formatINR(check.total - check.items)} between them, by price. Save is allowed.
          </div>
        ) : check.status === "mismatch" ? (
          <div className="alert-error">
            Doesn&apos;t match: items {formatINR(check.items)} and charges {formatINR(check.charges)} come to{" "}
            {formatINR(check.items + check.charges)}, the order total is {formatINR(check.total)}, off by {formatINR(check.diff)}. Save is blocked until fixed.
          </div>
        ) : (
          <div className="alert-warning">No order total found: the user has to type it in before saving.</div>
        )}
      </div>
    </>
  );
}

/** What was taken for a personal detail and left out of everything the app reads, and the order numbers that were not. */
function PersonalDetails({ run }: { run: Run }) {
  const pieces = (run.result.cells?.length ? run.result.cells : run.result.items).filter((p) => p.pii || p.ref);
  return (
    <div className="card space-y-2">
      <h2 className="section-title">5. Personal details</h2>
      <p className="text-sm text-muted">
        Left out of everything the app reads, so they are never parsed, shown or saved; masked here. A 10-digit number is a
        phone only when nothing marks it as an order or reference number: a label beside it (&quot;Order ID&quot;,
        &quot;Invoice no.&quot;) or letters and hyphens glued to it (&quot;ORD…&quot;, &quot;BNN-…&quot;). Addresses need two signs
        (a place word, a city or state, a PIN code, a comma list), or one beside an address label or another address line.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {Object.values(TAG_STYLE).map((t) => (
          <span key={t.label} className={t.text}>
            {t.label}
          </span>
        ))}
      </div>
      {pieces.length === 0 ? (
        <div className="text-sm text-muted">None on this screenshot.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Found</th><th>As</th><th>Why</th></tr>
            </thead>
            <tbody>
              {pieces.map((p, i) => {
                const tag = (p.pii ?? p.ref)!;
                return (
                  <tr key={i}>
                    <td className="font-mono text-xs">{p.text}</td>
                    <td className={TAG_STYLE[tag.kind].text}>{TAG_STYLE[tag.kind].label}</td>
                    <td>{tag.why}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
