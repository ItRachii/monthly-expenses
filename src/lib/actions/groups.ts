"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import * as groups from "@/lib/groups";
import { sendInviteEmail } from "@/lib/email";

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
  if (!name.trim()) return { ok: false, error: "Please enter a group name." };
  const groupId = await groups.createGroup(name, description, email);
  revalidateGroupViews();
  return {
    ok: true,
    groupId,
    message: `Group "${name.trim()}" created! You are the admin.`,
  };
}

export async function inviteAction(groupId: string, inviteEmail: string) {
  const email = await requireEmail();
  if (!email) return { ok: false, level: "error" as const, message: "Not signed in." };
  if (!(await groups.isGroupMember(groupId, email)))
    return { ok: false, level: "error" as const, message: "You are not a member of this group." };

  const target = inviteEmail.trim();
  if (!target)
    return { ok: false, level: "error" as const, message: "Please enter an email address." };

  const result = await groups.sendInvite(groupId, target, email);
  if (result === "already_member")
    return { ok: true, level: "warning" as const, message: "That person is already a member of this group." };
  if (result === "already_invited")
    return { ok: true, level: "warning" as const, message: "A pending invite already exists for that email." };

  const group = await groups.getGroup(groupId);
  const sent = await sendInviteEmail(target, group?.name ?? "the group", email);
  revalidateGroupViews();
  if (sent.ok)
    return { ok: true, level: "success" as const, message: `Invite recorded and email sent to ${target}.` };
  return {
    ok: true,
    level: "error" as const,
    message: `Invite recorded for ${target} but email failed: ${sent.error}`,
  };
}

export async function respondInviteAction(inviteId: number, accept: boolean) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  await groups.respondToInvite(inviteId, accept, email);
  revalidateGroupViews();
  return { ok: true };
}

export async function removeMemberAction(groupId: string, memberEmail: string) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  const members = await groups.getGroupMembers(groupId);
  const me = members.find((m) => m.email === email);
  if (!me || me.role !== "admin") return { ok: false, error: "Admins only." };
  await groups.removeMember(groupId, memberEmail);
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
  const members = await groups.getGroupMembers(groupId);
  const me = members.find((m) => m.email === email);
  if (!me || me.role !== "admin") return { ok: false, error: "Admins only." };
  await groups.cancelInvite(inviteId);
  revalidateGroupViews();
  return { ok: true };
}
