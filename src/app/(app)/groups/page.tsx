import { requireUser } from "@/lib/session";
import { getPendingInvitesForUser, getSidebarGroups, getUserGroups } from "@/lib/groups";
import { getGroupBalancesForUser } from "@/lib/balances";
import { PendingInvites } from "@/components/PendingInvites";
import { GroupsManager } from "./GroupsManager";

export default async function GroupsPage() {
  const user = await requireUser();
  const [pending, groups, balances, recent] = await Promise.all([
    getPendingInvitesForUser(user.email),
    getUserGroups(user.email),
    getGroupBalancesForUser(user.email),
    getSidebarGroups(user.email),
  ]);
  const balanceOf = new Map(balances.groups.map((b) => [b.id, b]));
  const unreadOf = new Map(recent.map((r) => [r.id, r.unread]));

  return (
    <div className="space-y-6">
      <h1>Groups</h1>
      {pending.length > 0 ? <PendingInvites invites={pending} /> : null}
      <GroupsManager
        groups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          memberCount: balanceOf.get(g.id)?.memberCount ?? 0,
          net: balanceOf.get(g.id)?.net ?? 0,
          unread: unreadOf.get(g.id) ?? 0,
        }))}
      />
    </div>
  );
}
