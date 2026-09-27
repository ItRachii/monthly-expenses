import { requireUser } from "@/lib/session";
import { getPendingInvitesForUser, getUserGroups } from "@/lib/groups";
import { buildGroupView } from "@/lib/groupView";
import { PendingInvites } from "@/components/PendingInvites";
import { GroupsManager } from "./GroupsManager";

export default async function GroupsPage() {
  const user = await requireUser();
  const pending = await getPendingInvitesForUser(user.email);
  const groups = await getUserGroups(user.email);
  const views = await Promise.all(groups.map((g) => buildGroupView(g, user.email)));

  return (
    <div className="space-y-6">
      <h1>👥 Groups</h1>
      {pending.length > 0 ? <PendingInvites invites={pending} /> : null}
      <GroupsManager groups={views} />
    </div>
  );
}
