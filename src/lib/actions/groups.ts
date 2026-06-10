"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import * as groups from "@/lib/groups";
import { sendInviteEmail } from "@/lib/email";
import { displayNameFor } from "@/lib/users";
import { maskEmail } from "@/lib/pii";
import { cleanText, isValidEmail } from "@/lib/validate";
import { emailForKey } from "@/lib/wire";

// Cap on invites a single user may create per hour — keeps the invite mailer
// from being abused as a spam relay.
const INVITES_PER_HOUR = 20;

function revalidateGroupViews() {
  for (const p of ["/", "/groups", "/add", "/log", "/summary", "/settlement"])
    revalidatePath(p);
}

async function requireEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

export async function createGroupAction(name: string, description: string) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  const cleanName = cleanText(name, 80);
  if (!cleanName) return { ok: false, error: "Please enter a group name." };
  const groupId = await groups.createGroup(cleanName, cleanText(description, 300), email);
  revalidateGroupViews();
  return {
    ok: true,
    groupId,
    message: `Group "${cleanName}" created! You are the admin.`,
  };
}

export async function inviteAction(groupId: string, inviteEmail: string) {
  const email = await requireEmail();
  if (!email) return { ok: false, level: "error" as const, message: "Not signed in." };
  if (!(await groups.isGroupMember(groupId, email)))
    return { ok: false, level: "error" as const, message: "You are not a member of this group." };

  const target = inviteEmail.trim().toLowerCase();
  if (!isValidEmail(target))
    return { ok: false, level: "error" as const, message: "Please enter a valid email address." };

  const recentInvites = await prisma.groupInvite.count({
    where: { invitedBy: email, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recentInvites >= INVITES_PER_HOUR)
    return {
      ok: false,
      level: "error" as const,
      message: "Too many invites in the last hour. Please try again later.",
    };

  const result = await groups.sendInvite(groupId, target, email);
  if (result === "already_member")
    return { ok: true, level: "warning" as const, message: "That person is already a member of this group." };
  if (result === "already_invited")
    return { ok: true, level: "warning" as const, message: "A pending invite already exists for that email." };

  const group = await groups.getGroup(groupId);
  // Identify the inviter by display name + masked address — never the raw
  // email — since the recipient may be a stranger or a mistyped address.
  const inviter = await prisma.appUser.findUnique({ where: { email } });
  const inviterLabel = `${displayNameFor(inviter, "A member")} (${maskEmail(email)})`;
  const sent = await sendInviteEmail(target, group?.name ?? "the group", inviterLabel);
  revalidateGroupViews();
  if (sent.ok)
    return { ok: true, level: "success" as const, message: `Invite recorded and email sent to ${target}.` };
  // Log the SMTP details server-side only; the browser gets a generic message.
  console.error("Invite email failed:", sent.error);
  return {
    ok: true,
    level: "error" as const,
    message: `Invite recorded for ${target}, but the notification email could not be sent.`,
  };
}

export async function respondInviteAction(inviteId: number, accept: boolean) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(inviteId)) return { ok: false, error: "Invalid invite." };
  await groups.respondToInvite(inviteId, accept, email);
  revalidateGroupViews();
  return { ok: true };
}

export async function removeMemberAction(groupId: string, targetKey: string) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  const members = await groups.getGroupMembers(groupId);
  const me = members.find((m) => m.email === email);
  if (!me || me.role !== "admin") return { ok: false, error: "Admins only." };
  // The client sends an opaque key; resolve it back to a member email.
  const targetEmail = emailForKey(groupId, members, targetKey);
  if (!targetEmail) return { ok: false, error: "Member not found." };
  if (targetEmail === email)
    return { ok: false, error: "Use Leave Group to remove yourself." };
  await groups.removeMember(groupId, targetEmail);
  revalidateGroupViews();
  return { ok: true };
}

export async function leaveGroupAction(groupId: string) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  await groups.removeMember(groupId, email);
  revalidateGroupViews();
  return { ok: true };
}

export async function deleteGroupAction(groupId: string) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  const group = await groups.getGroup(groupId);
  if (!group || group.createdBy !== email)
    return { ok: false, error: "Only the creator can delete this group." };
  await groups.deleteGroup(groupId);
  revalidateGroupViews();
  return { ok: true };
}

export async function cancelInviteAction(groupId: string, inviteId: number) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(inviteId)) return { ok: false, error: "Invalid invite." };
  const members = await groups.getGroupMembers(groupId);
  const me = members.find((m) => m.email === email);
  if (!me || me.role !== "admin") return { ok: false, error: "Admins only." };
  // cancelInvite is scoped to groupId, so ids from other groups are inert.
  await groups.cancelInvite(groupId, inviteId);
  revalidateGroupViews();
  return { ok: true };
}
