import {
  getGroupInvites,
  getGroupMembers,
  getGroupNameHistory,
  type GroupDTO,
} from "./groups";
import { wireKey } from "./wire";

/** Everything the group settings UI needs. Emails of members never leave the server. */
export interface GroupView {
  id: string;
  name: string;
  description: string | null;
  role: string;
  isAdmin: boolean;
  isCreator: boolean;
  members: { key: string; displayName: string; role: string; isSelf: boolean }[];
  /** Invitees by masked address only. */
  pendingInvites: { id: number; invitedEmail: string }[];
  /** SCD Type 2 name history, newest first. validTo is null for the current name. */
  nameHistory: { name: string; validFrom: string; validTo: string | null }[];
}

/** Builds the settings view of one group for the signed-in user. */
export async function buildGroupView(g: GroupDTO, userEmail: string): Promise<GroupView> {
  const isAdmin = g.role === "admin";
  const [members, nameHistory, invites] = await Promise.all([
    getGroupMembers(g.id),
    getGroupNameHistory(g.id),
    isAdmin ? getGroupInvites(g.id) : Promise.resolve([]),
  ]);
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    role: g.role ?? "member",
    isAdmin,
    isCreator: g.createdBy === userEmail,
    // Members ship with opaque, group-scoped keys only.
    members: members.map((m) => ({
      key: wireKey(g.id, m.email),
      displayName: m.displayName,
      role: m.role,
      isSelf: m.email === userEmail,
    })),
    pendingInvites: invites
      .filter((i) => i.status === "pending")
      .map((i) => ({ id: i.id, invitedEmail: i.invitedEmailMasked })),
    nameHistory,
  };
}
