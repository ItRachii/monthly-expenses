"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { NotificationDTO } from "@/lib/notifications";
import { markAllReadAction, markReadAction } from "@/lib/actions/notifications";

const ICONS: Record<string, string> = {
  expense_added: "➕",
  expense_deleted: "🗑",
  settlement_recorded: "💰",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationList({
  notifications,
}: {
  notifications: NotificationDTO[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const hasUnread = notifications.some((n) => !n.isRead);

  function markAll() {
    startTransition(async () => {
      await markAllReadAction();
      router.refresh();
    });
  }

  function onItemClick(n: NotificationDTO) {
    if (n.isRead) return;
    startTransition(async () => {
      await markReadAction(n.id);
      router.refresh();
    });
  }

  if (notifications.length === 0) {
    return (
      <div className="alert-info">
        No notifications yet. Group activity — added or deleted expenses and
        settlements — will show up here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          className="btn-secondary"
          onClick={markAll}
          disabled={pending || !hasUnread}
        >
          Mark all as read
        </button>
      </div>

      <div className="space-y-2">
        {notifications.map((n) => (
          <button
            key={n.id}
            onClick={() => onItemClick(n)}
            className={`card flex w-full items-start gap-3 text-left transition ${
              n.isRead ? "opacity-60" : "border-primary/30 bg-primary/5"
            }`}
          >
            <span className="text-lg" aria-hidden>
              {ICONS[n.type] ?? "🔔"}
            </span>
            <div className="flex-1">
              <div className="text-sm text-ink">{n.message}</div>
              <div className="mt-0.5 text-xs text-muted">{timeAgo(n.createdAt)}</div>
            </div>
            {!n.isRead ? (
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
