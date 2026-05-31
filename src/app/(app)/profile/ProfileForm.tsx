"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProfileAction } from "@/lib/actions/profile";

export function ProfileForm({
  email,
  firstName,
  systemRole,
  username,
}: {
  email: string;
  firstName: string;
  systemRole: string;
  username: string | null;
}) {
  const [value, setValue] = useState(username ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveProfileAction(value);
      if (res.ok) {
        setMessage({ ok: true, text: res.message ?? "Saved." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: res.error ?? "Something went wrong." });
      }
    });
  }

  return (
    <form onSubmit={save} className="card max-w-lg space-y-4">
      <div className="space-y-1 text-sm">
        <div>
          <span className="text-muted">Email:</span> {email}
        </div>
        <div>
          <span className="text-muted">First Name:</span> {firstName}
        </div>
        <div>
          <span className="text-muted">System Role:</span> {systemRole}
        </div>
      </div>

      <div>
        <label className="label">Username (optional)</label>
        <input
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter an alias or custom display name"
        />
      </div>

      {message ? (
        <div className={message.ok ? "alert-success" : "alert-error"}>
          {message.text}
        </div>
      ) : null}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save Profile"}
      </button>
    </form>
  );
}
