"use client";

import { CameraIcon, XIcon } from "@/components/Icons";
import { FileDropzone } from "@/components/FileDropzone";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepareImage } from "@/lib/scanner/prepareImage";
import { parseReceipt } from "@/lib/receipt/parse";
import { ORDER_APPS, OTHER_APP } from "@/lib/receipt/quickCommerce";
import { settleOrder } from "@/lib/receipt/orderBill";
import { readOrderShots, readReceiptShots, type Completeness } from "@/lib/receipt/readOrder";
import type { ShotRow, Stitched } from "@/lib/receipt/stitch";
import { addReceiptAction } from "@/lib/actions/receipts";
import { trackScanAction } from "@/lib/actions/scanTracking";
import { CategorySelect } from "@/components/CategorySelect";
import { SPLIT_CUSTOM, SPLIT_EQUAL } from "@/lib/constants";
import { formatINR, localISO, todayISO } from "@/lib/format";

/** What seems to be missing from the order's screenshots, with a way to add them. */
function MissingParts({ stitched, onAdd }: { stitched: Stitched & { complete: Completeness }; onAdd: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  const { expected, found, short, noTotal } = stitched.complete;
  const lines: string[] = [];
  if (expected != null && found < expected) lines.push(`The order lists ${expected} items, but ${found} were found in your screenshots.`);
  if (short != null) lines.push(`The items come to ${formatINR(short)} less than the bill's item total.`);
  if (noTotal) lines.push("The bill total isn't in these screenshots.");
  const gap = stitched.joins.find((j) => j.how === "none");
  if (gap && (short != null || (expected != null && found < expected)))
    lines.push(`Part of the list seems to be missing between screenshot ${gap.from + 1} and ${gap.to + 1}.`);
  return (
    <div className="alert-warning space-y-2" data-missing>
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
      <div>Add the missing screenshots, in any order, and they&apos;ll be read together with these.</div>
      <label className="btn-secondary cursor-pointer">
        Add screenshots
        <input type="file" accept="image/*" multiple className="sr-only" aria-label="Add the missing screenshots" onChange={onAdd} />
      </label>
    </div>
  );
}

interface Opt {
  value: string;
  label: string;
}

interface EditItem {
  description: string;
  category: string;
  qty: string;
  amount: string;
  gstRate: string;
  gstAmount: string;
  /** Ticked to be added; unticked rows are left out. */
  include: boolean;
  /** Read again from an overlapping screenshot: starts unticked. */
  repeat?: boolean;
}

// The app last scanned from, so the next order defaults to it.
const APP_KEY = "ledger.lastOrderApp";
const readApp = () => {
  try {
    return window.localStorage.getItem(APP_KEY);
  } catch {
    return null;
  }
};
const writeApp = (app: string) => {
  try {
    window.localStorage.setItem(APP_KEY, app);
  } catch {
    // Storage unavailable: the choice just won't be remembered.
  }
};

type Phase = "pick" | "reading" | "review";

// The scanner runs on the owner's laptop, so it can be off.
type Service = "checking" | "up" | "down";

const SERVICE_DOWN = "The scanning service is not available right now. Please come back later.";

const numeric = (v: string) => v === "" || /^\d*\.?\d*$/.test(v);
// Charges can be negative: a discount.
const signed = (v: string) => v === "" || /^-?\d*\.?\d*$/.test(v);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** An order's bill summary as edited on the review screen. */
interface EditBill {
  charges: { label: string; amount: string }[];
  total: string;
  /** Discounts the item prices already have taken off: shown, not counted again. */
  inPrices: { label: string; amount: number }[];
}

// Identity for de-duping picks across the camera and gallery inputs.
const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="receipt preview" className="h-16 w-16 rounded-md object-cover" />
  ) : (
    <div className="h-16 w-16 rounded-md bg-ink/5" />
  );
}

