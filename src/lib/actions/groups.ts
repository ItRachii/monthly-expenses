"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import * as groups from "@/lib/groups";
import { cookies } from "next/headers";
import { sendAddedEmail, sendInviteEmail } from "@/lib/email";
import { MAX_STATUS_EMAILS, joinPath } from "@/lib/contacts";
import { TOKEN_COOKIE, fetchGoogleContacts, openToken } from "@/lib/googleContacts";
import { createJoinLink, recentJoinLinkCount, redeemJoinLink, revokeJoinLink } from "@/lib/joinLinks";
import { emailId } from "@/lib/piiCrypto";
import { notifyGroup } from "@/lib/notifications";
import { displayNameFor, nameForOthers } from "@/lib/users";
import { maskedEmailFor } from "@/lib/piiStore";
import { cleanText, isValidEmail } from "@/lib/validate";
import { emailForKey } from "@/lib/wire";

// Cap on adds, invites and join links a single user may create per hour:
// keeps the invite mailer from being abused as a spam relay, and bounds how
// many people one member can put in groups or how many links they can issue.
const INVITES_PER_HOUR = 20;

function revalidateGroupViews() {
  // Group changes affect the home dashboard and every /g/[ctx] screen.
  revalidatePath("/", "layout");
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

export async function renameGroupAction(groupId: string, name: string) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  const members = await groups.getGroupMembers(groupId);
  const me = members.find((m) => m.email === email);
  if (!me || me.role !== "admin") return { ok: false, error: "Admins only." };
  const cleanName = cleanText(name, 80);
  if (!cleanName) return { ok: false, error: "Please enter a group name." };
  const before = await groups.getGroup(groupId);
  if (!before) return { ok: false, error: "Group not found." };
  const changed = await groups.renameGroup(groupId, cleanName, email);
  if (!changed) return { ok: true, message: "Name unchanged." };
  try {
    const actor = await prisma.appUser.findUnique({ where: { email } });
    await notifyGroup({
      groupId,
      actorEmail: email,
      type: "group_renamed",
      message: `${await nameForOthers(actor, email)} renamed the group "${before.name}" to "${cleanName}"`,
    });
  } catch (err) {
    console.error("Rename notification failed:", err);
  }
  revalidateGroupViews();
  return { ok: true, message: `Group renamed to "${cleanName}".` };
}

/**
 * Adds one person by address, typed or picked from contacts. Someone with an
 * account joins at once; anyone else gets an invite. `result` tells the
 * contact list what the row became.
 */
export async function inviteAction(groupId: string, inviteEmail: string) {
  const fail = (message: string) => ({ ok: false, level: "error" as const, message, result: null });
  const email = await requireEmail();
  if (!email) return fail("Not signed in.");
  if (!(await groups.isGroupMember(groupId, email))) return fail("You are not a member of this group.");

  const target = typeof inviteEmail === "string" ? inviteEmail.trim().toLowerCase() : "";
  if (!isValidEmail(target)) return fail("Please enter a valid email address.");
  if (await overHourlyCap(email)) return fail("Too many invites in the last hour. Please try again later.");

  const result = await groups.addOrInvite(groupId, target, email);
  if (result === "already_member")
    return { ok: true, level: "warning" as const, message: "That person is already a member of this group.", result };
  if (result === "already_invited")
    return { ok: true, level: "warning" as const, message: "A pending invite already exists for that email.", result };

  const group = await groups.getGroup(groupId);
  const groupName = group?.name ?? "the group";
  // Identify the inviter by display name + masked address — never the raw
  // email — since the recipient may be a stranger or a mistyped address.
  const inviter = await prisma.appUser.findUnique({ where: { email } });
  const inviterMasked = await maskedEmailFor(email);
  const inviterName = displayNameFor(inviter, "A member");
  const inviterLabel = inviterMasked ? `${inviterName} (${inviterMasked})` : inviterName;

  if (result === "added") {
    // Everyone else in the group, the new member included, is told.
    try {
      const addedId = await emailId(target);
      const added = await prisma.appUser.findUnique({ where: { email: addedId } });
      await notifyGroup({
        groupId,
        actorEmail: email,
        type: "member_added",
        message: `${await nameForOthers(inviter, email)} added ${await nameForOthers(added, addedId)} to the group "${groupName}"`,
      });
    } catch (err) {
      console.error("Member-added notification failed:", err);
    }
    const sent = await sendAddedEmail(target, groupName, inviterLabel);
    if (!sent.ok) console.error("Added email failed:", sent.error);
    revalidateGroupViews();
    return { ok: true, level: "success" as const, message: `${target} has an account and was added to the group.`, result };
  }

  const sent = await sendInviteEmail(target, groupName, inviterLabel);
  revalidateGroupViews();
  if (sent.ok)
    return { ok: true, level: "success" as const, message: `Invite recorded and email sent to ${target}.`, result };
  // Log the SMTP details server-side only; the browser gets a generic message.
  console.error("Invite email failed:", sent.error);
  return {
    ok: true,
    level: "error" as const,
    message: `Invite recorded for ${target}, but the notification email could not be sent.`,
    result,
  };
}

