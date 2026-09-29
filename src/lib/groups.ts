import { randomBytes } from "crypto";
import { prisma } from "./prisma";
import { displayNameFor } from "./users";
import { maskEmail } from "./pii";
import { emailId } from "./piiCrypto";
import { decryptEmail, encryptEmail, maskedEmailsFor } from "./piiStore";

// Ported from legacy-streamlit/utils/groups.py

/** Masked address of an invitee, from the invite's encrypted copy. */
function maskedInvitee(enc: string | null): string {
  const plain = decryptEmail(enc);
  return plain ? maskEmail(plain) : "Invited member";
}

export interface GroupDTO {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  role?: string;
}

export interface MemberDTO {
  email: string;
  displayName: string;
  role: string;
  joinedAt: string;
}

export interface PendingInviteDTO {
  inviteId: number;
  groupId: string;
  groupName: string;
  groupDescription: string | null;
  /** Display label for the inviter (name + masked email), never the raw address. */
  invitedBy: string;
}

export interface GroupInviteDTO {
  id: number;
  /** User id of the invitee. */
  invitedEmail: string;
  /** "ne•••@g•••.com", for display. */
  invitedEmailMasked: string;
  invitedBy: string;
  status: string;
}

export interface GroupNameHistoryDTO {
  name: string;
  validFrom: string;
  /** Null for the row that is still current. */
  validTo: string | null;
}

export type InviteResult = "ok" | "already_member" | "already_invited";

export async function createGroup(
  name: string,
  description: string,
  creatorEmail: string,
): Promise<string> {
  const now = new Date();
  const group = await prisma.group.create({
    data: {
      name: name.trim(),
      description: description.trim() || null,
      inviteCode: randomBytes(8).toString("hex"), // satisfies legacy NOT NULL column
      createdBy: creatorEmail,
      createdAt: now,
      active: 1,
      members: {
        create: [
          { email: creatorEmail, displayName: "", role: "admin", joinedAt: now },
        ],
      },
      nameHistory: {
        create: [{ name: name.trim(), validFrom: now, validTo: null, changedBy: creatorEmail }],
      },
    },
  });
  return group.id;
}

/**
 * Renames a group, keeping the old name as SCD Type 2 history: the open
 * history row is closed at `now` and a new open row is inserted. Groups
 * created before history existed get their first row seeded from
 * `created_at`, so the timeline is complete from creation onward.
 * Returns false when the name is unchanged (nothing is written).
 */
export async function renameGroup(
  groupId: string,
  newName: string,
  changedBy: string,
): Promise<boolean> {
  const name = newName.trim();
  return prisma.$transaction(async (tx) => {
    const group = await tx.group.findFirst({ where: { id: groupId, active: 1 } });
    if (!group || group.name === name) return false;
    const now = new Date();

    const open = await tx.groupNameHistory.findFirst({
      where: { groupId, validTo: null },
      orderBy: { validFrom: "desc" },
    });
    if (open) {
      await tx.groupNameHistory.update({ where: { id: open.id }, data: { validTo: now } });
    } else {
      await tx.groupNameHistory.create({
        data: {
          groupId,
          name: group.name,
          validFrom: group.createdAt,
          validTo: now,
          changedBy: group.createdBy,
        },
      });
    }
    await tx.groupNameHistory.create({
      data: { groupId, name, validFrom: now, validTo: null, changedBy },
    });
    await tx.group.update({ where: { id: groupId }, data: { name } });
    return true;
  });
}

/** Name history, newest first. Falls back to the current name for groups
 *  that predate history and have never been renamed. */
export async function getGroupNameHistory(groupId: string): Promise<GroupNameHistoryDTO[]> {
  const rows = await prisma.groupNameHistory.findMany({
    where: { groupId },
    orderBy: { validFrom: "desc" },
  });
  if (rows.length === 0) {
    const g = await prisma.group.findUnique({ where: { id: groupId } });
    if (!g) return [];
    return [{ name: g.name, validFrom: g.createdAt.toISOString(), validTo: null }];
  }
  return rows.map((r) => ({
    name: r.name,
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo ? r.validTo.toISOString() : null,
  }));
}

