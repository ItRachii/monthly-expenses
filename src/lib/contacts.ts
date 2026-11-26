// Adding people to a group from contacts: the parts with no database, network
// or browser in them, shared by the server, the picker and the middleware.
//
// Contacts come from Google Contacts (People API) or the phone's contact
// picker. Only names, email addresses and photos are read; phone numbers are
// never requested, since the app has no use for them.

/** One line in the picker. A contact with two addresses is two rows. */
export interface ContactRow {
  /** Stable within one list, for React keys and avatars. */
  id: string;
  name: string;
  /** Lowercased address, or null when the contact has none saved. */
  email: string | null;
  photo: string | null;
}

/** How an address stands with one group. */
export type ContactStatus = "member" | "invited" | "registered" | "new";

/** What the row's button does. */
export type RowAction = "add" | "invite" | "member" | "invited" | "share";

export const MAX_CONTACTS = 2000;
/** Addresses whose standing can be asked for in one call. */
export const MAX_STATUS_EMAILS = 1000;

export const JOIN_LINK_DAYS = 7;
export const JOIN_LINK_MAX_USES = 25;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NO_NAME = "No name";

function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

function cleanName(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
}

/** Google photo URLs only, so a contact cannot make the page load any image. */
function cleanPhoto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname === "lh3.googleusercontent.com" ? u.toString() : null;
  } catch {
    return null;
  }
}

interface Raw {
  name: string;
  emails: string[];
  photo: string | null;
}

/**
 * Rows for the picker: one per address, addresses listed once, then people
 * with no address (once per name). Sorted by name. Nameless people with no
 * address are dropped: there is nothing to show or act on.
 */
function toRows(people: Raw[]): ContactRow[] {
  const byEmail = new Map<string, Omit<ContactRow, "id">>();
  const noEmail = new Map<string, Omit<ContactRow, "id">>();
  for (const p of people) {
    if (p.emails.length === 0) {
      if (p.name && !noEmail.has(p.name.toLowerCase()))
        noEmail.set(p.name.toLowerCase(), { name: p.name, email: null, photo: p.photo });
      continue;
    }
    for (const email of p.emails) {
      const seen = byEmail.get(email);
      // The same address under two contacts: keep the one that has a name.
      if (!seen || (!seen.name && p.name)) byEmail.set(email, { name: p.name, email, photo: p.photo ?? seen?.photo ?? null });
    }
  }
  const rows = [...byEmail.values(), ...noEmail.values()]
    .map((r) => ({ ...r, name: r.name || r.email || NO_NAME }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.email ?? "").localeCompare(b.email ?? ""))
    .slice(0, MAX_CONTACTS);
  return rows.map((r, i) => ({ id: `c${i}`, ...r }));
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function field(o: unknown, key: string): unknown {
  return o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined;
}

/** The `connections` of a People API response (names, emailAddresses, photos). */
export function parsePeople(connections: unknown): ContactRow[] {
  return toRows(
    asArray(connections).map((person) => {
      const photo = asArray(field(person, "photos")).find((ph) => field(ph, "default") !== true);
      return {
        name: cleanName(field(asArray(field(person, "names"))[0], "displayName")),
        emails: asArray(field(person, "emailAddresses")).flatMap((e) => cleanEmail(field(e, "value")) ?? []),
        photo: cleanPhoto(field(photo, "url")),
      };
    }),
  );
}

/** What navigator.contacts.select(["name", "email"]) resolves with. */
export function parsePicked(picked: unknown): ContactRow[] {
  return toRows(
    asArray(picked).map((c) => ({
      name: cleanName(asArray(field(c, "name"))[0]),
      emails: asArray(field(c, "email")).flatMap((e) => cleanEmail(e) ?? []),
      photo: null,
    })),
  );
}

export function rowAction(email: string | null, status: ContactStatus | undefined): RowAction {
  if (!email) return "share";
  if (status === "member") return "member";
  if (status === "invited") return "invited";
  return status === "registered" ? "add" : "invite";
}

/** Rows matching what was typed, by name or address. */
export function filterRows(rows: ContactRow[], query: string): ContactRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q) || (r.email ?? "").includes(q));
}

// A join link's token: 32 random bytes, base64url.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isJoinToken(s: unknown): s is string {
  return typeof s === "string" && TOKEN_RE.test(s);
}

export function joinPath(token: string): string {
  return `/join/${token}`;
}

/**
 * Where sign-in may send someone afterwards: a join link and nothing else,
 * so a crafted login address cannot bounce people to another site or page.
 */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== "string" || !next.startsWith("/join/")) return null;
  const token = next.slice("/join/".length);
  return isJoinToken(token) ? joinPath(token) : null;
}

/** A group id as it may appear in an address (uuid today). */
export function isGroupIdShape(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9-]{1,64}$/.test(s);
}

/** The message that goes with a shared join link. */
export function shareText(groupName: string, url: string): string {
  const name = groupName.replace(/\s+/g, " ").trim().slice(0, 80);
  return `Join "${name}" on Ledger to split expenses with us: ${url}`;
}

export type JoinLinkState = "open" | "revoked" | "expired" | "full";

export function joinLinkState(
  link: { expiresAt: Date; revokedAt: Date | null; useCount: number; maxUses: number },
  now: Date,
): JoinLinkState {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  return link.useCount >= link.maxUses ? "full" : "open";
}
