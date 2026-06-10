// "Wire" mapping: what the server is allowed to send to client components.
//
// Member/participant emails are PII and also double as join keys in the
// expenses/settlements tables (payer, split, settled_by). Client components
// never need the raw address - they need a stable token to filter/aggregate
// by and a display label. So before any row or member list crosses to the
// client, emails are replaced with an opaque member KEY and a display name.
//
// A key is an HMAC of (scope, email) under a server-only secret, so:
//   - the client only ever sees the key, never the email;
//   - the server reproduces the key deterministically (buildWire at render
//     time, emailForKey inside the action) to map a key back to an email;
//   - keys are scoped per context (group id), so the same person in two
//     different groups gets different keys and cannot be correlated;
//   - keys are unguessable without the secret, so a client cannot enumerate
//     them back to addresses.
//
// Unregistered invitees have no display name; their fallback would be the raw
// email, so buildWire masks any label that still looks like an address.

import { createHmac } from "crypto";
import type { MemberDTO } from "./groups";
import type { ExpenseDTO } from "./expenses";
import type { SettlementDTO } from "./settlements";
import { SPLIT_EQUAL } from "./constants";
import { maskEmail, looksLikeEmail } from "./pii";

// AUTH_SECRET is always set in any environment where auth works. The dev
// fallback only keeps local builds without a secret from throwing.
const KEY_SECRET = process.env.AUTH_SECRET || "insecure-dev-wire-secret";

// Domain separator between scope and email. Newline cannot appear in either a
// group id / "personal" or an email address, so keys are unambiguous.
const SEP = "\n";

/** Opaque, unguessable, scope-bound token for an email. Server-side only. */
export function wireKey(scope: string, email: string): string {
  const mac = createHmac("sha256", KEY_SECRET);
  mac.update(scope + SEP + email.toLowerCase());
  return "k" + mac.digest("hex").slice(0, 20);
}

export interface WireMember {
  key: string;
  displayName: string;
  role: string;
  isSelf: boolean;
}

export interface Wire {
  /** Client-safe member list (opaque keys, no emails). */
  members: WireMember[];
  /** key -> display name, for labelling row values on the client. */
  nameMap: Record<string, string>;
  /** Server-side only: maps a stored email to its wire key. */
  toKey: (email: string) => string;
}

function safeLabel(displayName: string, email: string): string {
  return displayName && !looksLikeEmail(displayName)
    ? displayName
    : maskEmail(email);
}

export function buildWire(scope: string, members: MemberDTO[], selfEmail: string): Wire {
  const wireMembers = members.map((m) => ({
    key: wireKey(scope, m.email),
    displayName: safeLabel(m.displayName, m.email),
    role: m.role,
    isSelf: m.email === selfEmail,
  }));
  const nameMap: Record<string, string> = Object.fromEntries(
    wireMembers.map((w) => [w.key, w.displayName]),
  );
  const toKey = (email: string) => {
    const key = wireKey(scope, email);
    // A value not in the participant list (e.g. someone who has since left but
    // paid a past expense): surface a masked label, never the raw address.
    if (!(key in nameMap)) nameMap[key] = maskEmail(email);
    return key;
  };
  return { members: wireMembers, nameMap, toKey };
}

/** Personal context: the only person is the signed-in user. */
export function buildPersonalWire(selfEmail: string, displayName: string): Wire {
  const SELF_KEY = "me";
  const nameMap: Record<string, string> = { [SELF_KEY]: displayName };
  const toKey = (email: string) => {
    if (email === selfEmail) return SELF_KEY;
    const key = wireKey("personal", email);
    if (!(key in nameMap)) nameMap[key] = maskEmail(email);
    return key;
  };
  return { members: [], nameMap, toKey };
}

/** Resolves a wire key sent back by a client to a participant's email. */
export function emailForKey(
  scope: string,
  members: MemberDTO[],
  key: string,
): string | null {
  const m = members.find((x) => wireKey(scope, x.email) === key);
  return m ? m.email : null;
}

/** Replaces payer/split emails with wire keys before rows go to the client. */
export function maskExpenses(rows: ExpenseDTO[], wire: Wire): ExpenseDTO[] {
  return rows.map((r) => ({
    ...r,
    payer: wire.toKey(r.payer),
    split: r.split === SPLIT_EQUAL ? r.split : wire.toKey(r.split),
  }));
}

/** Replaces settledBy emails with wire keys before rows go to the client. */
export function maskSettlements(rows: SettlementDTO[], wire: Wire): SettlementDTO[] {
  return rows.map((r) => ({ ...r, settledBy: wire.toKey(r.settledBy) }));
}