export async function getUserGroups(userEmail: string): Promise<GroupDTO[]> {
  const memberships = await prisma.groupMember.findMany({
    where: { email: userEmail, group: { active: 1 } },
    include: { group: true },
    orderBy: { group: { createdAt: "desc" } },
  });
  return memberships.map((m) => ({
    id: m.group.id,
    name: m.group.name,
    description: m.group.description,
    createdBy: m.group.createdBy,
    createdAt: m.group.createdAt.toISOString(),
    role: m.role ?? "member",
  }));
}

/** A group in the sidebar: its name and the member's unread notifications in it. */
export interface SidebarGroup {
  id: string;
  name: string;
  unread: number;
}

/**
 * The member's groups for the sidebar, most recently opened first. Groups
 * never opened follow, newest first. Each carries its unread notifications.
 */
export async function getSidebarGroups(userEmail: string): Promise<SidebarGroup[]> {
  const [memberships, unread] = await Promise.all([
    prisma.groupMember.findMany({
      where: { email: userEmail, group: { active: 1 } },
      select: { lastVisitedAt: true, group: { select: { id: true, name: true, createdAt: true } } },
    }),
    prisma.notification.groupBy({
      by: ["groupId"],
      where: { recipientEmail: userEmail, isRead: false },
      _count: { _all: true },
    }),
  ]);
  const unreadBy = new Map(unread.map((u) => [u.groupId, u._count._all]));
  return memberships
    .sort((a, b) => {
      const va = a.lastVisitedAt?.getTime() ?? -1;
      const vb = b.lastVisitedAt?.getTime() ?? -1;
      return vb - va || b.group.createdAt.getTime() - a.group.createdAt.getTime();
    })
    .map((m) => ({ id: m.group.id, name: m.group.name, unread: unreadBy.get(m.group.id) ?? 0 }));
}

/** Records that the member opened the group. */
export async function touchGroupVisit(userEmail: string, groupId: string): Promise<void> {
  await prisma.groupMember.updateMany({ where: { email: userEmail, groupId }, data: { lastVisitedAt: new Date() } });
}

export async function getGroup(groupId: string): Promise<GroupDTO | null> {
  const g = await prisma.group.findFirst({ where: { id: groupId, active: 1 } });
  if (!g) return null;
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    createdBy: g.createdBy,
    createdAt: g.createdAt.toISOString(),
  };
}

