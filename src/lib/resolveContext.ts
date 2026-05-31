import { getUserGroups, getGroupMembers, type MemberDTO } from "./groups";
import { getUserNames } from "./users";
import type { Context } from "./context";

export interface ResolvedContext {
  ctxValue: string; // "personal" or a group id
  isPersonal: boolean;
  context: Context;
  options: { value: string; label: string }[];
  /** role -> name (personal) or email -> name (group) */
  nameMap: Record<string, string>;
  members: MemberDTO[];
  error?: string;
}

/**
 * Resolves the Personal/Group selector used by the expense pages. Mirrors the
 * context-selector block repeated across the Streamlit pages.
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

  if (wanted === "personal") {
    return {
      ctxValue: "personal",
      isPersonal: true,
      context: { kind: "personal", email },
      options,
      nameMap: await getUserNames(),
      members: [],
    };
  }

  const group = groups.find((g) => g.id === wanted);
  if (!group) {
    return {
      ctxValue: "personal",
      isPersonal: true,
      context: { kind: "personal", email },
      options,
      nameMap: await getUserNames(),
      members: [],
      error: "You are not a member of this group.",
    };
  }

  const members = await getGroupMembers(wanted);
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
