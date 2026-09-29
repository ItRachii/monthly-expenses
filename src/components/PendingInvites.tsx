"use client";

import { CheckIcon, MailIcon, XIcon } from "@/components/Icons";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondInviteAction } from "@/lib/actions/groups";
import type { PendingInviteDTO } from "@/lib/groups";

export function PendingInvites({ invites }: { invites: PendingInviteDTO[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (invites.length === 0) return null;

  function respond(inviteId: number, accept: boolean) {
    startTransition(async () => {
      await respondInviteAction(inviteId, accept);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <h2 className="section-title flex items-center gap-2">
        <MailIcon className="h-5 w-5 text-primary-light" /> Pending Invites ({invites.length})
      </h2>
      {invites.map((inv) => (
        <div
          key={inv.inviteId}
          className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <div className="font-semibold">
              {inv.groupName}
              {inv.groupDescription ? (
                <span className="font-normal text-muted"> — {inv.groupDescription}</span>
              ) : null}
            </div>
            <div className="text-xs text-muted">Invited by {inv.invitedBy}</div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={pending}
              onClick={() => respond(inv.inviteId, true)}
            >
              <CheckIcon className="h-4 w-4" /> Accept
            </button>
            <button
              className="btn-secondary"
              disabled={pending}
              onClick={() => respond(inv.inviteId, false)}
            >
              <XIcon className="h-4 w-4" /> Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
