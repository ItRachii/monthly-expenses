"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeOnboardingAction } from "@/lib/actions/income";
import { isMoneyInput } from "@/components/IncomePrompt";

export function WelcomeForm({ firstName, lastName }: { firstName: string; lastName: string }) {
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [income, setIncome] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!first.trim()) return setError("Please enter a first name.");
    if (!income.trim()) return setError("Please enter your monthly income.");
    startTransition(async () => {
      const res = await completeOnboardingAction(first, last, income);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-md space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Welcome to Ledger</h1>
        <p className="mt-1 text-sm text-muted">
          Two quick details and you are set. Your income lets the app show what you save each
          month after personal spending and your share in groups.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="welcome-first">
            First name
          </label>
          <input
            id="welcome-first"
            className="input"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            maxLength={40}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="welcome-last">
            Last name
          </label>
          <input
            id="welcome-last"
            className="input"
            value={last}
            onChange={(e) => setLast(e.target.value)}
            maxLength={40}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="welcome-income">
          Monthly income (₹)
        </label>
        <input
          id="welcome-income"
          className="input"
          type="text"
          inputMode="decimal"
          placeholder="e.g. 50000"
          value={income}
          onChange={(e) => {
            if (isMoneyInput(e.target.value)) setIncome(e.target.value);
            setError(null);
          }}
          required
          autoFocus
        />
        <p className="mt-1 text-xs text-muted">
          Your fixed take-home pay. Enter 0 if you have none. You can change it later on your
          profile.
        </p>
      </div>

      {error ? <div className="alert-error">{error}</div> : null}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
