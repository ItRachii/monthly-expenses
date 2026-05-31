import { prisma } from "./prisma";

// Ported from legacy-streamlit/utils/auth.py (register_user_if_needed,
// get_user_names) and pages/5_Profile.py.

export async function registerUserIfNeeded(email: string, name: string) {
  const existing = await prisma.appUser.findUnique({ where: { email } });
  if (existing) return existing;

  const firstName = (name || "User").trim().split(/\s+/)[0] || "User";
  const count = await prisma.appUser.count();
  const systemRole = count === 0 ? "Person A" : "Person B";

  try {
    return await prisma.appUser.create({ data: { email, firstName, systemRole } });
  } catch {
    // Lost a create race with a concurrent request — re-read.
    return prisma.appUser.findUnique({ where: { email } });
  }
}

/** Maps system roles to current display names, e.g. { "Person A": "Rachit" }. */
export async function getUserNames(): Promise<Record<string, string>> {
  const mapping: Record<string, string> = {
    "Person A": "Person A",
    "Person B": "Person B",
    "50-50": "50-50",
  };
  const users = await prisma.appUser.findMany();
  for (const u of users) {
    const display = u.username && u.username.trim() ? u.username.trim() : u.firstName;
    mapping[u.systemRole] = display;
  }
  return mapping;
}

export async function getAppUser(email: string) {
  return prisma.appUser.findUnique({ where: { email } });
}

export async function updateUsername(email: string, username: string | null) {
  return prisma.appUser.update({ where: { email }, data: { username } });
}