export async function getGroupMembers(groupId: string): Promise<MemberDTO[]> {
  const members = await prisma.groupMember.findMany({ where: { groupId } });
  const users = await prisma.appUser.findMany({
    where: { email: { in: members.map((m) => m.email) } },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  return members.map((m) => {
    const u = byEmail.get(m.email);
    const display = displayNameFor(u ?? null, m.displayName || m.email);
    return {
      email: m.email,
      displayName: display,
      role: m.role ?? "member",
      joinedAt: m.joinedAt.toISOString(),
    };
  });
}

export async function isGroupMember(groupId: string, userEmail: string): Promise<boolean> {
  const m = await prisma.groupMember.findFirst({ where: { groupId, email: userEmail } });
  return m !== null;
}

// Members + people with a still-pending invite. Used wherever expenses are
// split: invitees participate in splits/settlements before they accept (their
// email is the key, so it stays valid once they join). Access control still
// uses isGroupMember / getGroupMembers — being invited doesn't grant access.
export async function getGroupParticipants(groupId: string): Promise<MemberDTO[]> {
  const members = await prisma.groupMember.findMany({ where: { groupId } });
  const invites = await prisma.groupInvite.findMany({
    where: { groupId, status: "pending" },
  });
  const memberEmails = new Set(members.map((m) => m.email));

  const rows: { email: string; displayName: string; role: string; joinedAt: Date }[] = [
    ...members.map((m) => ({
      email: m.email,
      displayName: m.displayName ?? "",
      role: m.role ?? "member",
      joinedAt: m.joinedAt,
    })),
    ...invites
      .filter((inv) => !memberEmails.has(inv.invitedEmail))
      .map((inv) => ({
        email: inv.invitedEmail,
        // No name yet: show the masked address from the invite.
        displayName: maskedInvitee(inv.invitedEmailEnc),
        role: "invited",
        joinedAt: inv.createdAt,
      })),
  ];

  const users = await prisma.appUser.findMany({
    where: { email: { in: rows.map((r) => r.email) } },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  return rows.map((m) => {
    const u = byEmail.get(m.email);
    const display = displayNameFor(u ?? null, m.displayName || m.email);
    return {
      email: m.email,
      displayName: display,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    };
  });
}

export async function removeMember(groupId: string, userEmail: string): Promise<void> {
  await prisma.groupMember.deleteMany({ where: { groupId, email: userEmail } });
}

export async function deleteGroup(groupId: string): Promise<void> {
  await prisma.group.update({ where: { id: groupId }, data: { active: 0 } });
}

/** `invitedEmail` is the typed address; `invitedBy` a user id. */
export async function sendInvite(
  groupId: string,
  invitedEmail: string,
  invitedBy: string,
): Promise<InviteResult> {
  const email = await emailId(invitedEmail);

  const existingMember = await prisma.groupMember.findFirst({
    where: { groupId, email },
  });
  if (existingMember) return "already_member";

  const existingInvite = await prisma.groupInvite.findFirst({
    where: { groupId, invitedEmail: email, status: "pending" },
  });
  if (existingInvite) return "already_invited";

  await prisma.groupInvite.create({
    data: {
      groupId,
      invitedEmail: email,
      invitedEmailEnc: encryptEmail(invitedEmail),
      invitedBy,
      status: "pending",
      createdAt: new Date(),
    },
  });
  return "ok";
}

export async function getPendingInvitesForUser(
  userEmail: string,
): Promise<PendingInviteDTO[]> {
  const invites = await prisma.groupInvite.findMany({
    where: { invitedEmail: userEmail, status: "pending" },
    include: { group: true },
  });
  // Label the inviter by name + masked email — never expose their raw address
  // to the (possibly not-yet-acquainted) invitee.
  const inviters = await prisma.appUser.findMany({
    where: { email: { in: invites.map((i) => i.invitedBy) } },
  });
  const byEmail = new Map(inviters.map((u) => [u.email, u]));
  const maskedById = await maskedEmailsFor(invites.map((i) => i.invitedBy));
  return invites.map((inv) => {
    const masked = maskedById.get(inv.invitedBy) ?? "a member";
    const name = displayNameFor(byEmail.get(inv.invitedBy) ?? null, masked);
    return {
      inviteId: inv.id,
      groupId: inv.groupId,
      groupName: inv.group.name,
      groupDescription: inv.group.description,
      invitedBy: name === masked ? masked : `${name} (${masked})`,
    };
  });
}

export async function respondToInvite(
  inviteId: number,
  accept: boolean,
  userEmail: string,
): Promise<void> {
  const invite = await prisma.groupInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.invitedEmail !== userEmail) return;

  await prisma.groupInvite.update({
    where: { id: inviteId },
    data: {
      status: accept ? "accepted" : "declined",
      respondedAt: new Date(),
    },
  });

  if (accept) {
    const already = await prisma.groupMember.findFirst({
      where: { groupId: invite.groupId, email: userEmail },
    });
    if (!already) {
      await prisma.groupMember.create({
        data: {
          groupId: invite.groupId,
          email: userEmail,
          displayName: "",
          role: "member",
          joinedAt: new Date(),
        },
      });
    }
  }
}

export async function getGroupInvites(groupId: string): Promise<GroupInviteDTO[]> {
  const invites = await prisma.groupInvite.findMany({ where: { groupId } });
  return invites.map((inv) => ({
    id: inv.id,
    invitedEmail: inv.invitedEmail,
    invitedEmailMasked: maskedInvitee(inv.invitedEmailEnc),
    invitedBy: inv.invitedBy,
    status: inv.status,
  }));
}

/**
 * Cancels an invite, scoped to the group the caller is authorized for, so an
 * admin of one group can never cancel another group's invites by guessing ids.
 */
export async function cancelInvite(groupId: string, inviteId: number): Promise<void> {
  await prisma.groupInvite.deleteMany({ where: { id: inviteId, groupId } });
}
