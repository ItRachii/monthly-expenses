// Email -> user id. Every database column that used to hold an email address
// holds this id instead, so a database reader, a backup or the change log
// never sees an address.
//
// The id is "u_" + HMAC-SHA256(PII_SECRET, "email-id-v1\n" + lowercased email),
// base64url. It is stable, so it still works as a join key, and it cannot be
// reversed or brute-forced from a list of candidate addresses without the key.
//
// Web Crypto only: this runs in the edge middleware (via the Auth.js session
// callback) as well as in Node.

const PREFIX = "u_";
const LABEL = "email-id-v1\n";

/**
 * The PII key. Production must set PII_SECRET (and keep a copy: without it,
 * existing users cannot be matched on sign-in and stored addresses cannot be
 * decrypted). Local development falls back to a fixed dev key.
 */
export function piiSecret(): string {
  const s = process.env.PII_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV !== "production") return "insecure-dev-pii-secret";
  throw new Error("PII_SECRET is not set.");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True for a user id produced by emailId(). */
export function isUserId(s: string): boolean {
  return s.startsWith(PREFIX) && !s.includes("@");
}

let hmacKey: Promise<CryptoKey> | null = null;

function key(): Promise<CryptoKey> {
  hmacKey ??= crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(piiSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hmacKey;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The stored user id for an email address. Idempotent on ids. */
export async function emailId(email: string): Promise<string> {
  if (isUserId(email)) return email;
  const sig = await crypto.subtle.sign(
    "HMAC",
    await key(),
    new TextEncoder().encode(LABEL + normalizeEmail(email)),
  );
  return PREFIX + base64url(new Uint8Array(sig));
}
