// Join links (server only): a link a member shares so that whoever opens it
// and signs in joins the group. See db/2026_11_group_join_links.sql.

import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import { joinGroup, lockMembers } from "./groups";
import { nameForOthers } from "./users";
import { JOIN_LINK_DAYS, JOIN_LINK_MAX_USES, isJoinToken, joinLinkState } from "./contacts";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Makes a link and returns its token: the only time the token exists in full. */
export async function createJoinLink(groupId: string, createdBy: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await prisma.groupJoinLink.create({
    data: {
      groupId,
      tokenHash: hashToken(token),
      createdBy,
      createdAt: now,
      expiresAt: new Date(now.getTime() + JOIN_LINK_DAYS * 24 * 60 * 60 * 1000),
      maxUses: JOIN_LINK_MAX_USES,
    },
  });
  return token;
}

/** Links this person made in the last hour, for the hourly cap. */
export async function recentJoinLinkCount(createdBy: string): Promise<number> {
  return prisma.groupJoinLink.count({
    where: { createdBy, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
}

export interface JoinLinkDTO {
  id: number;
  /** Name of the member who made it, never an address or id. */
  sharedBy: string;
  useCount: number;
  maxUses: number;
  expiresAt: string;
}

/**
 * Links of a group that can still be used. Empty when the table is not
 * there yet, so group settings keep working before the SQL is run.
 */
export async function getOpenJoinLinks(groupId: string): Promise<JoinLinkDTO[]> {
  try {
    const now = new Date();
    const links = (
      await prisma.groupJoinLink.findMany({
        where: { groupId, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
      })
    ).filter((l) => joinLinkState(l, now) === "open");
    const users = await prisma.appUser.findMany({ where: { email: { in: links.map((l) => l.createdBy) } } });
    const byId = new Map(users.map((u) => [u.email, u]));
    return Promise.all(
      links.map(async (l) => ({
        id: l.id,
        sharedBy: await nameForOthers(byId.get(l.createdBy) ?? null, l.createdBy),
        useCount: l.useCount,
        maxUses: l.maxUses,
        expiresAt: l.expiresAt.toISOString(),
      })),
    );
  } catch (e) {
    console.error("[join links] not listed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Scoped to the group the caller is authorized for, like cancelInvite. */
export async function revokeJoinLink(groupId: string, id: number): Promise<void> {
  await prisma.groupJoinLink.updateMany({ where: { id, groupId, revokedAt: null }, data: { revokedAt: new Date() } });
}

async function openLink(token: string) {
  if (!isJoinToken(token)) return null;
  const link = await prisma.groupJoinLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { group: { select: { id: true, name: true, active: true } } },
  });
  if (!link || link.group.active !== 1 || joinLinkState(link, new Date()) !== "open") return null;
  return link;
}

/**
 * What the join page shows for a link that can still be used; null for any
 * other link (unknown, revoked, expired, full, deleted group), so the page
 * says the same thing for all of them.
 */
export async function previewJoinLink(
  token: string,
  userEmail: string,
): Promise<{ groupId: string; groupName: string; sharedBy: string; isMember: boolean } | null> {
  const link = await openLink(token);
  if (!link) return null;
  const [creator, member] = await Promise.all([
    prisma.appUser.findUnique({ where: { email: link.createdBy } }),
    prisma.groupMember.findFirst({ where: { groupId: link.groupId, email: userEmail }, select: { id: true } }),
  ]);
  return {
    groupId: link.groupId,
    groupName: link.group.name,
    sharedBy: await nameForOthers(creator, link.createdBy),
    isMember: member !== null,
  };
}

export type RedeemResult =
  | { status: "joined" | "already_member"; groupId: string; createdBy: string }
  | { status: "invalid" };

/** Joins the group with a link. A use is counted only when someone actually joins. */
export async function redeemJoinLink(token: string, userEmail: string): Promise<RedeemResult> {
  const link = await openLink(token);
  if (!link) return { status: "invalid" };
  const { groupId, createdBy } = link;

  return prisma.$transaction(async (tx) => {
    // Under the group's lock: the same person joining twice at once is added
    // once, and two people racing for the last place cannot both get it.
    await lockMembers(tx, groupId);
    if (await tx.groupMember.findFirst({ where: { groupId, email: userEmail } }))
      return { status: "already_member" as const, groupId, createdBy };

    const now = new Date();
    // Conditional on still open, so a link revoked or filled meanwhile fails.
    const used = await tx.$executeRaw`
      update public.group_join_links set use_count = use_count + 1
      where id = ${link.id} and revoked_at is null and expires_at > ${now} and use_count < max_uses`;
    if (used === 0) return { status: "invalid" as const };

    await joinGroup(tx, groupId, userEmail, now);
    // An invite to this group that was still open is now answered.
    await tx.groupInvite.updateMany({
      where: { groupId, invitedEmail: userEmail, status: "pending" },
      data: { status: "accepted", respondedAt: now },
    });
    return { status: "joined" as const, groupId, createdBy };
  });
}
