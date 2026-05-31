import { requireUser } from "@/lib/session";
import {
  getPendingInvitesForUser,
  getUserGroups,
  getGroupMembers,
  getGroupInvites,
} from "@/lib/groups";
import { PendingInvites } from "@/components/PendingInvites";
import { GroupsManager, type GroupView } from "./GroupsManager";

export default async function GroupsPage() {
  const user = await requireUser();
  const pending = await getPendingInvitesForUser(user.email);
  const groups = await getUserGroups(user.email);

  const views: GroupView[] = await Promise.all(
    groups.map(async (g) => {
      const members = await getGroupMembers(g.id);
      const isAdmin = g.role === "admin";
      const pendingInvites = isAdmin
        ? (await getGroupInvites(g.id))
            .filter((i) => i.status === "pending")
            .map((i) => ({ id: i.id, invitedEmail: i.invitedEmail }))
        : [];
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        role: g.role ?? "member",
        isAdmin,
        isCreator: g.createdBy === user.email,
        members: members.map((m) => ({
          email: m.email,
          displayName: m.displayName,
          role: m.role,
        })),
        pendingInvites,
      };
    }),
  );

  return (
    <div className="space-y-6">
      <h1>👥 Groups</h1>
      {pending.length > 0 ? <PendingInvites invites={pending} /> : null}
      <GroupsManager email={user.email} groups={views} />
    </div>
  );
}
