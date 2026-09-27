import { requireUser } from "@/lib/session";
import { getPendingInvitesForUser, getUserGroups } from "@/lib/groups";
import { PendingInvites } from "@/components/PendingInvites";
import { GroupsManager } from "./GroupsManager";

export default async function GroupsPage() {
  const user = await requireUser();
  const [pending, groups] = await Promise.all([
    getPendingInvitesForUser(user.email),
    getUserGroups(user.email),
  ]);

  return (
    <div className="space-y-6">
      <h1>👥 Groups</h1>
      {pending.length > 0 ? <PendingInvites invites={pending} /> : null}
      <GroupsManager
        groups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          role: g.role ?? "member",
        }))}
      />
    </div>
  );
}
