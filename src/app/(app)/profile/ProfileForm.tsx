"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProfileAction } from "@/lib/actions/profile";
import { UserAvatar } from "@/components/UserAvatar";
import { PencilIcon } from "@/components/Icons";

export function ProfileForm({
  email,
  firstName,
  lastName,
  image,
}: {
  email: string;
  firstName: string;
  lastName: string | null;
  image: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const displayName = [firstName, lastName ?? ""].map((s) => s.trim()).filter(Boolean).join(" ");

  function startEdit() {
    setFirst(firstName);
    setLast(lastName ?? "");
    setMessage(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setFirst(firstName);
    setLast(lastName ?? "");
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveProfileAction(first, last);
      if (res.ok) {
        setMessage({ ok: true, text: res.message ?? "Saved." });
        setEditing(false);
        router.refresh();
      } else {
        setMessage({ ok: false, text: res.error ?? "Something went wrong." });
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Header: avatar + who you are, with the same Edit entry point as the
          details card below. */}
      <section className="card flex items-center gap-4">
        <UserAvatar image={image} className="h-16 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xl font-semibold">{displayName}</div>
          <div className="truncate text-sm text-muted">{email}</div>
        </div>
        {!editing ? <EditButton onClick={startEdit} /> : null}
      </section>

      <form onSubmit={save} className="card space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">Personal Information</h2>
          {!editing ? <EditButton onClick={startEdit} /> : null}
        </div>

        {message ? (
          <div className={message.ok ? "alert-success" : "alert-error"}>{message.text}</div>
        ) : null}

        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          <Field label="First Name">
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
          <Field label="Last Name">
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
