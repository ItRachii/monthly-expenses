"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revealIncomeAction, saveProfileAction } from "@/lib/actions/profile";
import { UserAvatar } from "@/components/UserAvatar";
import { EyeIcon, EyeOffIcon, PencilIcon } from "@/components/Icons";
import { formatINR } from "@/lib/format";
import { incomeMonthOptions, type IncomeEntry } from "@/lib/incomeMath";
import { MonthSelect, monthLabel } from "@/components/MonthSelect";
import { isMoneyInput } from "@/components/IncomePrompt";

export function ProfileForm({
  email,
  firstName,
  lastName,
  hasIncome,
  currentMonth,
  image,
}: {
  email: string;
  firstName: string;
  lastName: string | null;
  /** Whether a monthly income is set. The amount itself is fetched only when revealed. */
  hasIncome: boolean;
  currentMonth: string;
  image: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName ?? "");
  const [income, setIncome] = useState("");
  const [incomeFrom, setIncomeFrom] = useState(currentMonth);
  // The income is masked until the eye button fetches it; it is masked again
  // after a save and on every visit.
  const [revealed, setRevealed] = useState<{ income: number | null; history: IncomeEntry[] } | null>(null);
  const [revealing, startReveal] = useTransition();
  // Covers the moment between saving a first income and the refreshed prop.
  const [savedIncome, setSavedIncome] = useState(false);
  const incomeSet = hasIncome || savedIncome;
  // A change to an existing income asks which month it applies from. While
  // masked, any amount typed counts as a change.
  const incomeChanged =
    incomeSet && income.trim() !== "" && (revealed?.income == null || Number(income) !== revealed.income);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const displayName = [firstName, lastName ?? ""].map((s) => s.trim()).filter(Boolean).join(" ");
  const revealedText = revealed?.income != null ? String(revealed.income) : "";

  function toggleIncome() {
    if (revealed) {
      setRevealed(null);
      return;
    }
    startReveal(async () => {
      const res = await revealIncomeAction();
      if (res.ok) setRevealed({ income: res.income, history: res.history });
      else setMessage({ ok: false, text: res.error });
    });
  }

  function startEdit() {
    setFirst(firstName);
    setLast(lastName ?? "");
    // Prefilled only if the user chose to see it; otherwise blank keeps it.
    setIncome(revealedText);
    setIncomeFrom(currentMonth);
    setMessage(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setFirst(firstName);
    setLast(lastName ?? "");
    setIncome(revealedText);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveProfileAction(first, last, income, incomeChanged ? incomeFrom : undefined);
      if (res.ok) {
        setMessage({ ok: true, text: res.message ?? "Saved." });
        setEditing(false);
        if (income.trim()) setSavedIncome(true);
        setIncome("");
        setRevealed(null);
        router.refresh();
      } else {
        setMessage({ ok: false, text: res.error ?? "Something went wrong." });
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Header: avatar + who you are. Editing lives on the details card
          below, next to the fields it changes. */}
      <section className="card flex items-center gap-4">
        <UserAvatar image={image} className="h-16 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xl font-semibold">{displayName}</div>
          <div className="truncate text-sm text-muted">{email}</div>
        </div>
      </section>

      <form onSubmit={save} className="card space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">Personal information</h2>
          {!editing ? <EditButton onClick={startEdit} /> : null}
        </div>

        {message ? (
          <div className={message.ok ? "alert-success" : "alert-error"}>{message.text}</div>
        ) : !incomeSet ? (
          <div className="alert-info">
            Add your monthly income to see what you save each month on your Personal page.
          </div>
        ) : null}

        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          <Field label="First name">
            {editing ? (
              <input
                className="input mt-1"
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                maxLength={40}
                required
                autoFocus
              />
            ) : (
              firstName
            )}
          </Field>
          <Field label="Last name">
            {editing ? (
              <input
                className="input mt-1"
                value={last}
                onChange={(e) => setLast(e.target.value)}
                maxLength={40}
              />
            ) : (
              lastName?.trim() || <span className="text-muted">Not set</span>
            )}
          </Field>
          <Field label="Monthly income (₹)">
            {editing ? (
              <>
                <input
                  className="input mt-1"
                  type="text"
                  inputMode="decimal"
                  value={income}
                  onChange={(e) => {
                    if (isMoneyInput(e.target.value)) setIncome(e.target.value);
                  }}
                  placeholder={incomeSet ? "Hidden. Leave blank to keep it" : "e.g. 50000"}
                  aria-label="Monthly income"
                  autoComplete="off"
                />
                {incomeChanged ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-normal">
                    <span className="text-muted">Apply from</span>
                    <MonthSelect
                      months={incomeMonthOptions(currentMonth)}
                      value={incomeFrom}
                      onChange={setIncomeFrom}
                    />
                  </div>
                ) : null}
                <p className="mt-1 text-xs font-normal text-muted">
                  Your fixed take-home pay each month. A change applies from the month you pick
                  and replaces any later changes; earlier months keep their amount.
                </p>
              </>
            ) : incomeSet ? (
              <>
                <div className="flex items-center gap-2">
                  {revealed ? (
                    <span>{revealed.income !== null ? formatINR(revealed.income) : "Not set"}</span>
                  ) : (
                    <span className="tracking-[0.2em] text-muted" aria-label="Hidden">
                      ₹ ••••••
                    </span>
                  )}
                  <button
                    type="button"
                    className="icon-btn -my-1.5 shrink-0"
                    onClick={toggleIncome}
                    disabled={revealing}
                    aria-pressed={revealed !== null}
                    aria-label={revealed ? "Hide monthly income" : "Show monthly income"}
                    title={revealed ? "Hide" : "Show"}
                  >
                    {revealed ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                  </button>
                </div>
                {revealed && revealed.history.length > 1 ? (
                  <ul className="mt-1 space-y-0.5 text-xs font-normal text-muted">
                    {/* The oldest amount also covers every month before it. */}
                    {revealed.history
                      .map((h, i) => (
                        <li key={h.month}>
                          {formatINR(h.amount)}{" "}
                          {i === 0
                            ? `before ${monthLabel(revealed.history[1].month)}`
                            : `from ${monthLabel(h.month)}`}
                        </li>
                      ))
                      .reverse()}
                  </ul>
                ) : null}
              </>
            ) : (
              <span className="text-negative">Not set</span>
            )}
          </Field>
          <Field label="Email address">
            {email}
            {editing ? (
              <p className="mt-1 text-xs font-normal text-muted">
                Comes from your Google sign-in and cannot be changed here.
              </p>
            ) : null}
          </Field>
        </dl>

        {editing ? (
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save Changes"}
            </button>
            <button type="button" className="btn-secondary" onClick={cancel} disabled={pending}>
              Cancel
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-base font-medium text-ink">{children}</dd>
    </div>
  );
}

/** Pencil icon, the same edit affordance as expenses and the group name. */
function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="icon-btn shrink-0"
      onClick={onClick}
      aria-label="Edit profile"
      title="Edit"
    >
      <PencilIcon />
    </button>
  );
}
