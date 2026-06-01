import { prisma } from "./prisma";

// Ported from legacy-streamlit/utils/auth.py (register_user_if_needed) and
// pages/5_Profile.py. The legacy system-role concept has been removed:
// Personal mode is now the logged-in user's own (solo) ledger.

export async function registerUserIfNeeded(email: string, name: string) {
  const existing = await prisma.appUser.findUnique({ where: { email } });
  if (existing) return existing;

  const firstName = (name || "User").trim().split(/\s+/)[0] || "User";

  try {
    // system_role is a legacy NOT NULL column we keep to avoid a migration;
    // it is no longer used in logic, so store an empty string.
    return await prisma.appUser.create({ data: { email, firstName, systemRole: "" } });
  } catch {
    // Lost a create race with a concurrent request — re-read.
    return prisma.appUser.findUnique({ where: { email } });
  }
}

export function displayNameFor(
  user: { username: string | null; firstName: string } | null,
  fallback: string,
): string {
  if (!user) return fallback;
  if (user.username && user.username.trim()) return user.username.trim();
  if (user.firstName && user.firstName.trim()) return user.firstName.trim();
  return fallback;
}

export async function getAppUser(email: string) {
  return prisma.appUser.findUnique({ where: { email } });
}

export async function updateUsername(email: string, username: string | null) {
  return prisma.appUser.update({ where: { email }, data: { username } });
}
