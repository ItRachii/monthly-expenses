"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelInviteAction,
  createGroupAction,
  deleteGroupAction,
  inviteAction,
  leaveGroupAction,
  removeMemberAction,
} from "@/lib/actions/groups";

export interface GroupView {
  id: string;
  name: string;
  description: string | null;
  role: string;
  isAdmin: boolean;
  isCreator: boolean;
  members: { email: string; displayName: string; role: string }[];
  pendingInvites: { id: number; invitedEmail: string }[];
}

export function GroupsManager({
  email,
  groups,
}: {
  email: string;
  groups: GroupView[];
}) {
  const [tab, setTab] = useState<"my" | "create">("my");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["my", "create"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              tab === t ? "bg-primary/20 font-semibold text-ink" : "text-muted hover:bg-white/5"
            }`}
          >
            {t === "my" ? "My Groups" : "Create New Group"}
          </button>
        ))}
      </div>

      {tab === "my" ? (
        groups.length === 0 ? (
          <div className="alert-info">
            You are not part of any group yet. Create one or wait for an invite!
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <GroupCard key={g.id} email={email} group={g} />
            ))}
          </div>
        )
      ) : (
        <CreateGroupForm />
      )}
    </div>
  );
}

function GroupCard({ email, group }: { email: string; group: GroupView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  function run(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  return (
    <details className="card">
      <summary className="cursor-pointer select-none font-semibold">
        {group.isAdmin ? "👑" : "👤"} {group.name}
        {group.description ? (
          <span className="font-normal text-muted"> — {group.description}</span>
        ) : null}
      </summary>

      <div className="mt-4 space-y-5">
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
                <tr key={m.email}>
                  <td>
                    {m.displayName}
                    {m.email === email ? <span className="text-muted"> (you)</span> : null}
                  </td>
                  <td className="capitalize">{m.role}</td>
                  <td className="text-right">
                    {group.isAdmin && m.email !== email ? (
                      <button
                        className="text-red-400 hover:text-red-300"
                        disabled={pending}
                        onClick={() => run(() => removeMemberAction(group.id, m.email))}
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

        {/* Invite */}
        <InviteForm groupId={group.id} />

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

        {/* Danger zone */}
        <div className="border-t border-white/10 pt-4">
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
      </div>
    </details>
  );
}

function InviteForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ level: string; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await inviteAction(groupId, value);
      setMessage({ level: res.level ?? "error", text: res.message ?? "" });
      if (res.ok && res.level === "success") setValue("");
      router.refresh();
    });
  }

  const cls =
    message?.level === "success"
      ? "alert-success"
      : message?.level === "warning"
        ? "alert-warning"
        : "alert-error";

  return (
    <form onSubmit={submit} className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
        Invite by Email
      </h3>
      {message ? <div className={cls}>{message.text}</div> : null}
      <div className="flex gap-2">
        <input
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="friend@email.com"
        />
        <button type="submit" className="btn-primary shrink-0" disabled={pending}>
          Send Invite
        </button>
      </div>
    </form>
  );
}

function CreateGroupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createGroupAction(name, description);
      if (res.ok) {
        setMessage({ ok: true, text: res.message ?? "Group created." });
        setName("");
        setDescription("");
        router.refresh();
      } else {
        setMessage({ ok: false, text: res.error ?? "Something went wrong." });
      }
    });
  }

  return (
    <form onSubmit={submit} className="card max-w-lg space-y-4">
      <h2 className="section-title">Create a New Group</h2>
      <div>
        <label className="label">Group Name *</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Apartment Mates"
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
      {message ? (
        <div className={message.ok ? "alert-success" : "alert-error"}>{message.text}</div>
      ) : null}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create Group"}
      </button>
    </form>
  );
}
