import { getUserGroups, getGroupParticipants, type MemberDTO } from "./groups";
import { getAppUser, displayNameFor } from "./users";
import { buildPersonalWire, buildWire, type Wire } from "./wire";
import type { Context } from "./context";

export interface ResolvedContext {
  ctxValue: string; // "personal" or a group id
  isPersonal: boolean;
  context: Context;
  options: { value: string; label: string }[];
  /**
   * Server-side participant list (contains emails). Use it for server logic
   * only — anything passed to a client component must come from `wire`.
   */
  members: MemberDTO[];
  /** Client-safe view: opaque member keys + display names, no emails. */
  wire: Wire;
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
    const displayName = displayNameFor(appUser, "You");
    return {
      ctxValue: "personal",
      isPersonal: true,
      context: { kind: "personal", email },
      options,
      members: [],
      wire: buildPersonalWire(email, displayName),
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

  // Participants = members + pending invitees (invitees can appear in splits
  // before accepting). The wire assigns each an opaque, group-scoped key.
  const members = await getGroupParticipants(wanted);

  return {
    ctxValue: wanted,
    isPersonal: false,
    context: { kind: "group", groupId: wanted },
    options,
    members,
    wire: buildWire(wanted, members, email),
  };
}
