"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addExpenseAction } from "@/lib/actions/expenses";
import { SPLIT_EQUAL } from "@/lib/constants";
import { todayISO } from "@/lib/format";

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
}: {
  ctx: string;
  isPersonal: boolean;
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
  defaultPayer: string;
  defaultSplit: string;
  memberCount: number;
}) {
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState(categories[0]);
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  // Initial state equals the default option's value so the submitted value
  // always matches what is shown — no silent divergence.
  const [payer, setPayer] = useState(defaultPayer);
  const [split, setSplit] = useState(defaultSplit);
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
    if (isNaN(amt) || amt <= 0) {
      setMessage({ ok: false, text: "Amount must be greater than zero." });
      return;
    }

    startTransition(async () => {
      // For personal/solo the server forces payer=user email & split="equal";
      // for groups we send the selected values (validated server-side).
      const res = await addExpenseAction({
        ctx,
        date,
        category,
        item,
        amount: amt,
        payer,
        split,
      });
      if (res.ok) {
        let info: string | undefined;
        if (!isPersonal && split === SPLIT_EQUAL && memberCount > 0) {
          info = `Each of the ${memberCount} members owes ₹${(amt / memberCount).toFixed(2)}`;
        }
        setMessage({
          ok: true,
          text: `Expense saved: ${item.trim()} — ₹${amt.toFixed(2)}`,
          info,
        });
        setItem("");
        setAmount("");
        router.refresh();
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
      <select
        className="select"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
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
    <form onSubmit={submit} className="card space-y-4">
      {isPersonal ? (
        // Personal: flat 2x2 grid — Date, Category, Item, Amount.
        <div className="grid gap-4 sm:grid-cols-2">
          {dateField}
          {categoryField}
          {itemField}
          {amountField}
        </div>
      ) : (
        // Group: details on the left, amount + payer/split on the right.
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-4">
            {dateField}
            {categoryField}
            {itemField}
          </div>

          <div className="space-y-4">
            {amountField}
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
        </div>
      )}

      {message ? (
        <div className={message.ok ? "alert-success" : "alert-error"}>
          <div>{message.text}</div>
          {message.info ? <div className="mt-1">{message.info}</div> : null}
        </div>
      ) : null}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Add Expense"}
      </button>
    </form>
  );
}
