import { prisma } from "./prisma";
import { emailId } from "./piiCrypto";
import { decryptEmail, encryptEmail } from "./piiStore";
import { ensurePiiMigrated } from "./piiMigration";

// Ported from legacy-streamlit/utils/auth.py (register_user_if_needed) and
// pages/5_Profile.py. The legacy system-role concept has been removed:
// Personal mode is now the logged-in user's own (solo) ledger.

function splitName(name: string) {
  const parts = (name || "User").trim().split(/\s+/);
  return { firstName: parts[0] || "User", lastName: parts.slice(1).join(" ") || null };
}

/**
 * Called once per Google sign-in, the only time the app sees the address:
 * creates the user's row, or refreshes its encrypted copy of the address.
 */
export async function upsertUserOnSignIn(email: string, name: string) {
  await ensurePiiMigrated();
  const id = await emailId(email);
  const emailEnc = encryptEmail(email);
  const now = new Date();
  await prisma.appUser.upsert({
    where: { email: id },
    // New users are asked for their income during onboarding.
    create: {
      email: id,
      emailEnc,
      ...splitName(name),
      systemRole: "",
      incomePrompt: "onboarding",
      lastSignInAt: now,
    },
    // lastSignInAt brings back an income popup the user put off until "later".
    update: { emailEnc, lastSignInAt: now },
  });
}

/** The user's own address, decrypted, for showing back to them. */
export function ownEmail(user: { emailEnc: string | null } | null): string | null {
  return decryptEmail(user?.emailEnc);
}

/** `email` is the user id (session.user.email). */
export async function registerUserIfNeeded(email: string, name: string) {
  const existing = await prisma.appUser.findUnique({ where: { email } });
  if (existing) return existing;

  // Normally created at sign-in (upsertUserOnSignIn). This fallback has no
  // address to encrypt; the next sign-in fills it in.
  const { firstName, lastName } = splitName(name);

  try {
    // system_role is a legacy NOT NULL column we keep to avoid a migration;
    // it is no longer used in logic, so store an empty string.
    return await prisma.appUser.create({
      data: { email, firstName, lastName, systemRole: "", incomePrompt: "onboarding" },
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
