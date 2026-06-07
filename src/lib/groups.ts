import { randomBytes } from "crypto";
import { prisma } from "./prisma";

// Ported from legacy-streamlit/utils/groups.py

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
  invitedBy: string;
}

export interface GroupInviteDTO {
  id: number;
  invitedEmail: string;
  invitedBy: string;
  status: string;
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
    },
  });
  return group.id;
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
    const display = u
      ? u.username && u.username.trim()
        ? u.username.trim()
        : u.firstName
      : m.displayName || m.email;
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
        displayName: "",
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
    const display = u
      ? u.username && u.username.trim()
        ? u.username.trim()
        : u.firstName
      : m.displayName || m.email;
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

export async function sendInvite(
  groupId: string,
  invitedEmail: string,
  invitedBy: string,
): Promise<InviteResult> {
  const email = invitedEmail.trim().toLowerCase();

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
    where: { invitedEmail: userEmail.toLowerCase(), status: "pending" },
    include: { group: true },
  });
  return invites.map((inv) => ({
    inviteId: inv.id,
    groupId: inv.groupId,
    groupName: inv.group.name,
    groupDescription: inv.group.description,
    invitedBy: inv.invitedBy,
  }));
}

export async function respondToInvite(
  inviteId: number,
  accept: boolean,
  userEmail: string,
): Promise<void> {
  const invite = await prisma.groupInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.invitedEmail !== userEmail.toLowerCase()) return;

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
    invitedBy: inv.invitedBy,
    status: inv.status,
  }));
}

export async function cancelInvite(inviteId: number): Promise<void> {
  await prisma.groupInvite.deleteMany({ where: { id: inviteId } });
}
