"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ocrImages, type OcrProgress } from "@/lib/ocr";
import { parseReceipt } from "@/lib/receipt/parse";
import { addReceiptAction } from "@/lib/actions/receipts";
import { CategorySelect } from "@/components/CategorySelect";
import { SPLIT_EQUAL } from "@/lib/constants";
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
}

type Phase = "pick" | "reading" | "review";

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
    <div className="h-16 w-16 rounded-md bg-white/5" />
  );
}

export function ReceiptScanner({
  ctx,
  isPersonal,
  categories,
  payerOptions,
  splitOptions,
  defaultPayer,
}: {
  ctx: string;
  isPersonal: boolean;
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
  defaultPayer: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("pick");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [merchant, setMerchant] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(todayISO());
  const [items, setItems] = useState<EditItem[]>([]);
  const [payer, setPayer] = useState(defaultPayer);
  const [split, setSplit] = useState(SPLIT_EQUAL);

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
    setProgress({ file: 1, files: files.length, progress: 0 });
    try {
      const text = await ocrImages(files, setProgress);
      const parsed = parseReceipt(text);
      setMerchant(parsed.merchant);
      if (parsed.purchasedOn) setPurchasedOn(parsed.purchasedOn);
      setItems(
        parsed.items.map((it) => ({
          description: it.description,
          category: it.category,
          qty: it.qty != null ? String(it.qty) : "",
          amount: it.amount.toFixed(2),
          gstRate: it.gstRate != null ? String(it.gstRate) : "",
          gstAmount: it.gstAmount != null ? it.gstAmount.toFixed(2) : "",
        })),
      );
      setPhase("review");
      if (parsed.items.length === 0)
        setError("Couldn't read any line items — add them manually below, or try a clearer photo.");
    } catch {
      setPhase("pick");
      setError("Scanning failed. Check your connection (the OCR engine loads once) and try again.");
    }
  }

  function patch(i: number, p: Partial<EditItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  }
  function addRow() {
    setItems((prev) => [
      ...prev,
      { description: "", category: categories[0] ?? "Other", qty: "", amount: "", gstRate: "", gstAmount: "" },
    ]);
  }
  function removeRow(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  const total = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);

  function save() {
    setError(null);
    const payloadItems = items.map((it) => ({
      description: it.description.trim(),
      category: it.category.trim(),
      amount: parseFloat(it.amount),
      gstRate: it.gstRate.trim() === "" ? null : parseFloat(it.gstRate),
      gstAmount: it.gstAmount.trim() === "" ? null : parseFloat(it.gstAmount),
    }));
    if (payloadItems.length === 0) {
      setError("Add at least one line item.");
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
        setMessage(`Added ${res.count} item${res.count === 1 ? "" : "s"} from ${merchant.trim() || "the receipt"}.`);
        reset();
        setOpen(false);
        router.refresh();
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
          📷 Scan a receipt to add itemized expenses
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="section-title">📷 Scan a receipt</h2>
        <button
          type="button"
          className="text-muted hover:text-ink"
          aria-label="Close"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          ✕
        </button>
      </div>
      <p className="text-xs text-muted">
        Reads the receipt on your device — the image is never uploaded. Review
        everything before saving; line items are added as individual expenses
        grouped under this receipt.
      </p>

      {error ? <div className="alert-error">{error}</div> : null}

      {phase === "pick" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {/* No `capture` → the gallery/photo picker. */}
            <label className="btn-secondary flex-1 cursor-pointer text-center">
              🖼️ Choose from gallery
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                aria-label="Choose receipt images from gallery"
                onChange={addFiles}
              />
            </label>
            {/* `capture` → opens the camera on mobile (ignored on desktop). */}
            <label className="btn-secondary flex-1 cursor-pointer text-center">
              📷 Take photo
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
          <p className="text-xs text-muted">
            Add one or more receipt images from your gallery or camera.
          </p>
          {files.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={`${fileKey(f)}-${i}`} className="relative">
                  <Thumb file={f} />
                  <button
                    type="button"
                    aria-label={`Remove image ${i + 1}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-xs text-white"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    ✕
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
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }}
            />
          </div>
          <div className="text-xs text-muted">
            First run downloads the OCR engine (~a few MB); later scans are instant.
          </div>
        </div>
      ) : null}

      {phase === "review" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Merchant</label>
              <input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
            </div>
            <div>
              <label className="label">Date</label>
              <input
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
                <label className="label">Who paid?</label>
                <select className="select" value={payer} onChange={(e) => setPayer(e.target.value)}>
                  {payerOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Split</label>
                <select className="select" value={split} onChange={(e) => setSplit(e.target.value)}>
                  {splitOptions.map((o) => (
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
                  <th>Item</th>
                  <th>Category</th>
                  <th className="text-right">GST %</th>
                  <th className="text-right">GST ₹</th>
                  <th className="text-right">Amount ₹</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="min-w-[10rem]">
                      <input
                        className="input"
                        value={it.description}
                        placeholder="Item"
                        onChange={(e) => patch(i, { description: e.target.value })}
                      />
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
                    <td className="text-right">
                      <button
                        type="button"
                        className="text-red-400 hover:text-red-300"
                        aria-label="Remove item"
                        onClick={() => removeRow(i)}
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted">
                      No items yet — add them manually.
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
              <span className="text-muted">Receipt total: </span>
              <strong>{formatINR(total)}</strong>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={pending} onClick={save}>
              {pending ? "Saving…" : `Save ${items.length} item${items.length === 1 ? "" : "s"}`}
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
