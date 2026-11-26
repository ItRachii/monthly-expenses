// Google Contacts (server only). A member who presses "Google Contacts" is
// sent to Google to allow reading their contacts (contacts.readonly, asked
// for there and then, never at sign-in). Google's short-lived access token
// comes back and is kept in an encrypted, httpOnly cookie tied to that user:
// no refresh token is asked for and nothing is written to the database. The
// contacts are fetched when the picker opens, shown to their owner, and
// neither stored nor logged.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { MAX_CONTACTS, parsePeople, type ContactRow } from "./contacts";

export const CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
export const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const PEOPLE_ENDPOINT = "https://people.googleapis.com/v1/people/me/connections";

/** Holds the access token. Readable by server actions on any page. */
export const TOKEN_COOKIE = "gc_token";
/** Holds state and the PKCE verifier between start and callback. */
export const FLOW_COOKIE = "gc_flow";

type Fetch = typeof fetch;

function key(): Buffer {
  // AUTH_SECRET is set wherever sign-in works; the fallback is for local builds.
  const secret = process.env.AUTH_SECRET || "insecure-dev-contacts-secret";
  return createHash("sha256").update("contacts-token-v1\n" + secret).digest();
}

/** Encrypts the token together with whose it is and when it stops working. */
export function sealToken(accessToken: string, userId: string, expiresAt: number): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify({ t: accessToken, u: userId, e: expiresAt }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

/** The token, or null when missing, tampered with, expired or another user's. */
export function openToken(sealed: string | undefined, userId: string, now = Date.now()): string | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const v = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
    return typeof v.t === "string" && v.u === userId && typeof v.e === "number" && v.e > now ? v.t : null;
  } catch {
    return null;
  }
}

export function newFlow(): { state: string; verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(16).toString("base64url"),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

/** Where Google sends the member back to. Must be listed on the OAuth client. */
export function redirectUri(origin: string): string {
  return `${origin}/api/contacts/google/callback`;
}

/** The app's public origin: AUTH_URL when set, as for sign-in, else the request's. */
export function appOrigin(requestOrigin: string): string {
  try {
    if (process.env.AUTH_URL) return new URL(process.env.AUTH_URL).origin;
  } catch {
    // A malformed AUTH_URL: fall through to the request's origin.
  }
  return requestOrigin;
}

export function consentUrl(origin: string, flow: { state: string; challenge: string }): string {
  const u = new URL(AUTH_ENDPOINT);
  u.search = new URLSearchParams({
    client_id: process.env.AUTH_GOOGLE_ID ?? "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: CONTACTS_SCOPE,
    state: flow.state,
    code_challenge: flow.challenge,
    code_challenge_method: "S256",
    // No refresh token: access ends when the short-lived token does.
    access_type: "online",
  }).toString();
  return u.toString();
}

/** Trades the code Google sent back for an access token. Null when refused. */
export async function exchangeCode(
  code: string,
  verifier: string,
  origin: string,
  fetchImpl: Fetch = fetch,
): Promise<{ accessToken: string; expiresAt: number } | null> {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      client_id: process.env.AUTH_GOOGLE_ID ?? "",
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown; scope?: unknown };
  // Google lets people untick a permission: without contacts there is nothing to keep.
  if (typeof body.access_token !== "string" || typeof body.scope !== "string" || !body.scope.split(" ").includes(CONTACTS_SCOPE)) return null;
  const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  // A minute short, so a token is never used in its last moments.
  return { accessToken: body.access_token, expiresAt: Date.now() + (seconds - 60) * 1000 };
}

export type ContactsResult =
  | { ok: true; rows: ContactRow[] }
  /** The token no longer works: ask the member to allow access again. */
  | { ok: false; reason: "denied" }
  | { ok: false; reason: "failed" };

/** The member's contacts: names, addresses and photos only. */
export async function fetchGoogleContacts(accessToken: string, fetchImpl: Fetch = fetch): Promise<ContactsResult> {
  const people: unknown[] = [];
  let pageToken = "";
  // Google gives at most 1000 a page.
  for (let page = 0; page < Math.ceil(MAX_CONTACTS / 1000); page++) {
    const u = new URL(PEOPLE_ENDPOINT);
    u.search = new URLSearchParams({
      personFields: "names,emailAddresses,photos",
      pageSize: "1000",
      sortOrder: "FIRST_NAME_ASCENDING",
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const res = await fetchImpl(u, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (res.status === 401) return { ok: false, reason: "denied" };
    // Includes 403: the People API is not switched on for the Google project.
    if (!res.ok) return { ok: false, reason: "failed" };
    const body = (await res.json()) as { connections?: unknown; nextPageToken?: unknown };
    if (Array.isArray(body.connections)) people.push(...body.connections);
    if (typeof body.nextPageToken !== "string" || !body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return { ok: true, rows: parsePeople(people) };
}
