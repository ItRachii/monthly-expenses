import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getGroupMembers } from "./groups";

export type NotificationType =
  | "expense_added"
  | "expense_updated"
  | "expense_deleted"
  | "settlement_recorded"
  | "group_renamed";

/** A deleted expense as it was, since there is no row left to show. */
export interface DeletedExpense {
  date: string;
  item: string;
  category: string;
  amount: number;
}

/**
 * What a notification points at, so opening it lands on the record:
 * - expenses: the ids added or edited (one, or a receipt's or import's rows);
 * - deleted: what went, as a snapshot of each (one expense), or only a
 *   count and total when many went at once (a removed card or statement
 *   leaves no item names behind);
 * - settlement: the recorded payment.
 */
export type NotificationTarget =
  | { kind: "expenses"; ids: number[] }
  | { kind: "deleted"; items: DeletedExpense[]; count: number; total: number }
  | { kind: "settlement"; id: number; month: string };

const isInt = (n: unknown): n is number => Number.isInteger(n);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isYmd = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Reads a stored target back, or null when it is missing or malformed. */
export function parseTarget(raw: unknown): NotificationTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === "expenses" && Array.isArray(t.ids) && t.ids.length > 0 && t.ids.every(isInt)) {
    return { kind: "expenses", ids: t.ids };
  }
  if (t.kind === "deleted" && Array.isArray(t.items) && isInt(t.count) && isNum(t.total)) {
    const items = t.items.filter(
      (i): i is DeletedExpense =>
        !!i && typeof i === "object" && isYmd((i as DeletedExpense).date) && isStr((i as DeletedExpense).item) && isStr((i as DeletedExpense).category) && isNum((i as DeletedExpense).amount),
    );
    return { kind: "deleted", items, count: t.count, total: t.total };
  }
  if (t.kind === "settlement" && isInt(t.id) && isStr(t.month) && /^\d{4}-\d{2}$/.test(t.month)) {
    return { kind: "settlement", id: t.id, month: t.month };
  }
  return null;
}

/**
 * Where opening a notification goes: the group, on the tab that holds its
 * record, with the notification's id so the page can find and highlight
 * that record. Older notifications with no target just open the group.
 */
export function notificationHref(n: { id: number; groupId: string; target: NotificationTarget | null }): string {
  const base = `/g/${encodeURIComponent(n.groupId)}`;
  if (!n.target) return base;
  const tab = n.target.kind === "settlement" ? "balances" : "expenses";
  return `${base}?tab=${tab}&n=${n.id}`;
}

// Deliberately excludes actor_email: the client renders only the message
// (which uses display names), so the actor's address never leaves the server.
export interface NotificationDTO {
  id: number;
  groupId: string;
  /** The group's current name, so each item says where it happened. */
  groupName: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  /** Where opening it goes. */
  href: string;
}

/**
 * Creates one notification per relevant group member, excluding the actor (you
 * don't get notified about your own action). Best-effort: a failure here must
 * never break the underlying expense/settlement write, so callers wrap it.
 */
export async function notifyGroup(params: {
  groupId: string;
  actorEmail: string;
  type: NotificationType;
  message: string;
  /** The record it is about, so opening it lands there. */
  target?: NotificationTarget;
}): Promise<void> {
  const members = await getGroupMembers(params.groupId);
  const recipients = members
    .map((m) => m.email)
    .filter((email) => email !== params.actorEmail);
  if (recipients.length === 0) return;

  await prisma.notification.createMany({
    data: recipients.map((recipientEmail) => ({
      recipientEmail,
      groupId: params.groupId,
      actorEmail: params.actorEmail,
      type: params.type,
      message: params.message,
      target: params.target ? (params.target as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
    })),
  });
}

/** Unread notifications only: once seen, an item leaves the tab for good. */
export async function getNotifications(
  email: string,
  limit = 50,
): Promise<NotificationDTO[]> {
  const rows = await prisma.notification.findMany({
    where: { recipientEmail: email, isRead: false },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { group: { select: { name: true } } },
  });
  return rows.map((n) => ({
    id: n.id,
    groupId: n.groupId,
    groupName: n.group.name,
    type: n.type,
    message: n.message,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
    href: notificationHref({ id: n.id, groupId: n.groupId, target: parseTarget(n.target) }),
  }));
}

/**
 * The record one of the user's notifications points at, when it belongs
 * to them and to this group; opening it also marks it read. Null for
 * someone else's notification, another group's, or one with no target.
 */
export async function openNotification(email: string, id: number, groupId: string): Promise<NotificationFocus | null> {
  const n = await prisma.notification.findFirst({ where: { id, recipientEmail: email, groupId }, select: { type: true, target: true, isRead: true } });
  if (!n) return null;
  if (!n.isRead) await prisma.notification.updateMany({ where: { id, recipientEmail: email }, data: { isRead: true } });
  const target = parseTarget(n.target);
  return target ? { id, type: n.type, target } : null;
}

/** An opened notification, as the group page needs it to land on its record. */
export interface NotificationFocus {
  /** The notification's id, so the same one is only applied once. */
  id: number;
  type: string;
  target: NotificationTarget;
}

export async function getUnreadCount(email: string): Promise<number> {
  return prisma.notification.count({
    where: { recipientEmail: email, isRead: false },
  });
}

export async function markAllRead(email: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { recipientEmail: email, isRead: false },
    data: { isRead: true },
  });
}

export async function markRead(email: string, id: number): Promise<void> {
  await prisma.notification.updateMany({
    where: { id, recipientEmail: email },
    data: { isRead: true },
  });
}
