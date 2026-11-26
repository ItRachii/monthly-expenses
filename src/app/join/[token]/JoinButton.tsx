"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { joinWithLinkAction } from "@/lib/actions/groups";

export function JoinButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {error ? <div className="alert-error">{error}</div> : null}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              // On success the action opens the group; it only returns to say why not.
              const res = await joinWithLinkAction(token);
              if (res && !res.ok) setError(res.error ?? "Something went wrong.");
            })
          }
        >
          Join group
        </button>
        <Link href="/" className="btn-secondary">
          Not now
        </Link>
      </div>
    </div>
  );
}
