import { prisma } from "./prisma";

// Ported from legacy-streamlit/utils/auth.py (register_user_if_needed) and
// pages/5_Profile.py. The legacy system-role concept has been removed:
// Personal mode is now the logged-in user's own (solo) ledger.

export async function registerUserIfNeeded(email: string, name: string) {
  const existing = await prisma.appUser.findUnique({ where: { email } });
  if (existing) return existing;

  const parts = (name || "User").trim().split(/\s+/);
  const firstName = parts[0] || "User";
  const lastName = parts.slice(1).join(" ") || null;

  try {
    // system_role is a legacy NOT NULL column we keep to avoid a migration;
    // it is no longer used in logic, so store an empty string.
    return await prisma.appUser.create({
      data: { email, firstName, lastName, systemRole: "" },
    });
  } catch {
    // Lost a create race with a concurrent request — re-read.
    return prisma.appUser.findUnique({ where: { email } });
  }
}

/** "First Last" from the editable profile fields, or the fallback. */
export function displayNameFor(
  user: { firstName: string; lastName?: string | null } | null,
  fallback: string,
): string {
  if (!user) return fallback;
  const full = [user.firstName, user.lastName ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
  return full || fallback;
}

export async function getAppUser(email: string) {
  return prisma.appUser.findUnique({ where: { email } });
}

export async function updateName(email: string, firstName: string, lastName: string | null) {
  return prisma.appUser.update({ where: { email }, data: { firstName, lastName } });
}
