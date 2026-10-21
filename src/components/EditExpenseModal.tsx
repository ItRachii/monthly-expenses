"use client";

import { XIcon } from "@/components/Icons";
import { useId, useMemo, useState, useTransition } from "react";
import type { ExpenseDTO } from "@/lib/expenses";
import { PAYER_MULTIPLE, SPLIT_CUSTOM, SPLIT_EQUAL } from "@/lib/constants";
import { updateExpenseAction } from "@/lib/actions/expenses";
import { CategorySelect } from "@/components/CategorySelect";
import {
  SplitShares,
  sharesError,
  sharesFromInputs,
  sharesToInputs,
  type ShareInputs,
} from "@/components/SplitShares";

interface Opt {
  value: string;
  label: string;
}

export function EditExpenseModal({
  expense,
  categories,
  payerOptions,
  splitOptions,
  nameMap,
  isPersonal,
  onClose,
  onSaved,
}: {
  expense: ExpenseDTO;
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
  nameMap: Record<string, string>;
  isPersonal: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(expense.date);
  const [category, setCategory] = useState(expense.category);
  const [item, setItem] = useState(expense.item);
  const [amount, setAmount] = useState(String(expense.amount));
  const [payer, setPayer] = useState(expense.payer);
  const [split, setSplit] = useState(expense.split);
  const [shareInputs, setShareInputs] = useState<ShareInputs>(() => sharesToInputs(expense.shares));
  const [payerInputs, setPayerInputs] = useState<ShareInputs>(() => sharesToInputs(expense.payers));
  const custom = !isPersonal && split === SPLIT_CUSTOM;
  const multi = !isPersonal && payer === PAYER_MULTIPLE;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const uid = useId();

  // Legacy rows can hold a payer/split for someone no longer in the group.
  // Surface that original value as an option so the row displays honestly and
  // round-trips unchanged when the user only edits other fields. (CategorySelect
  // handles the same concern for out-of-list categories.)
  const effPayerOptions = useMemo(() => {
    const opts =
      payerOptions.length > 1 ? [...payerOptions, { value: PAYER_MULTIPLE, label: "Multiple people" }] : payerOptions;
    return opts.some((o) => o.value === expense.payer)
      ? opts
      : [{ value: expense.payer, label: nameMap[expense.payer] ?? expense.payer }, ...opts];
  }, [payerOptions, expense.payer, nameMap]);
  const effSplitOptions = useMemo(
    () =>
      expense.split === SPLIT_EQUAL || splitOptions.some((o) => o.value === expense.split)
        ? splitOptions
        : [{ value: expense.split, label: nameMap[expense.split] ?? expense.split }, ...splitOptions],
    [splitOptions, expense.split, nameMap],
  );

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
    if (multi) {
      const err = sharesError(payerInputs, payerOptions, amt, "paid");
      if (err) {
        setError(err);
        return;
      }
    }
    if (custom) {
      const err = sharesError(shareInputs, payerOptions, amt);
      if (err) {
        setError(err);
        return;
      }
    }
    startTransition(async () => {
      const res = await updateExpenseAction(expense.id, {
        date,
        category,
        item,
        amount: amt,
        payer,
        split,
        ...(multi ? { payers: sharesFromInputs(payerInputs, payerOptions) } : {}),
        ...(custom ? { shares: sharesFromInputs(shareInputs, payerOptions) } : {}),
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div
      className="sheet-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="modal-pop card max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto overscroll-contain"
      >
        <div className="flex items-center justify-between">
          <h3 className="section-title">Edit Expense</h3>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn"
            aria-label="Close"
          >
            <XIcon />
          </button>
        </div>

        <div>
          <label htmlFor={`${uid}-date`} className="label">Date</label>
          <input id={`${uid}-date`}
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${uid}-category`} className="label">Category</label>
          <CategorySelect id={`${uid}-category`} categories={categories} value={category} onChange={setCategory} />
        </div>
        <div>
          <label htmlFor={`${uid}-item-description`} className="label">Item / Description</label>
          <input id={`${uid}-item-description`} className="input" value={item} onChange={(e) => setItem(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-amount`} className="label">Amount (₹)</label>
          <input id={`${uid}-amount`}
            type="text"
            inputMode="decimal"
            className="input"
            value={amount}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
            }}
          />
        </div>
        {!isPersonal ? (
          <>
            <div>
              <label htmlFor={`${uid}-payer`} className="label">Payer</label>
              <select id={`${uid}-payer`}
                className="select"
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
              >
                {effPayerOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {multi ? (
              <div>
                <p className="label">How much did each person pay?</p>
                <SplitShares
                  idPrefix="paid"
                  members={payerOptions}
                  amount={parseFloat(amount)}
                  values={payerInputs}
                  onChange={(v) => {
                    setPayerInputs(v);
                    setError(null);
                  }}
                />
              </div>
            ) : null}
            <div>
              <label htmlFor={`${uid}-split`} className="label">Split</label>
              <select id={`${uid}-split`}
                className="select"
                value={split}
                onChange={(e) => setSplit(e.target.value)}
              >
                {effSplitOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {custom ? (
              <SplitShares
                members={payerOptions}
                amount={parseFloat(amount)}
                values={shareInputs}
                onChange={(v) => {
                  setShareInputs(v);
                  setError(null);
                }}
              />
            ) : null}
          </>
        ) : null}

        {error ? <div className="alert-error">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
