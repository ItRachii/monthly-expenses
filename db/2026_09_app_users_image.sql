-- Member photos: stores each user's Google profile photo URL so group pages
-- can show members by photo. Apply once to the production database (Supabase
-- SQL editor, the Supabase MCP apply_migration tool, or `npm run db:push`)
-- BEFORE deploying the code that reads it: every user lookup selects this
-- column, so the app fails until it exists.
--
-- Safe / additive: nullable, no backfill. Each user's photo is filled in on
-- their next sign-in or page load.

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS image text;
