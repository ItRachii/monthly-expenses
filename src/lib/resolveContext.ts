import { getUserGroups, getGroupParticipants, type MemberDTO } from "./groups";
import { getAppUser, displayNameFor } from "./users";
import type { Context } from "./context";

export interface ResolvedContext {
  ctxValue: string; // "personal" or a group id
  isPersonal: boolean;
  context: Context;
  options: { value: string; label: string }[];
  /** email -> display name. Personal is solo, so this is just the user. */
  nameMap: Record<string, string>;
  members: MemberDTO[];
  error?: string;
}

/**
 * Resolves the Personal/Group selector used by the expense pages. Personal mode
 * is the logged-in user's own (solo) ledger; groups handle multi-person splits.
 */
export async function resolveContext(
  email: string,
  ctxParam?: string,
): Promise<ResolvedContext> {
  const groups = await getUserGroups(email);
  const options = [
    { value: "personal", label: "Personal" },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
  ];

  const wanted = ctxParam && ctxParam !== "personal" ? ctxParam : "personal";

  async function personal(error?: string): Promise<ResolvedContext> {
    const appUser = await getAppUser(email);
    const displayName = displayNameFor(appUser, email);
    return {
      ctxValue: "personal",
      isPersonal: true,
      context: { kind: "personal", email },
      options,
      nameMap: { [email]: displayName },
      members: [],
      error,
    };
  }

  if (wanted === "personal") {
    return personal();
  }

  const group = groups.find((g) => g.id === wanted);
  if (!group) {
    return personal("You are not a member of this group.");
  }

  const members = await getGroupParticipants(wanted);
  const nameMap: Record<string, string> = {};
  for (const m of members) nameMap[m.email] = m.displayName;

  return {
    ctxValue: wanted,
    isPersonal: false,
    context: { kind: "group", groupId: wanted },
    options,
    nameMap,
    members,
  };
}
