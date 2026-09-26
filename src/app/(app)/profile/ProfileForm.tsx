"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProfileAction } from "@/lib/actions/profile";
import { UserAvatar } from "@/components/UserAvatar";

export function ProfileForm({
  email,
  firstName,
  username,
  image,
}: {
  email: string;
  firstName: string;
  username: string | null;
  image: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(username ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const displayName = username?.trim() || firstName;

  function startEdit() {
    setValue(username ?? "");
    setMessage(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setValue(username ?? "");
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveProfileAction(value);
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
          <Field label="Display Name">
            {editing ? (
              <input
                className="input mt-1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={firstName}
                maxLength={40}
                autoFocus
              />
            ) : (
              <span>{username?.trim() || <span className="text-muted">Not set</span>}</span>
            )}
            <p className="mt-1 text-xs text-muted">
              Shown to other members instead of your first name.
            </p>
          </Field>
          <Field label="First Name">{firstName}</Field>
          <Field label="Email address">{email}</Field>
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

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn-secondary shrink-0" onClick={onClick}>
      Edit
      <PencilIcon />
    </button>
  );
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
