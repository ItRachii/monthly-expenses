import { prisma } from "./prisma";
import { getGroupMembers } from "./groups";

export type NotificationType =
  | "expense_added"
  | "expense_updated"
  | "expense_deleted"
  | "settlement_recorded";

// Deliberately excludes actor_email: the client renders only the message
// (which uses display names), so the actor's address never leaves the server.
export interface NotificationDTO {
  id: number;
  groupId: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
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
    })),
  });
}

export async function getNotifications(
  email: string,
  limit = 50,
): Promise<NotificationDTO[]> {
  const rows = await prisma.notification.findMany({
    where: { recipientEmail: email },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((n) => ({
    id: n.id,
    groupId: n.groupId,
    type: n.type,
    message: n.message,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
  }));
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
