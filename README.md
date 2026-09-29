# Monthly Expense Tracker (Ledger)

Two-person and group expense tracker. Originally a Streamlit app, now a
**Next.js 15** app deployable to **Vercel** with Google sign-in.

The previous Streamlit version is preserved under [`legacy-streamlit/`](./legacy-streamlit).

## Stack

| Layer    | Tech                                    |
| -------- | --------------------------------------- |
| Frontend | Next.js 15 (App Router), React 19, Tailwind |
| Auth     | Auth.js v5 (`next-auth`), Google OIDC, JWT sessions |
| Database | Postgres via Prisma 6 (your existing tables) |
| Charts   | Recharts                                |
| Email    | Nodemailer (Gmail SMTP) for group invites |

## Local development

Needs Node 20 or newer and a Postgres you can write to. Never point a local
run at the production database: local runs are allowed to migrate data.

```bash
cp .env.example .env        # then fill in the values (see below)
npm install                 # also runs `prisma generate`
npm run db:setup-local      # creates the tables, the change-log trigger and the PII columns
npm run dev                 # http://localhost:3000
```

On Windows, `copy .env.example .env` replaces the first line; the rest is the same
in PowerShell or the Command Prompt.

### A local database

The quickest is Docker:

```bash
docker run --name ledger-pg -e POSTGRES_PASSWORD=ledger -p 5432:5432 -d postgres:16
```

Then in `.env`:

```
DATABASE_URL="postgresql://postgres:ledger@localhost:5432/postgres"
DIRECT_URL="postgresql://postgres:ledger@localhost:5432/postgres"
```

A free second Supabase project works too: use its pooler URLs as in
`.env.example`. `npm run db:setup-local` is safe to re-run.

### Environment variables

See [`.env.example`](./.env.example). Required: `DATABASE_URL`, `DIRECT_URL`,
`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `PII_SECRET`. SMTP vars
are optional (invite emails).

Generate a secret with `openssl rand -base64 32`, or in PowerShell:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

Use a different `PII_SECRET` locally than in production. The local database
holds only your test data, so it can be anything.

### Signing in locally

Sign-in is Google only. In Google Cloud Console → Credentials → your OAuth
client, add `http://localhost:3000/api/auth/callback/google` to the authorized
redirect URIs (the production URI stays). The same client id and secret then
work locally.

### Card statement import

How the import works, bank by bank, with every edge case seen so far:
[`docs/statements/`](./docs/statements/README.md).

`/statements` reads an HDFC or ICICI credit card PDF on the device, drops the
personal details, and lists EMI, domestic and international rows with GST and
forex markup folded in. The statement's summary (dues, payments, limits, due
date) can be saved under the card, known by its last four digits only, and
every saved statement is listed under **Your cards** on the same page. It is
on in local development and hidden in production until `STATEMENTS_ENABLED=1`
is set. To try it, sign in locally and
open **Statements** in the sidebar (**Import** in the phone bottom bar).

## Database

This app reuses the **same Postgres tables** the Streamlit app created, so your
existing data works as-is. The Prisma models in
[`prisma/schema.prisma`](./prisma/schema.prisma) `@map` to the real snake_case
columns.

Verify the schema against your live database before first deploy:

```bash
npm run db:pull     # introspect the live DB and reconcile differences
npx prisma generate
```

For a brand-new empty database, create the tables with `npm run db:push`.

Schema changes since the Streamlit era live as SQL files in [`db/`](./db).
Apply them once, in date order, to an existing database (Supabase SQL editor
or `psql`). `2026_09_group_name_history.sql` adds the table that keeps every past
group name with the dates it was in use; `2026_09_app_users_last_name.sql`
adds the editable last name and folds old nicknames into the first name;
`2026_09_category_dedupe.sql` merges categories that differ only by case,
spacing or a plural "s" into one spelling;
`2026_09_income_and_unequal_split.sql` adds `expenses.shares` for unequal
group splits, the `user_incomes` table behind the monthly income and
savings figures, and the `app_users` columns that drive the income
onboarding step and popup. Deploy the code only after it has run.
`2026_09_cards.sql` adds the `cards` and `card_statements` tables that hold
the statement summaries saved from the statement import.
`2026_09_app_users_image.sql` adds `app_users.image`, the Google profile
photo shown in place of member names; run it before deploying that code.

## Google OAuth setup

Auth.js uses a **different callback path** than Streamlit did. In Google Cloud
Console → Credentials → your OAuth client, set **Authorized redirect URIs** to:

- Local: `http://localhost:3000/api/auth/callback/google`
- Production: `https://<your-domain>/api/auth/callback/google`

(The old Streamlit `/oauth2callback` URI is no longer used.)

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel. Framework preset: **Next.js**
   (root directory is the repo root).
2. Add the environment variables from `.env.example` in the Vercel project
   settings. Set `AUTH_URL` to your production URL.
3. Add the production redirect URI (above) in Google Cloud Console.
4. Deploy. The build runs `prisma generate && next build`.

> Rotate the Google client secret and `cookie_secret`/`AUTH_SECRET` if they were
> ever shared in chat or committed.

## Project layout

```
src/
  auth.ts                 Auth.js (Google, JWT)
  app/
    login/                Sign-in screen
    api/auth/[...nextauth] Auth.js route handlers
    (app)/                Authenticated area (sidebar layout)
      page.tsx            Home + pending invites
      add/ log/ summary/ settlement/ groups/ profile/
  components/             Sidebar, charts, shared UI
  lib/                    Prisma client, business logic, server actions
prisma/schema.prisma      Mapped to existing Postgres tables
legacy-streamlit/         Previous Streamlit app (reference)
```
