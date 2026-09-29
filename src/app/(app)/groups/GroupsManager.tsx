"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGroupAction } from "@/lib/actions/groups";
import { ChevronRightIcon, GroupAddIcon, XIcon } from "@/components/Icons";
import { formatINR } from "@/lib/format";
import { SETTLE_EPS } from "@/lib/settlementMath";


export interface GroupItem {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  /** Your all-months position in the group: positive means you are owed. */
  net: number;
  unread: number;
}

function Position({ net }: { net: number }) {
  if (net > SETTLE_EPS) return <span className="text-emerald-400">You are owed {formatINR(net)}</span>;
  if (net < -SETTLE_EPS) return <span className="text-red-400">You owe {formatINR(-net)}</span>;
  return <span>Settled up</span>;
}

// The groups list: each row opens the group screen, whose gear holds the
// settings. Creating a group happens here.
export function GroupsManager({ groups }: { groups: GroupItem[] }) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-4">
      {groups.length === 0 ? (
        <div className="alert-info">
          You are not part of any group yet. Tap the + button to create one, or
          wait for an invite!
        </div>
      ) : (
        // Bottom room so the create button never covers the last row.
        <div className="space-y-3 pb-20 md:pb-0">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/g/${encodeURIComponent(g.id)}`}
              className="card flex items-center gap-3 transition hover:bg-white/5 active:scale-[0.99]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{g.name}</div>
                <div className="truncate text-sm text-muted">
                  <Position net={g.net} />
                  {g.memberCount > 0 ? <> · {g.memberCount} member{g.memberCount === 1 ? "" : "s"}</> : null}
                </div>
              </div>
              {g.unread > 0 ? (
                <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
                  {g.unread > 99 ? "99+" : g.unread}
                  <span className="sr-only"> unread</span>
                </span>
              ) : null}
              <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
            </Link>
          ))}
        </div>
      )}

      {/* Floating button to create a group: the Groups icon with a + badge.
          Sits above the mobile bottom nav (and bottom-right on desktop). */}
      <button
        type="button"
        onClick={() => setShowCreate(true)}
        aria-label="Create a group"
        title="Create a group"
        className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 grid h-14 w-14 place-items-center rounded-full border border-white/15 bg-surface shadow-xl transition hover:bg-white/5 active:scale-95 md:bottom-6 md:right-6"
      >
        <GroupAddIcon className="h-7 w-7 text-primary-light" />
      </button>

      {showCreate ? (
        <CreateGroupModal onClose={() => setShowCreate(false)} />
      ) : null}
    </div>
  );
}

function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createGroupAction(name, description);
      if (res.ok) {
        router.refresh();
        onClose();
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div
      className="sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="sheet card w-full space-y-4 rounded-b-none md:max-w-lg md:rounded-xl"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="section-title">Create a group</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="icon-btn"
          >
            <XIcon />
          </button>
        </div>
        <div>
          <label className="label">Group Name *</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Apartment Mates"
            autoFocus
          />
        </div>
        <div>
          <label className="label">Description (optional)</label>
          <textarea
            className="textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this group for?"
          />
        </div>
        {error ? <div className="alert-error">{error}</div> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Creating…" : "Create Group"}
          </button>
        </div>
      </form>
    </div>
  );
}
