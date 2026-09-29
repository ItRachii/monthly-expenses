"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { NotificationDTO } from "@/lib/notifications";
import { AddCircleIcon, PaymentsIcon, PencilIcon, TrashIcon } from "@/components/Icons";
import { NotificationsIcon } from "@/components/NavIcons";
import { markAllReadAction, markReadAction } from "@/lib/actions/notifications";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  expense_added: AddCircleIcon,
  expense_deleted: TrashIcon,
  settlement_recorded: PaymentsIcon,
  group_renamed: PencilIcon,
};

function TypeIcon({ type }: { type: string }) {
  const Icon = ICONS[type] ?? NotificationsIcon;
  return (
    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary-light">
      <Icon className="h-5 w-5" />
    </span>
  );
}

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

  function markAll() {
    startTransition(async () => {
      await markAllReadAction();
      router.refresh();
    });
  }

  function onItemClick(n: NotificationDTO) {
    startTransition(async () => {
      await markReadAction(n.id);
      router.refresh();
    });
  }

  if (notifications.length === 0) {
    return (
      <div className="alert-info">
        You are all caught up. New group activity, such as added or deleted
        expenses and settlements, will show up here until you have seen it.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          className="btn-secondary"
          onClick={markAll}
          disabled={pending}
        >
          Mark all as read
        </button>
      </div>

      <div className="space-y-2">
        {notifications.map((n) => (
          <button
            key={n.id}
            onClick={() => onItemClick(n)}
            title="Mark as read"
            className="card flex w-full items-start gap-3 border-primary/30 bg-primary/5 text-left transition hover:bg-primary/10"
          >
            <TypeIcon type={n.type} />
            <div className="flex-1">
              <div className="text-sm text-ink">{n.message}</div>
              <div className="mt-0.5 text-xs text-muted">{timeAgo(n.createdAt)}</div>
            </div>
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
          </button>
        ))}
      </div>
    </div>
  );
}
