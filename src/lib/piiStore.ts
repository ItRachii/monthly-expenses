// Encrypted storage of email addresses (server only). The address is kept in
// exactly two places, both AES-256-GCM encrypted under a key derived from
// PII_SECRET: app_users.email_enc and group_invites.invited_email_enc.
// Everything else stores the user id from piiCrypto.emailId().

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import { normalizeEmail, piiSecret } from "./piiCrypto";
import { maskEmail } from "./pii";

const VERSION = "v1";

function encKey(): Buffer {
  return createHash("sha256").update("email-enc-v1\n" + piiSecret()).digest();
}

/** "v1.<base64url(iv | tag | ciphertext)>" */
export function encryptEmail(email: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(normalizeEmail(email), "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url")}`;
}

/** The address, or null when missing or unreadable (wrong key, tampered). */
export function decryptEmail(blob: string | null | undefined): string | null {
  if (!blob?.startsWith(`${VERSION}.`)) return null;
  try {
    const raw = Buffer.from(blob.slice(VERSION.length + 1), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", encKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Masked addresses ("ra•••@g•••.com") for user ids, from registered users and
 * pending invites. Ids with no readable address are left out.
 */
export async function maskedEmailsFor(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const [users, invites] = await Promise.all([
    prisma.appUser.findMany({
      where: { email: { in: unique } },
      select: { email: true, emailEnc: true },
    }),
    prisma.groupInvite.findMany({
      where: { invitedEmail: { in: unique } },
      select: { invitedEmail: true, invitedEmailEnc: true },
    }),
  ]);
  for (const inv of invites) {
    const plain = decryptEmail(inv.invitedEmailEnc);
    if (plain) out.set(inv.invitedEmail, maskEmail(plain));
  }
  for (const u of users) {
    const plain = decryptEmail(u.emailEnc);
    if (plain) out.set(u.email, maskEmail(plain));
  }
  return out;
}

export async function maskedEmailFor(id: string): Promise<string | null> {
  return (await maskedEmailsFor([id])).get(id) ?? null;
}