/** Adds, invites and join links made by one person in the last hour, against the cap. */
async function overHourlyCap(email: string): Promise<boolean> {
  const [invites, links] = await Promise.all([
    prisma.groupInvite.count({
      where: { invitedBy: email, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
    }),
    // No table yet (db/2026_11_group_join_links.sql not run): no links to count.
    recentJoinLinkCount(email).catch(() => 0),
  ]);
  return invites + links >= INVITES_PER_HOUR;
}

/**
 * How picked addresses stand with the group, in the order given, so each
 * contact shows Add, Invite, Member or Invited. Members only.
 */
export async function contactStatusAction(groupId: string, emails: string[]) {
  const email = await requireEmail();
  if (!email || !(await groups.isGroupMember(groupId, email))) return { ok: false as const, statuses: [] };
  if (!Array.isArray(emails) || emails.length > MAX_STATUS_EMAILS || !emails.every((e) => typeof e === "string" && isValidEmail(e)))
    return { ok: false as const, statuses: [] };
  return { ok: true as const, statuses: await groups.contactStatuses(groupId, emails) };
}

/**
 * The member's Google contacts with how each stands with the group.
 * `needsConsent`: Google has not been asked yet, or its permission ran out.
 */
export async function listGoogleContactsAction(groupId: string) {
  const none = { ok: false as const, needsConsent: false, rows: [], statuses: [] };
  const email = await requireEmail();
  if (!email || !(await groups.isGroupMember(groupId, email))) return none;
  const jar = await cookies();
  const token = openToken(jar.get(TOKEN_COOKIE)?.value, email);
  if (!token) return { ...none, needsConsent: true };
  let found: Awaited<ReturnType<typeof fetchGoogleContacts>>;
  try {
    found = await fetchGoogleContacts(token);
  } catch (e) {
    console.error("[contacts] fetch failed:", e instanceof Error ? e.message : e);
    return none;
  }
  if (!found.ok) {
    if (found.reason !== "denied") return none;
    jar.delete(TOKEN_COOKIE);
    return { ...none, needsConsent: true };
  }
  const withEmail = found.rows.flatMap((r) => r.email ?? []);
  const statuses = await groups.contactStatuses(groupId, withEmail);
  return { ok: true as const, needsConsent: false, rows: found.rows, statuses: Object.fromEntries(withEmail.map((e, i) => [e, statuses[i]])) };
}

/** Makes a join link to share. Any member may; it counts toward the hourly cap. */
export async function createJoinLinkAction(groupId: string) {
  const email = await requireEmail();
  if (!email) return { ok: false as const, error: "Not signed in." };
  if (!(await groups.isGroupMember(groupId, email))) return { ok: false as const, error: "You are not a member of this group." };
  if (await overHourlyCap(email)) return { ok: false as const, error: "Too many invites in the last hour. Please try again later." };
  try {
    const token = await createJoinLink(groupId, email);
    revalidateGroupViews();
    return { ok: true as const, path: joinPath(token) };
  } catch (e) {
    console.error("[join links] not created:", e instanceof Error ? e.message : e);
    return { ok: false as const, error: "Join links are not available right now." };
  }
}

export async function revokeJoinLinkAction(groupId: string, linkId: number) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(linkId)) return { ok: false, error: "Invalid link." };
  const members = await groups.getGroupMembers(groupId);
  const me = members.find((m) => m.email === email);
  if (!me || me.role !== "admin") return { ok: false, error: "Admins only." };
  await revokeJoinLink(groupId, linkId);
  revalidateGroupViews();
  return { ok: true };
}

/** Joins a group with a shared link, then opens the group. */
export async function joinWithLinkAction(token: string) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  const res = await redeemJoinLink(typeof token === "string" ? token : "", email).catch((e) => {
    console.error("[join links] not redeemed:", e instanceof Error ? e.message : e);
    return { status: "invalid" as const };
  });
  if (res.status === "invalid") return { ok: false, error: "This link is no longer valid. Ask for a new one." };
  if (res.status === "joined") {
    try {
      const [me, creator] = await Promise.all([
        prisma.appUser.findUnique({ where: { email } }),
        prisma.appUser.findUnique({ where: { email: res.createdBy } }),
      ]);
      await notifyGroup({
        groupId: res.groupId,
        actorEmail: email,
        type: "member_joined",
        message: `${await nameForOthers(me, email)} joined with a link shared by ${await nameForOthers(creator, res.createdBy)}`,
      });
    } catch (err) {
      console.error("Member-joined notification failed:", err);
    }
    revalidateGroupViews();
  }
  redirect(`/g/${encodeURIComponent(res.groupId)}`);
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

// Leave and delete run from the group screen, which stops existing for the
// user afterwards: the redirect lands them home in the same round trip.
export async function leaveGroupAction(groupId: string) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  await groups.leaveGroup(groupId, email);
  revalidateGroupViews();
  redirect("/");
}

export async function deleteGroupAction(groupId: string) {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  const group = await groups.getGroup(groupId);
  // Still a member too: a creator who left or was removed no longer has a say.
  if (!group || group.createdBy !== email || !(await groups.isGroupMember(groupId, email)))
    return { ok: false, error: "Only the creator can delete this group." };
  await groups.deleteGroup(groupId);
  revalidateGroupViews();
  redirect("/");
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
