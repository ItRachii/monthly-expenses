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

```bash
cp .env.example .env        # then fill in the values
npm install                 # also runs `prisma generate`
npm run dev                 # http://localhost:3000
```

### Environment variables

See [`.env.example`](./.env.example). Required: `DATABASE_URL`, `AUTH_SECRET`,
`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. SMTP vars are optional (invite emails).

Generate a secret: `openssl rand -base64 32`.

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
