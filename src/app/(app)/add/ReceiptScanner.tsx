"use client";

import { CameraIcon, XIcon } from "@/components/Icons";
import { FileDropzone } from "@/components/FileDropzone";
import { useCallback, useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepareImage } from "@/lib/scanner/prepareImage";
import { parseReceipt } from "@/lib/receipt/parse";
import { categorize } from "@/lib/receipt/categorize";
import { ORDER_APPS, OTHER_APP, cleanOrderItem, repeatedRows } from "@/lib/receipt/quickCommerce";
import { addReceiptAction } from "@/lib/actions/receipts";
import { CategorySelect } from "@/components/CategorySelect";
import { SPLIT_CUSTOM, SPLIT_EQUAL } from "@/lib/constants";
import { formatINR, todayISO } from "@/lib/format";

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
  const [progress, setProgress] = useState<{ file: number; files: number } | null>(null);
  const [service, setService] = useState<Service>("checking");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [merchant, setMerchant] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(todayISO());
  const [items, setItems] = useState<EditItem[]>([]);
  const [payer, setPayer] = useState(defaultPayer);
  const uid = useId();
  const [split, setSplit] = useState(SPLIT_EQUAL);

  const checkService = useCallback(async () => {
    setService("checking");
    try {
      const res = await fetch("/api/scan", { cache: "no-store" });
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
  useEffect(() => {
    if (open) void checkService();
  }, [open, checkService]);

  function reset() {
    setPhase("pick");
    setFiles([]);
    setItems([]);
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

  async function extract() {
    if (files.length === 0) return;
    setError(null);
    setMessage(null);
    setPhase("reading");
    const texts: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress({ file: i + 1, files: files.length });
        const image = await prepareImage(files[i]);
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": image.type || "application/octet-stream" },
          body: image,
        });
        const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (res.ok && typeof body.text === "string") {
          texts.push(body.text);
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
    } catch {
      setPhase("pick");
      setError("Scanning failed. Check your connection and try again.");
      return;
    }
    const parsed = parseReceipt(texts.join("\n"));
    const repeats = repeatedRows(
      texts.map((t) => parseReceipt(t).items.map((it) => it.description)),
      parsed.items.map((it) => it.description),
    );
    const fromApp = app !== OTHER_APP;
    // The app is a better merchant name than whatever heads the screenshot.
    setMerchant(fromApp ? app : parsed.merchant);
    if (parsed.purchasedOn) setPurchasedOn(parsed.purchasedOn);
    setItems(
      parsed.items.map((it, n) => {
        const order = fromApp ? cleanOrderItem(it.description) : null;
        const description = order?.description ?? it.description;
        const qty = order?.qty ?? it.qty;
        return {
          description,
          category: order ? categorize(description) : it.category,
          qty: qty != null ? String(qty) : "",
          amount: it.amount.toFixed(2),
          gstRate: it.gstRate != null ? String(it.gstRate) : "",
          gstAmount: it.gstAmount != null ? it.gstAmount.toFixed(2) : "",
          include: !repeats[n],
          repeat: repeats[n],
        };
      }),
    );
    setPhase("review");
    if (parsed.items.length === 0)
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

  const chosen = items.filter((it) => it.include);
  const total = chosen.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
  const allChosen = items.length > 0 && chosen.length === items.length;

  function save() {
    setError(null);
    const payloadItems = chosen.map((it) => ({
      description: it.description.trim(),
      category: it.category.trim(),
      amount: parseFloat(it.amount),
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
    startTransition(async () => {
      const res = await addReceiptAction({
        ctx,
        merchant: merchant.trim() || "Receipt",
        purchasedOn,
        payer,
        split,
        items: payloadItems,
      });
      if (res.ok) {
        const done = `Added ${res.count} item${res.count === 1 ? "" : "s"} from ${merchant.trim() || "the receipt"}.`;
        reset();
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
              reset();
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
            hint="JPG, PNG or WebP. Several at once."
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

          <div className="flex items-center justify-between">
            <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={addRow}>
              + Add item
            </button>
            <div className="text-sm">
              <span className="text-muted">{chosen.length} of {items.length} ticked: </span>
              <strong>{formatINR(total)}</strong>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={pending || chosen.length === 0} onClick={save}>
              {pending ? "Saving…" : `Add ${chosen.length} expense${chosen.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={reset}>
              Rescan
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
