"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelInviteAction,
  deleteGroupAction,
  leaveGroupAction,
  removeMemberAction,
  renameGroupAction,
  revokeJoinLinkAction,
} from "@/lib/actions/groups";
import { AddPeople } from "@/components/AddPeople";
import { CheckIcon, PencilIcon, XIcon } from "@/components/Icons";
import { Modal } from "@/components/Modal";
import type { GroupView } from "@/lib/groupView";
import { localISO, shortDate } from "@/lib/format";

// Group settings, opened from the gear on a group screen.

/** Rename, name history, members, invites and leave/delete for one group. */
function GroupSettingsBody({ group, contacts }: { group: GroupView; contacts: "google" | "denied" | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The contact list takes over the sheet while it is open.
  const [picking, setPicking] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      router.refresh();
    });
  }

  // AddPeople keeps its place in the tree while the sections around it come
  // and go, so its contact list and link survive the switch.
  return (
    <div className="space-y-5">
      {picking ? null : (
        <>
          {error ? <div className="alert-error">{error}</div> : null}
          {/* Name (editable by admins) + name history */}
          <NameField
            groupId={group.id}
            current={group.name}
            description={group.description}
            canEdit={group.isAdmin}
          />
          {group.nameHistory.length > 1 ? <NameHistory rows={group.nameHistory} /> : null}

          {/* Members */}
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
              Members
            </h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {group.members.map((m) => (
                  <tr key={m.key}>
                    <td>
                      {m.displayName}
                      {m.isSelf ? <span className="text-muted"> (you)</span> : null}
                    </td>
                    <td className="capitalize">{m.role}</td>
                    <td className="text-right">
                      {group.isAdmin && !m.isSelf ? (
                        <button
                          className="text-negative hover:text-negative"
                          disabled={pending}
                          onClick={() => run(() => removeMemberAction(group.id, m.key))}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </>
      )}

      {/* Add by email, from contacts, or with a join link */}
      <AddPeople groupId={group.id} groupName={group.name} initial={contacts} onPickingChange={setPicking} />

      {picking ? null : (
        <>
          {/* Pending invites (admin) */}
          {group.isAdmin && group.pendingInvites.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                Pending Invites ({group.pendingInvites.length})
              </h3>
              <div className="space-y-1">
                {group.pendingInvites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between text-sm">
                    <span>{inv.invitedEmail}</span>
                    <button
                      className="btn-secondary px-3 py-1 text-xs"
                      disabled={pending}
                      onClick={() => run(() => cancelInviteAction(group.id, inv.id))}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Join links that still work (admin) */}
          {group.isAdmin && group.joinLinks.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                Join Links ({group.joinLinks.length})
              </h3>
              <div className="space-y-1">
                {group.joinLinks.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      Shared by {l.sharedBy}
                      <span className="block text-xs text-muted">
                        {l.useCount} of {l.maxUses} joined, works until {formatDate(l.expiresAt)}
                      </span>
                    </span>
                    <button
                      className="btn-secondary shrink-0 px-3 py-1 text-xs"
                      disabled={pending}
                      onClick={() => run(() => revokeJoinLinkAction(group.id, l.id))}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Danger zone */}
          <div className="border-t border-ink/10 pt-4">
            {!group.isCreator ? (
              <button
                className="btn-danger"
                disabled={pending}
                onClick={() => run(() => leaveGroupAction(group.id))}
              >
                Leave Group
              </button>
            ) : !confirmDelete ? (
              <button className="btn-danger" onClick={() => setConfirmDelete(true)}>
                Delete Group
              </button>
            ) : (
              <div className="space-y-2">
                <div className="alert-warning">
                  Are you sure? All group expenses and invites will be lost.
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-danger"
                    disabled={pending}
                    onClick={() => run(() => deleteGroupAction(group.id))}
                  >
                    Yes, delete permanently
                  </button>
                  <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The group name, edited in place like any other field: admins get a pencil
 * icon that swaps the name for an input with save and cancel icons.
 */
function NameField({
  groupId,
  current,
  description,
  canEdit,
}: {
  groupId: string;
  current: string;
  description: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startEdit() {
    setValue(current);
    setError(null);
    setEditing(true);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await renameGroupAction(groupId, value);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else setError(res.error ?? "Something went wrong.");
    });
  }

  return (
    <div>
      <div className="text-sm text-muted">Group name</div>
      {editing ? (
        <form onSubmit={save} className="mt-1 space-y-2">
          <div className="flex items-center gap-1">
            <input
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                // Escape cancels the edit without closing the overlay.
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
              maxLength={80}
              aria-label="Group name"
              autoFocus
            />
            <button
              type="submit"
              className="icon-btn text-primary"
              disabled={pending}
              aria-label="Save name"
              title="Save"
            >
              <CheckIcon />
            </button>
            <button
              type="button"
              className="icon-btn"
              disabled={pending}
              onClick={() => setEditing(false)}
              aria-label="Cancel rename"
              title="Cancel"
            >
              <XIcon />
            </button>
          </div>
          {error ? <div className="alert-error">{error}</div> : null}
          <p className="text-xs text-muted">
            The old name is kept in the group&apos;s name history.
          </p>
        </form>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium text-ink">{current}</div>
            {description ? (
              <div className="truncate text-sm text-muted">{description}</div>
            ) : null}
          </div>
          {canEdit ? (
            <button
              type="button"
              className="icon-btn"
              onClick={startEdit}
              aria-label="Edit group name"
              title="Edit"
            >
              <PencilIcon />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** "5 Sep 2026", on this device's calendar, spelled as everywhere else in the app. */
function formatDate(iso: string): string {
  return shortDate(localISO(new Date(iso)), { padDay: false });
}

function NameHistory({
  rows,
}: {
  rows: { name: string; validFrom: string; validTo: string | null }[];
}) {
  return (
    <details>
      <summary className="cursor-pointer select-none text-sm font-semibold uppercase tracking-wide text-muted">
        Name History ({rows.length})
      </summary>
      <table className="data-table mt-2">
        <thead>
          <tr>
            <th>Name</th>
            <th>From</th>
            <th>To</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.name}-${r.validFrom}`}>
              <td>
                {r.name}
                {r.validTo === null ? <span className="text-muted"> (current)</span> : null}
              </td>
              <td>{formatDate(r.validFrom)}</td>
              <td>{r.validTo === null ? "Present" : formatDate(r.validTo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * Group settings on top of the group screen. Closes on an outside press, the
 * close button, Esc or the back gesture. Leaving or deleting the group goes
 * back home.
 */
export function GroupSettingsOverlay({
  group,
  contacts = null,
  onClose,
}: {
  group: GroupView;
  /** Back from Google's permission screen: open its contacts, or say they were not shared. */
  contacts?: "google" | "denied" | null;
  onClose: () => void;
}) {
  return (
    <Modal sheet width="36rem" labelledBy="group-settings-title" onClose={onClose}>
      <div
        className="sheet card max-h-[92dvh] w-full space-y-4 overflow-y-auto overscroll-contain rounded-b-none md:rounded-xl"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="group-settings-title" className="section-title">Group settings</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <GroupSettingsBody group={group} contacts={contacts} />
      </div>
    </Modal>
  );
}
