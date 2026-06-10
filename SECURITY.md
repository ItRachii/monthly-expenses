# Security Model

How this app protects data and PII. PII here means member email addresses and
names; financial rows (expenses, settlements) are sensitive by association.

## Authentication & authorization

- Google OAuth via Auth.js v5. Sessions are stateless JWTs, **encrypted**
  (JWE) and stored in an HttpOnly, SameSite=Lax cookie (Secure in prod).
- `src/middleware.ts` rejects unauthenticated requests at the edge; every page
  additionally calls `requireUser()` and every server action re-checks the
  session — no action trusts client state.
- Authorization is enforced server-side per action:
  - expenses: only the owner (personal) or a group member (group) can
    add/edit/delete; legacy rows with neither owner nor group are immutable;
  - invites: respond only as the invited email; cancel only as a group admin,
    and the delete is **scoped to that group's id** so invite ids from other
    groups are inert;
  - member removal: admins only, by opaque member key, never yourself;
  - group deletion: creator only.

## Input validation

All server actions validate before writing (`src/lib/validate.ts`): dates
(`YYYY-MM-DD`, real calendar dates), months (`YYYY-MM`), amounts (finite,
positive, capped — rejects `Infinity`/`NaN`), categories (whitelist), emails
(shape + length), and free text (control characters stripped, length capped).
Numeric ids are integer-checked before any DB lookup.

## PII masking — in transit

- **TLS everywhere**: HSTS (2 years, preload) forces HTTPS; database URLs
  carry `sslmode=require`; SMTP uses STARTTLS with `requireTLS` (or implicit
  TLS on 465) and fails closed rather than sending plaintext.
- **Client payload minimization** (`src/lib/wire.ts`): client components never
  receive other members' email addresses. Before rows or member lists cross the
  server/client boundary, every payer/split/settledBy/member email is replaced
  with an opaque **member key** — an HMAC of `(group, email)` under the server
  secret — plus a display name. Server actions accept those keys back and
  resolve them server-side. Keys are unguessable (you can't recover the email)
  and group-scoped (the same person in two groups gets different keys, so they
  can't be correlated). People no longer in the group degrade to a masked
  label (`ra•••@g•••.com`), as do unregistered invitees who have no name yet.
- Invite banners show the inviter as display name + masked email; outbound
  invite emails identify the inviter the same way — the raw address is never
  sent to a possibly-mistyped recipient. Notification DTOs exclude the actor's
  email entirely.
- `Referrer-Policy: no-referrer` so authenticated URLs never leak to external
  sites; CSP restricts scripts/connections to self.
- Exception (deliberate): a group admin's *Pending Invites* panel shows the
  full invited addresses — admins typed those addresses and need them to manage
  invites. Visible only to admins of that group.

## PII masking — at rest

- Supabase encrypts the database volume at rest (AES-256); backups likewise.
- The session cookie is encrypted (JWE), not merely signed.
- Notification messages are built from display names (masked-email fallback),
  so stored messages never contain raw addresses.
- SMTP failures are logged server-side and never echoed to the browser.
- **Known trade-off**: email addresses remain plaintext *columns* because they
  are the join keys of the legacy schema (`payer`, `split`, `owner_email`,
  `group_members.email`, ...). Encrypting them app-side would break lookups and
  require a full data migration. If column-level protection becomes a
  requirement, migrate to numeric user ids + a single encrypted email column
  (or Supabase `pgsodium`/TCE) as a dedicated project.

## Abuse controls

- Invite emails are rate-limited (20/hour per inviter) so the mailer can't be
  used as a spam relay; invite email HTML-escapes all user input (group name,
  inviter label) to block HTML/phishing injection and strips CRLF from the
  subject.
- `X-Frame-Options: DENY` + `frame-ancestors 'none'` (no clickjacking);
  `X-Content-Type-Options: nosniff`; `X-Powered-By` removed.

## Secrets

- `.env` is gitignored; only `.env.example` (placeholders) is tracked.
- `AUTH_SECRET` (also the HMAC key for member keys), Google OAuth secret, DB
  password, and the SMTP app password live exclusively in environment
  variables (Vercel project settings in prod).
- Rotate any secret that ever lands in a chat, commit, or log.

## Reporting

Open a private GitHub security advisory or contact the repo owner directly.
