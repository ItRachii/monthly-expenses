"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addExpenseAction } from "@/lib/actions/expenses";
import { enqueueExpense } from "@/lib/offlineQueue";
import { SPLIT_CUSTOM, SPLIT_EQUAL } from "@/lib/constants";
import { formatINR, todayISO } from "@/lib/format";
import { CategorySelect } from "@/components/CategorySelect";
import {
  SplitShares,
  sharesError,
  sharesFromInputs,
  type ShareInputs,
} from "@/components/SplitShares";

interface Opt {
  value: string;
  label: string;
}

export function AddExpenseForm({
  ctx,
  isPersonal,
  categories,
  payerOptions,
  splitOptions,
  defaultPayer,
  defaultSplit,
  memberCount,
  offlineOwner,
  bare = false,
  onSaved,
}: {
  ctx: string;
  isPersonal: boolean;
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
  defaultPayer: string;
  defaultSplit: string;
  memberCount: number;
  /** Opaque per-user tag scoping the offline queue (no PII). */
  offlineOwner: string;
  /** Render without the card chrome (inside the add-expense overlay). */
  bare?: boolean;
  /** Called after a successful save; the overlay closes and shows a toast. */
  onSaved?: (saved: { item: string; amount: number; offline: boolean }) => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState(categories[0]);
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  // Initial state equals the default option's value so the submitted value
  // always matches what is shown — no silent divergence.
  const [payer, setPayer] = useState(defaultPayer);
  const [split, setSplit] = useState(defaultSplit);
  const [shareInputs, setShareInputs] = useState<ShareInputs>({});
  const custom = !isPersonal && split === SPLIT_CUSTOM;
  const [message, setMessage] = useState<
    { ok: boolean; text: string; info?: string } | null
  >(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!item.trim()) {
      setMessage({ ok: false, text: "Please enter an item description." });
      return;
    }
    if (!category.trim()) {
      setMessage({ ok: false, text: "Please enter a category name." });
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      setMessage({ ok: false, text: "Amount must be greater than zero." });
      return;
    }

    if (custom) {
      const err = sharesError(shareInputs, payerOptions, amt);
      if (err) {
        setMessage({ ok: false, text: err });
        return;
      }
    }

    const input = {
      ctx,
      date,
      category,
      item: item.trim(),
      amount: amt,
      payer,
      split,
      ...(custom ? { shares: sharesFromInputs(shareInputs, payerOptions) } : {}),
    };

    // No connection: skip the doomed request and park the expense locally.
    // OfflineSync replays it through the same server action on reconnect.
    function saveOffline() {
      if (enqueueExpense(offlineOwner, input)) {
        if (onSaved) {
          onSaved({ item: input.item, amount: amt, offline: true });
          return;
        }
        setMessage({
          ok: true,
          text: `Saved offline: ${input.item}, ${formatINR(amt)}`,
          info: "You're offline. This expense is stored on this device and will sync automatically when you're back online.",
        });
        setItem("");
        setAmount("");
        setShareInputs({});
      } else {
        setMessage({
          ok: false,
          text: "You're offline and local storage is unavailable, so this expense could not be saved.",
        });
      }
    }

    startTransition(async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        saveOffline();
        return;
      }
      // For personal/solo the server forces payer=user email & split="equal";
      // for groups we send the selected values (validated server-side).
      let res: { ok: boolean; error?: string };
      try {
        res = await addExpenseAction(input);
      } catch {
        // The action never throws for validation — only transport failures
        // (connection dropped mid-flight) land here.
        saveOffline();
        return;
      }
      if (res.ok) {
        // Soft refresh: re-renders the server data behind the form in place,
        // no page reload, so the new expense shows up immediately.
        router.refresh();
        if (onSaved) {
          onSaved({ item: input.item, amount: amt, offline: false });
          return;
        }
        let info: string | undefined;
        if (!isPersonal && split === SPLIT_EQUAL && memberCount > 0) {
          info = `Each of the ${memberCount} members owes ${formatINR(amt / memberCount)}`;
        }
        setMessage({
          ok: true,
          text: `Expense saved: ${input.item}, ${formatINR(amt)}`,
          info,
        });
        setItem("");
        setAmount("");
        setShareInputs({});
      } else {
        setMessage({ ok: false, text: res.error ?? "Something went wrong." });
      }
    });
  }

  const dateField = (
    <div>
      <label className="label">Date</label>
      <input
        type="date"
        className="input"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
    </div>
  );

  const categoryField = (
    <div>
      <label className="label">Category</label>
      <CategorySelect categories={categories} value={category} onChange={setCategory} />
    </div>
  );

  const itemField = (
    <div>
      <label className="label">Item / Description</label>
      <input
        className="input"
        value={item}
        onChange={(e) => setItem(e.target.value)}
        placeholder="e.g. Weekly groceries"
      />
    </div>
  );

  const amountField = (
    <div>
      <label className="label">Amount (₹)</label>
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="next"
        // In the add-expense sheet the amount is what you came to type.
        autoFocus={bare}
        className="input"
        value={amount}
        onChange={(e) => {
          const v = e.target.value;
          // Allow only digits and a single decimal point — no arrow-key/wheel stepping.
          if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
        }}
        placeholder="0.00"
      />
    </div>
  );

  return (
    <form onSubmit={submit} className={bare ? "space-y-4" : "card space-y-4"}>
      {isPersonal ? (
        // Personal: amount first, since it is the one field always typed;
        // the date already defaults to today.
        <div className="grid gap-4 sm:grid-cols-2">
          {amountField}
          {itemField}
          {categoryField}
          {dateField}
        </div>
      ) : (
        // Group: what it was on the left (amount first), who paid and how
        // it splits on the right.
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-4">
            {amountField}
            {itemField}
            {categoryField}
          </div>

          <div className="space-y-4">
            {dateField}
            <div>
              <label className="label">Who paid?</label>
              <select
                className="select"
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
              >
                {payerOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Split</label>
              <select
                className="select"
                value={split}
                onChange={(e) => setSplit(e.target.value)}
              >
                {splitOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {custom ? (
            <div className="sm:col-span-2">
              <label className="label">How much does each person owe?</label>
              <SplitShares
                members={payerOptions}
                amount={parseFloat(amount)}
                values={shareInputs}
                onChange={(v) => {
                  setShareInputs(v);
                  setMessage(null);
                }}
              />
            </div>
          ) : null}
        </div>
      )}

      {message ? (
        <div className={message.ok ? "alert-success" : "alert-error"}>
          <div>{message.text}</div>
          {message.info ? <div className="mt-1">{message.info}</div> : null}
        </div>
      ) : null}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Add expense"}
      </button>
    </form>
  );
}
