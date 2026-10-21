"use client";

import { useCallback, useEffect, useState } from "react";
import { FileDropzone } from "@/components/FileDropzone";
import { prepareImage } from "@/lib/scanner/prepareImage";
import { parseReceipt } from "@/lib/receipt/parse";
import { struckPrices, unstrikePrice, type ScanItem, type ScanResult } from "@/lib/scanner/lines";
import type { Tag } from "@/lib/scanner/pii";
import type { ParsedReceipt } from "@/lib/receipt/types";
import { ORDER_APPS, OTHER_APP } from "@/lib/receipt/quickCommerce";
import { billRows, orderRows, settleOrder, type BillReading, type RowPart } from "@/lib/receipt/orderBill";
import { readOrder } from "@/lib/receipt/readOrder";
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
  /** The app picked, or OTHER_APP for a plain receipt. */
  app: string;
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

/** The order reading of one screenshot, with every step kept for display. */
function orderView(run: Run) {
  const all = run.result.cells?.length ? run.result.cells : run.result.items;
  // The scanner looked at the image and split each piece holding a struck
  // price; an older one did not, and the app guesses from the layout.
  const fromImage = !!run.result.strikeCheck;
  const split = new Map<string, ScanItem[]>();
  for (const p of all) if (p.from != null) split.set(p.from, [...(split.get(p.from) ?? []), p]);
  const pieces = all.filter((p) => !p.struck);
  const struck = fromImage ? new Map<ScanItem, ScanItem>() : struckPrices(pieces);
  const merged = fromImage ? [] : pieces.filter((p) => !struck.has(p) && unstrikePrice(p.text) !== p.text);
  const parts = orderRows(run.text);
  const bills = billRows(run.text);
  const order = readOrder([run.text], run.app);
  const inOrder = order.items.filter((it) => !it.repeat);
  const prices = inOrder.map((it) => it.amount);
  const settled = settleOrder(prices, order.bill.charges.map((c) => c.amount), order.bill.orderTotal);
  const share = new Map(inOrder.map((it, k) => [it, settled.shares?.[k] ?? 0]));
  return {
    fromImage,
    split,
    imageStruck: all.filter((p) => p.struck),
    struck,
    merged,
    parts,
    bills,
    order,
    settled,
    share,
    itemsSum: prices.reduce((a, b) => a + b, 0),
  };
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
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
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
      // An order is scanned as the scan screen does it, struck prices left out.
      const res = await fetch(app !== OTHER_APP ? "/api/scan?debug=1&order=1" : "/api/scan?debug=1", {
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
        app,
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
  const ov = run && run.app !== OTHER_APP ? orderView(run) : null;

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
        <label className="block space-y-1 text-sm">
          <span>Ordered from</span>
          <select
            className="input"
            value={app}
            onChange={(e) => {
              setApp(e.target.value);
              setRun(null);
            }}
          >
            <option value={OTHER_APP}>A receipt (not an order)</option>
            {ORDER_APPS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <span className="block text-xs text-muted">An app reads the image as an order screenshot, exactly like Add Expense.</span>
        </label>
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
                <input type="checkbox" checked={showPii} onChange={(e) => setShowPii(e.target.checked)} />
                Personal details (dashed, by kind)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showBlocks} onChange={(e) => setShowBlocks(e.target.checked)} />
                <span className="text-muted">Layout blocks</span> (dashed)
              </label>
            </div>
            {ov ? (
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-negative">Red: struck-out price left out</span>
                <span className="text-warning">
                  {ov.fromImage ? "Amber: what was left of the piece, read again" : "Amber: two prices read as one, the price paid kept"}
                </span>
              </div>
            ) : null}
            <Overlay
              showPii={showPii}
              run={run}
              showCells={showCells}
              showBlocks={showBlocks}
              struck={ov ? (ov.fromImage ? ov.imageStruck : [...ov.struck.keys()]) : []}
              merged={ov ? (ov.fromImage ? [...ov.split.values()].flat().filter((p) => !p.struck) : ov.merged) : []}
            />
          </div>

          <PersonalDetails run={run} />

          <div className="card space-y-2">
            <h2 className="section-title">6. Rows rebuilt ({rows.length})</h2>
            <ol className="space-y-1 font-mono text-xs">
              {rows.map((r, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-6 shrink-0 text-right text-muted">{i + 1}</span>
                  <span className="break-all">{r}</span>
                </li>
              ))}
            </ol>
          </div>

          {ov ? <OrderSections ov={ov} /> : (
          <div className="card space-y-3">
            <h2 className="section-title">7. What the parser made</h2>
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

          )}

          <details className="card">
            <summary className="cursor-pointer text-sm font-semibold">Raw scanner result (JSON)</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(run.result, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </div>
  );
}

/** How an order screenshot was read: struck prices, each row's part, the result. */
function OrderSections({ ov }: { ov: ReturnType<typeof orderView> }) {
  const { check, shares } = ov.settled;
  const bill = ov.order.bill;
  // A product row with a price is an item; one without is a detail line ("1 pc (250 ml)").
  const became = (line: string) => {
    const it = ov.order.items.find((x) => line.trim().startsWith(x.read));
    return it ? `Item: ${it.description}, ${formatINR(it.amount)}` : "No price: not an item";
  };
  return (
    <>
      <div className="card space-y-2">
        <h2 className="section-title">7. Struck-out prices</h2>
        {ov.fromImage ? (
          <>
            <p className="text-sm text-muted">
              Found by the scanner in the image: a thin line across the middle of a price, longer than any character and
              crossing the gaps between them. OCR can&apos;t see the line, so it mangles struck prices (&quot;Z175&quot;) or runs them
              into the price paid (&quot;30日297&quot;). Each such piece is split at the line, the struck part is left out and the
              rest is read again on its own.
            </p>
            {ov.split.size === 0 ? (
              <div className="text-sm text-muted">None on this screenshot.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>OCR read</th><th>Struck out (left out)</th><th>Kept</th></tr>
                </thead>
                <tbody>
                  {[...ov.split].map(([from, ps], i) => (
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
            {ov.struck.size === 0 && ov.merged.length === 0 ? (
              <div className="text-sm text-muted">None on this screenshot.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>OCR read</th><th>What was done</th></tr>
                </thead>
                <tbody>
                  {[...ov.struck].map(([low, high], i) => (
                    <tr key={`s${i}`}>
                      <td className="font-mono text-negative">{low.text}</td>
                      <td>Left out: sits under {high.text}, the price paid</td>
                    </tr>
                  ))}
                  {ov.merged.map((p, i) => (
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

      <div className="card space-y-2">
        <h2 className="section-title">8. How each row was read</h2>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Row</th><th>Part of the screen</th><th>What it became</th></tr>
            </thead>
            <tbody>
              {ov.parts.map((r, i) => (
                <tr key={i} className={r.part === "product" ? "" : "text-muted"}>
                  <td>{i + 1}</td>
                  <td className="font-mono text-xs">{r.line}</td>
                  <td>{PART[r.part]}</td>
                  <td>{r.part === "product" ? became(r.line) : reading(ov.bills[i].reading)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="section-title">9. The order, as Add Expense shows it</h2>
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
                {bill.itemTotal != null
                  ? Math.abs(ov.itemsSum - bill.itemTotal) <= 1
                    ? `, same as the bill's item total`
                    : `, the bill's item total says ${formatINR(bill.itemTotal)}: an item is missed or extra`
                  : ", no item total on the bill"}
              </td>
            </tr>
            {bill.charges.map((c, i) => (
              <tr key={i}><td>{c.label}</td><td>{c.amount < 0 ? formatINR(c.amount) : `+${formatINR(c.amount)}`}</td></tr>
            ))}
            <tr><td>Order total</td><td>{bill.orderTotal != null ? formatINR(bill.orderTotal) : "not found"}</td></tr>
          </tbody>
        </table>
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
