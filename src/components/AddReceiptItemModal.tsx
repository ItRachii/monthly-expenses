"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { XIcon } from "@/components/Icons";
import { CategorySelect } from "@/components/CategorySelect";
import { addReceiptItemAction } from "@/lib/actions/receipts";

/**
 * Adds one item to a scanned receipt, for one the scan missed. It takes the
 * receipt's date and who paid and how it is split from the items already
 * there; those can be changed afterwards by editing the item.
 */
export function AddReceiptItemModal({
  receiptId,
  merchant,
  categories,
  defaultCategory,
  onClose,
  onSaved,
}: {
  receiptId: string;
  merchant: string;
  categories: string[];
  defaultCategory: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const uid = useId();
  const [item, setItem] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const first = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amt = parseFloat(amount);
    if (!item.trim()) {
      setError("Please enter an item description.");
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    startTransition(async () => {
      const res = await addReceiptItemAction(receiptId, { item, category, amount: amt }).catch(() => null);
      if (res?.ok) {
        onSaved();
        onClose();
      } else {
        setError(res?.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div className="sheet-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="modal-pop card max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto overscroll-contain"
      >
        <div className="flex items-center justify-between">
          <h3 id={`${uid}-title`} className="section-title">
            Add item to {merchant}
          </h3>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div>
          <label htmlFor={`${uid}-item`} className="label">
            Item / Description
          </label>
          <input id={`${uid}-item`} ref={first} className="input" maxLength={200} value={item} onChange={(e) => setItem(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-category`} className="label">
            Category
          </label>
          <CategorySelect id={`${uid}-category`} categories={categories} value={category} onChange={setCategory} />
        </div>
        <div>
          <label htmlFor={`${uid}-amount`} className="label">
            Amount (₹)
          </label>
          <input
            id={`${uid}-amount`}
            type="text"
            inputMode="decimal"
            className="input"
            value={amount}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
            }}
          />
          <p className="mt-1 text-xs text-muted">
            Added with the receipt's date, and the same payer and split as its other items. Edit the item afterwards to change them.
          </p>
        </div>
        {error ? (
          <div className="alert-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Adding…" : "Add item"}
          </button>
        </div>
      </form>
    </div>
  );
}