export function ReceiptScanner({
  ctx,
  isPersonal,
  categories,
  payerOptions,
  splitOptions,
  defaultPayer,
  embedded = false,
  onSaved,
}: {
  ctx: string;
  isPersonal: boolean;
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
  defaultPayer: string;
  /** Inside the Add Expense overlay: always open, no card or close button of its own. */
  embedded?: boolean;
  /** Called with a confirmation after saving, instead of showing it here. */
  onSaved?: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(embedded);
  const [app, setApp] = useState<string>(OTHER_APP);
  const [phase, setPhase] = useState<Phase>("pick");
  const [files, setFiles] = useState<File[]>([]);
  // Each image's scan, kept so adding a missing screenshot reads only that one.
  const scans = useRef(new Map<string, { text: string; rows: ShotRow[] }>());
  const [stitched, setStitched] = useState<(Stitched & { complete: Completeness }) | null>(null);
  const [progress, setProgress] = useState<{ file: number; files: number } | null>(null);
  const [service, setService] = useState<Service>("checking");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [merchant, setMerchant] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(todayISO());
  // Once in the browser, default to the local day rather than the server's UTC one.
  useEffect(() => setPurchasedOn((d) => (d === todayISO() ? localISO() : d)), []);
  const [items, setItems] = useState<EditItem[]>([]);
  // Quick-commerce orders only: the charges and total under the items.
  const [bill, setBill] = useState<EditBill | null>(null);
  const [payer, setPayer] = useState(defaultPayer);
  const uid = useId();
  const [split, setSplit] = useState(SPLIT_EQUAL);

  // One attempt runs from opening the scanner to saving or leaving: a random
  // id ties its steps together for the usage metrics (counts and codes only).
  const attempt = useRef("");
  const scanSeq = useRef(0);
  // The items as first read, to count what was changed before saving.
  const initial = useRef<EditItem[]>([]);
  const kind = app !== OTHER_APP ? "order" : "receipt";
  const track = (e: { event: string; outcome?: string; n?: number; ms?: number; flagMissing?: boolean; flagMismatch?: boolean; edited?: number; removed?: number; added?: number }) => {
    if (attempt.current) void trackScanAction({ ...e, attempt: attempt.current, kind, app: app !== OTHER_APP ? app : undefined }).catch(() => {});
  };

  const checkService = useCallback(async () => {
    setService("checking");
    attempt.current ||= crypto.randomUUID();
    try {
      const res = await fetch(`/api/scan?attempt=${attempt.current}`, { cache: "no-store" });
      const body = res.ok ? ((await res.json()) as { available?: boolean }) : null;
      setService(body?.available ? "up" : "down");
    } catch {
      setService("down");
    }
  }, []);

  useEffect(() => {
    const last = readApp();
    if (last && (last === OTHER_APP || (ORDER_APPS as readonly string[]).includes(last))) setApp(last);
  }, []);

  // Ask once each time the scanner is opened, before anything is picked.
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (open) void checkService();
  }, [open, checkService, round]);

  // Which scan is current: closing or starting over mid-scan makes the one
  // still reading stop, so its results never fill a scanner it no longer owns.
  const scanNo = useRef(0);

  /** Starts over. `again`: it stays open, so the new attempt checks the scanner afresh. */
  function reset(again = true) {
    scanNo.current++;
    attempt.current = "";
    scanSeq.current = 0;
    initial.current = [];
    if (again) setRound((r) => r + 1);
    setPhase("pick");
    setFiles([]);
    scans.current.clear();
    setStitched(null);
    setItems([]);
    setBill(null);
    setProgress(null);
    setError(null);
  }

  // Append picked images (camera or gallery) to the selection, skipping
  // duplicates. Resetting the input value lets the same file be re-picked.
  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = "";
    addImages(incoming);
  }

  function addImages(incoming: File[]) {
    if (incoming.length === 0) return;
    setError(null);
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      return [...prev, ...incoming.filter((f) => !seen.has(fileKey(f)))];
    });
  }

  /** Screenshots picked after reading, to fill a gap: read with the ones already read. */
  function addMissing(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = "";
    const seen = new Set(files.map(fileKey));
    const next = [...files, ...incoming.filter((f) => !seen.has(fileKey(f)))];
    if (next.length === files.length) return;
    setFiles(next);
    void extract(next);
  }

  async function extract(list: File[] = files) {
    if (list.length === 0) return;
    const mine = ++scanNo.current;
    const stale = () => mine !== scanNo.current;
    track({ event: "images_picked", outcome: "ok", n: list.length });
    setError(null);
    setMessage(null);
    setPhase("reading");
    const texts: string[] = [];
    const shots: ShotRow[][] = [];
    const fileOf: number[] = []; // shots[k] came from list[fileOf[k]]
    const toRead = list.filter((f) => !scans.current.has(fileKey(f))).length;
    let read = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        const known = scans.current.get(fileKey(list[i]));
        if (known) {
          texts.push(known.text);
          shots.push(known.rows);
          fileOf.push(i);
          continue;
        }
        setProgress({ file: ++read, files: toRead });
        let image: File | Blob;
        try {
          image = await prepareImage(list[i]);
        } catch {
          track({ event: "images_picked", outcome: "prep-failed", n: list.length });
          throw new Error("prep");
        }
        const res = await fetch(`/api/scan?${app !== OTHER_APP ? "order=1&" : ""}attempt=${attempt.current}&n=${++scanSeq.current}`, {
          method: "POST",
          headers: { "Content-Type": image.type || "application/octet-stream" },
          body: image,
        });
        const body = (await res.json().catch(() => ({}))) as { text?: string; rows?: ShotRow[]; error?: string };
        if (stale()) return;
        if (res.ok && typeof body.text === "string") {
          const rows = body.rows ?? body.text.split("\n").map((text, k, all) => ({ text, y: k / all.length }));
          scans.current.set(fileKey(list[i]), { text: body.text, rows });
          texts.push(body.text);
          shots.push(rows);
          fileOf.push(i);
          continue;
        }
        if (body.error === "no-text") continue; // nothing readable on this one; try the rest
        setPhase("pick");
        if (body.error === "unsupported")
          setError(`Image ${i + 1} is in a format that can't be read. Use JPG, PNG or WebP.`);
        else if (body.error === "too-large") setError(`Image ${i + 1} is too large. Try a smaller photo or a screenshot.`);
        else if (body.error === "rate-limited") setError("That's a lot of scans in a short time. Wait a few minutes and try again.");
        else setService("down");
        return;
      }
    } catch (e) {
      if (stale()) return;
      // A request that never reached the server is only known here.
      if ((e as Error)?.message !== "prep") track({ event: "scan_result", outcome: "network", n: scanSeq.current });
      setPhase("pick");
      setError("Scanning failed. Check your connection and try again.");
      return;
    }
    if (stale()) return;
    const fromApp = app !== OTHER_APP;
    const whole = parseReceipt(texts.join("\n"));
    // The app is a better merchant name than whatever heads the screenshot.
    setMerchant(fromApp ? app : whole.merchant);
    if (whole.purchasedOn) setPurchasedOn(whole.purchasedOn);
    let found: number;
    let missing = false;
    let mismatch = false;
    if (fromApp) {
      // Screenshots of one long order, in any order: put back together, each
      // shared row once. The bill summary (fees, discounts, totals) is read
      // on its own and the items from the rest, so a fee or "Item Bill" is
      // never taken for a product and no tax line is counted twice.
      // File times break ties: people screenshot a long page top to bottom.
      const { stitched: joined, order, complete } = readOrderShots(shots, app, fileOf.map((i) => list[i].lastModified));
      const file = (k: number) => fileOf[k];
      setStitched({
        ...joined,
        order: joined.order.map(file),
        duplicates: joined.duplicates.map(file),
        duplicateOf: joined.duplicateOf.map(file),
        joins: joined.joins.map((j) => ({ ...j, from: file(j.from), to: file(j.to) })),
        complete,
      });
      setBill({
        charges: order.bill.charges.map((c) => ({ label: c.label, amount: c.amount.toFixed(2) })),
        total: order.bill.orderTotal != null ? order.bill.orderTotal.toFixed(2) : "",
        inPrices: order.bill.inPrices ?? [],
      });
      const built: EditItem[] = order.items.map((it) => ({
        description: it.description,
        category: it.category,
        qty: it.qty != null ? String(it.qty) : "",
        amount: it.amount.toFixed(2),
        gstRate: "",
        gstAmount: "",
        include: !it.repeat,
        repeat: it.repeat,
      }));
      setItems(built);
      initial.current = built;
      found = order.items.length;
      missing = complete.missing;
      mismatch =
        settleOrder(
          order.items.filter((it) => !it.repeat).map((it) => it.amount),
          order.bill.charges.map((c) => c.amount),
          order.bill.orderTotal,
        ).check.status !== "matched";
    } else {
      setBill(null);
      setStitched(null);
      const { repeats } = readReceiptShots(texts);
      const built: EditItem[] = whole.items.map((it, n) => ({
        description: it.description,
        category: it.category,
        qty: it.qty != null ? String(it.qty) : "",
        amount: it.amount.toFixed(2),
        gstRate: it.gstRate != null ? String(it.gstRate) : "",
        gstAmount: it.gstAmount != null ? it.gstAmount.toFixed(2) : "",
        include: !repeats[n],
        repeat: repeats[n],
      }));
      setItems(built);
      initial.current = built;
      found = whole.items.length;
    }
    track({ event: "read_result", outcome: found === 0 ? "zero-items" : "ok", n: found, flagMissing: missing, flagMismatch: mismatch });
    setPhase("review");
    if (found === 0)
      setError("Couldn't read any line items. Add them manually below, or try a clearer photo.");
  }

  function patch(i: number, p: Partial<EditItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  }
  function addRow() {
    setItems((prev) => [
      ...prev,
      { description: "", category: categories[0] ?? "Other", qty: "", amount: "", gstRate: "", gstAmount: "", include: true },
    ]);
  }

  // The order is every item on it, ticked or not (unticking one is "don't
  // add this", not "it wasn't bought"); a row read twice from overlapping
  // screenshots is not part of it unless ticked again.
  const inOrder = items.filter((it) => !(it.repeat && !it.include));
  const prices = inOrder.map((it) => parseFloat(it.amount) || 0);
  const settled = bill
    ? settleOrder(
        prices,
        bill.charges.map((c) => parseFloat(c.amount) || 0),
        bill.total.trim() === "" ? null : parseFloat(bill.total),
      )
    : null;
  const check = settled?.check ?? null;
  // Once items + charges = the order total, the charges (or whatever the
  // total says beyond the items) are shared over the items by price.
  const shares = new Map<EditItem, number>();
  settled?.shares?.forEach((share, k) => shares.set(inOrder[k], share));
  const finalAmount = (it: EditItem) => round2((parseFloat(it.amount) || 0) + (shares.get(it) ?? 0));
  const orderBlocked = check !== null && check.status !== "matched";

  const chosen = items.filter((it) => it.include);
  const total = chosen.reduce((s, it) => s + finalAmount(it), 0);
  const allChosen = items.length > 0 && chosen.length === items.length;

  function patchCharge(i: number, p: Partial<EditBill["charges"][number]>) {
    setBill((b) => (b ? { ...b, charges: b.charges.map((c, k) => (k === i ? { ...c, ...p } : c)) } : b));
  }

  function save() {
    setError(null);
    if (orderBlocked) {
      setError("The items and charges don't add up to the order total yet. Fix them in the bill summary first.");
      return;
    }
    const payloadItems = chosen.map((it) => ({
      description: it.description.trim(),
      category: it.category.trim(),
      amount: finalAmount(it),
      gstRate: it.gstRate.trim() === "" ? null : parseFloat(it.gstRate),
      gstAmount: it.gstAmount.trim() === "" ? null : parseFloat(it.gstAmount),
    }));
    if (payloadItems.length === 0) {
      setError("Tick at least one item to add.");
      return;
    }
    for (const it of payloadItems) {
      if (!it.description) {
        setError("Every line item needs a description.");
        return;
      }
      if (!(it.amount > 0)) {
        setError(`Enter a valid amount for "${it.description || "item"}".`);
        return;
      }
    }
    // What was changed from the first read: counts only, never the text.
    const first = initial.current;
    const changed = (i: number) => {
      const a = first[i];
      const b = items[i];
      return a && b && (a.description !== b.description || a.amount !== b.amount || a.category !== b.category || a.qty !== b.qty);
    };
    track({
      event: "review_changes",
      edited: first.filter((a, i) => items[i]?.include && changed(i)).length,
      removed: first.filter((a, i) => a.include && !items[i]?.include).length,
      added: Math.max(0, items.length - first.length),
    });
    startTransition(async () => {
      const res = await addReceiptAction({
        attempt: attempt.current || undefined,
        ctx,
        merchant: merchant.trim() || "Receipt",
        purchasedOn,
        payer,
        split,
        items: payloadItems,
      });
      if (res.ok) {
        const done = `Added ${res.count} item${res.count === 1 ? "" : "s"} from ${merchant.trim() || "the receipt"}.`;
        reset(false);
        router.refresh();
        if (onSaved) onSaved(done);
        else {
          setMessage(done);
          setOpen(false);
        }
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  if (!open) {
    return (
      <div className="space-y-2">
        {message ? <div className="alert-success">{message}</div> : null}
        <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)}>
          <CameraIcon className="h-4 w-4" /> Scan a receipt to add itemized expenses
        </button>
      </div>
    );
  }

  return (
    <div className={embedded ? "space-y-4" : "card space-y-4"}>
      {embedded ? null : (
        <div className="flex items-center justify-between">
          <h2 className="section-title flex items-center gap-2">
            <CameraIcon /> Scan a receipt
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={() => {
              reset(false);
              setOpen(false);
            }}
          >
            <XIcon />
          </button>
        </div>
      )}
      <p className="text-xs text-muted">
        {embedded
          ? "Add one or more screenshots of the same order. They are sent encrypted to the Ledger scanner, read, and not stored. Then tick the items to add: each becomes an expense, grouped under this order."
          : "The image is sent encrypted to the Ledger scanner, read, and not stored. Review everything before saving; line items are added as individual expenses grouped under this receipt."}
      </p>

      {error ? <div className="alert-error">{error}</div> : null}

      {phase === "pick" && service === "checking" ? (
        <div className="text-sm text-muted">Checking the scanning service…</div>
      ) : null}

      {phase === "pick" && service === "down" ? (
        <div className="space-y-3">
          <div className="alert-error">{SERVICE_DOWN}</div>
          <button type="button" className="btn-secondary w-full" onClick={() => void checkService()}>
            Try again
          </button>
        </div>
      ) : null}

      {phase === "pick" && service === "up" ? (
        <div className="space-y-3">
          <div>
            <label htmlFor={`${uid}-app`} className="label">Ordered from</label>
            <select
              id={`${uid}-app`}
              className="select"
              value={app}
              onChange={(e) => {
                setApp(e.target.value);
                writeApp(e.target.value);
              }}
            >
              {ORDER_APPS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
              <option value={OTHER_APP}>Another shop or receipt</option>
            </select>
          </div>
          {/* No `capture`: the gallery or file picker, or drag images in. */}
          <FileDropzone
            label={embedded ? "Choose order screenshots" : "Choose receipt images"}
            accept="image/*"
            multiple
            action="to add receipt images"
            hint={embedded ? "JPG, PNG or WebP. A long order can be several screenshots, in any order." : "JPG, PNG or WebP. Several at once."}
            onFiles={addImages}
            onReject={(fs) => setError(`${fs.length === 1 ? `${fs[0].name} is` : `${fs.length} files are`} not an image.`)}
          />
          <div className="flex sm:hidden">
            {/* `capture` opens the camera on phones. Desktops ignore it, and the
                picker above already covers them. */}
            <label className="btn-secondary flex-1 cursor-pointer text-center">
              <CameraIcon className="h-4 w-4" /> Take photo
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                className="sr-only"
                aria-label="Take a receipt photo with the camera"
                onChange={addFiles}
              />
            </label>
          </div>
          {files.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={`${fileKey(f)}-${i}`} className="relative">
                  <Thumb file={f} />
                  <button
                    type="button"
                    aria-label={`Remove image ${i + 1}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="btn-primary w-full"
            disabled={files.length === 0}
            onClick={() => void extract()}
          >
            Extract details from {files.length || "…"} image{files.length === 1 ? "" : "s"}
          </button>
        </div>
      ) : null}

      {phase === "reading" ? (
        <div className="space-y-2">
          <div className="text-sm">
            Reading image {progress?.file ?? 1} of {progress?.files ?? files.length}…
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink/10">
            <div
              // scaleX, not width: the bar moves on the GPU with no relayout.
              className="h-full w-full origin-left bg-primary transition-transform duration-200 ease-linear"
              style={{ transform: `scaleX(${progress ? (progress.file - 1) / progress.files : 0})` }}
            />
          </div>
          <div className="text-xs text-muted">Each image takes about 10 to 30 seconds.</div>
        </div>
      ) : null}

      {phase === "review" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-merchant`} className="label">Merchant</label>
              <input id={`${uid}-merchant`} className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
            </div>
            <div>
              <label htmlFor={`${uid}-date`} className="label">Date</label>
              <input id={`${uid}-date`}
                type="date"
                className="input"
                value={purchasedOn}
                onChange={(e) => setPurchasedOn(e.target.value)}
              />
            </div>
          </div>

          {stitched && files.length > 1 ? (
            <div className="text-sm text-muted" data-stitched>
              Read {stitched.order.length} screenshots as one order, top to bottom:{" "}
              {stitched.order.map((i) => i + 1).join(", ")}. Rows shared between them are counted once.
              {stitched.duplicates.length > 0
                ? ` Screenshot ${stitched.duplicates.map((i) => i + 1).join(", ")} repeats another one and was left out.`
                : ""}
            </div>
          ) : null}

          {stitched?.complete.missing ? <MissingParts stitched={stitched} onAdd={addMissing} /> : null}
          {stitched && !stitched.complete.missing && !stitched.complete.checked && stitched.joins.some((j) => j.how === "none") ? (
            // Nothing on the order to check the items against, and two
            // screenshots that share no row: they may or may not meet.
            <div className="text-sm text-muted" data-unsure>
              Check nothing is missing between screenshot{" "}
              {stitched.joins
                .filter((j) => j.how === "none")
                .map((j) => `${j.from + 1} and ${j.to + 1}`)
                .join(", ")}
              : they share no rows, and this order shows no item count or item total to check against.
            </div>
          ) : null}

          {!isPersonal ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-who-paid`} className="label">Who paid?</label>
                <select id={`${uid}-who-paid`} className="select" value={payer} onChange={(e) => setPayer(e.target.value)}>
                  {payerOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-split`} className="label">Split</label>
                <select id={`${uid}-split`} className="select" value={split} onChange={(e) => setSplit(e.target.value)}>
                  {/* Unequal amounts are per expense; a whole receipt splits one way. */}
                  {splitOptions.filter((o) => o.value !== SPLIT_CUSTOM).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {bill ? (
            // Orders: one line per item (tick, name, category, price) from a
            // tablet up; on a phone the category drops under the name so the
            // price keeps its room.
            <div className="divide-y divide-ink/10 border-y border-ink/10">
              <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_7rem] items-center gap-x-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted sm:grid-cols-[1.5rem_minmax(0,1fr)_11rem_8.5rem]">
                <input
                  type="checkbox"
                  aria-label={allChosen ? "Leave out every item" : "Add every item"}
                  checked={allChosen}
                  onChange={(e) => setItems((prev) => prev.map((it) => ({ ...it, include: e.target.checked })))}
                />
                <span>Item</span>
                <span className="hidden sm:block">Category</span>
                <span className="text-right">Price ₹</span>
              </div>
              {items.map((it, i) => (
                <div
                  key={i}
                  className={`grid grid-cols-[1.5rem_minmax(0,1fr)_7rem] items-center gap-x-3 gap-y-1.5 py-2.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_11rem_8.5rem] ${
                    it.include ? "" : "opacity-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="col-start-1 row-start-1"
                    aria-label={`Add ${it.description || `item ${i + 1}`}`}
                    checked={it.include}
                    onChange={(e) => patch(i, { include: e.target.checked })}
                  />
                  <input
                    className="input col-start-2 row-start-1"
                    aria-label={`Item ${i + 1} name`}
                    value={it.description}
                    placeholder="Item"
                    onChange={(e) => patch(i, { description: e.target.value })}
                  />
                  <div className="col-start-2 row-start-2 sm:col-start-3 sm:row-start-1">
                    <CategorySelect categories={categories} value={it.category} onChange={(c) => patch(i, { category: c })} />
                  </div>
                  <div className="col-start-3 row-start-1 sm:col-start-4">
                    <input
                      className="input text-right tabular-nums"
                      aria-label={`${it.description || `Item ${i + 1}`} price`}
                      inputMode="decimal"
                      value={it.amount}
                      placeholder="0.00"
                      onChange={(e) => numeric(e.target.value) && patch(i, { amount: e.target.value })}
                    />
                  </div>
                  {shares.has(it) && shares.get(it) !== 0 ? (
                    <div className="col-start-3 row-start-2 text-right text-xs text-muted sm:col-start-4">
                      <span className="font-semibold text-ink">{formatINR(finalAmount(it))}</span> with charges
                    </div>
                  ) : null}
                  {it.repeat ? (
                    <div className="col-span-2 col-start-2 row-start-3 text-xs text-muted sm:row-start-2">
                      Also in an earlier screenshot, so left out. Tick it if you bought it twice.
                    </div>
                  ) : null}
                </div>
              ))}
              {items.length === 0 ? <div className="py-3 text-center text-sm text-muted">No items yet. Add them manually.</div> : null}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[640px]">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label={allChosen ? "Leave out every item" : "Add every item"}
                      checked={allChosen}
                      onChange={(e) => setItems((prev) => prev.map((it) => ({ ...it, include: e.target.checked })))}
                    />
                  </th>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="text-right">GST %</th>
                  <th className="text-right">GST ₹</th>
                  <th className="text-right">Amount ₹</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className={it.include ? undefined : "opacity-50"}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Add ${it.description || `item ${i + 1}`}`}
                        checked={it.include}
                        onChange={(e) => patch(i, { include: e.target.checked })}
                      />
                    </td>
                    <td className="min-w-[10rem]">
                      <input
                        className="input"
                        value={it.description}
                        placeholder="Item"
                        onChange={(e) => patch(i, { description: e.target.value })}
                      />
                      {it.repeat ? (
                        <div className="mt-1 text-xs text-muted">Also in an earlier screenshot, so left out. Tick it if you bought it twice.</div>
                      ) : null}
                    </td>
                    <td className="min-w-[9rem]">
                      <CategorySelect
                        categories={categories}
                        value={it.category}
                        onChange={(c) => patch(i, { category: c })}
                      />
                    </td>
                    <td className="w-20">
                      <input
                        className="input text-right"
                        inputMode="decimal"
                        value={it.gstRate}
                        placeholder="—"
                        onChange={(e) => numeric(e.target.value) && patch(i, { gstRate: e.target.value })}
                      />
                    </td>
                    <td className="w-24">
                      <input
                        className="input text-right"
                        inputMode="decimal"
                        value={it.gstAmount}
                        placeholder="—"
                        onChange={(e) => numeric(e.target.value) && patch(i, { gstAmount: e.target.value })}
                      />
                    </td>
                    <td className="w-28">
                      <input
                        className="input text-right"
                        inputMode="decimal"
                        value={it.amount}
                        placeholder="0.00"
                        onChange={(e) => numeric(e.target.value) && patch(i, { amount: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted">
                      No items yet. Add them manually.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          )}

          <div className="flex items-center justify-between">
            <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={addRow}>
              + Add item
            </button>
            <div className="text-sm">
              <span className="text-muted">{chosen.length} of {items.length} ticked: </span>
              <strong>{formatINR(total)}</strong>
            </div>
          </div>

          {bill && check ? (
            <div className="space-y-3 rounded-lg border border-ink/10 p-3">
              <div>
                <div className="text-sm font-semibold">Bill summary</div>
                <p className="text-xs text-muted">Charges on top of the items, as on the bill. A discount is a negative amount.</p>
              </div>
              {bill.charges.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="input min-w-0 flex-1"
                    aria-label={`Charge ${i + 1} name`}
                    value={c.label}
                    placeholder="Charge"
                    onChange={(e) => patchCharge(i, { label: e.target.value })}
                  />
                  <input
                    className="input w-28 text-right"
                    aria-label={`${c.label || `Charge ${i + 1}`} amount`}
                    inputMode="decimal"
                    value={c.amount}
                    placeholder="0.00"
                    onChange={(e) => signed(e.target.value) && patchCharge(i, { amount: e.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${c.label || "charge"}`}
                    onClick={() => setBill((b) => (b ? { ...b, charges: b.charges.filter((_, k) => k !== i) } : b))}
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-sm"
                onClick={() => setBill((b) => (b ? { ...b, charges: [...b.charges, { label: "", amount: "" }] } : b))}
              >
                + Add charge or discount
              </button>
              {bill.inPrices.map((c) => (
                <div key={c.label} className="text-xs text-muted" data-in-prices>
                  {c.label} {formatINR(c.amount)}: already taken off the item prices, so not counted again.
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={`${uid}-order-total`} className="text-sm font-semibold">Order total (paid)</label>
                <input
                  id={`${uid}-order-total`}
                  className="input w-32 text-right"
                  inputMode="decimal"
                  value={bill.total}
                  placeholder="0.00"
                  onChange={(e) => numeric(e.target.value) && setBill((b) => (b ? { ...b, total: e.target.value } : b))}
                />
              </div>
              {/* The sum itself stays out of sight: only whether it matches, and what to fix if not. */}
              {check.status === "matched" ? (
                <div role="status" className="text-sm text-positive">Matches the order total.</div>
              ) : (
                <div role="status" className={check.status === "mismatch" ? "alert-error" : "alert-warning"}>
                  {check.status === "mismatch"
                    ? `Doesn't match the order total: ${formatINR(Math.abs(check.diff))} ${
                        check.diff > 0 ? "is missing. An item or charge may not have been read." : "too much. An item or charge may be read twice."
                      }`
                    : "Enter the order total from the bill."}
                </div>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={pending || chosen.length === 0 || orderBlocked} onClick={save}>
              {pending ? "Saving…" : `Add ${chosen.length} expense${chosen.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => reset()}>
              Rescan
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
