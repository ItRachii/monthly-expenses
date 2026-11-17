"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { XIcon } from "@/components/Icons";
import { Modal } from "@/components/Modal";
import { updateReceiptAction } from "@/lib/actions/receipts";

/**
 * Renames a scanned receipt and sets one date for it and all its items. The
 * items stay editable one by one (their amounts, categories, who paid); this
 * is for what belongs to the whole purchase.
 */
export function EditReceiptModal({
  receiptId,
  merchant: initialMerchant,
  date: initialDate,
  itemCount,
  onClose,
  onSaved,
}: {
  receiptId: string;
  merchant: string;
  /** The receipt row's date (its latest item's); ISO. */
  date: string;
  /** How many items the receipt has in all, whether or not a filter hides some. */
  itemCount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const uid = useId();
  const [merchant, setMerchant] = useState(initialMerchant);
  const [date, setDate] = useState(initialDate);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const first = useRef<HTMLInputElement>(null);

  // Start on the shop name, selected, so typing replaces it.
  useEffect(() => {
    first.current?.focus();
    first.current?.select();
  }, []);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!merchant.trim()) {
      setError("Please enter the shop name.");
      return;
    }
    if (!date) {
      setError("Please pick a date.");
      return;
    }
    startTransition(async () => {
      const res = await updateReceiptAction(receiptId, { merchant, date }).catch(() => null);
      if (res?.ok) {
        onSaved();
        onClose();
      } else {
        setError(res?.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <Modal labelledBy={`${uid}-title`} onClose={onClose}>
      <form onSubmit={save} className="modal-pop card w-full space-y-4">
        <div className="flex items-center justify-between">
          <h3 id={`${uid}-title`} className="section-title">
            Edit receipt
          </h3>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div>
          <label htmlFor={`${uid}-merchant`} className="label">
            Shop
          </label>
          <input id={`${uid}-merchant`} ref={first} className="input" maxLength={80} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-date`} className="label">
            Date
          </label>
          <input id={`${uid}-date`} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <p className="mt-1 text-xs text-muted">
            Sets the date of all {itemCount} item{itemCount === 1 ? "" : "s"}. Edit an item to change its amount, category or who paid.
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
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
