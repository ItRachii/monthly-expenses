-- Profile: editable first + last name as the display name. Apply once to the
-- production database (Supabase SQL editor, the Supabase MCP apply_migration
-- tool, or `npm run db:push` for the column; the backfill must be run as SQL).
--
-- Safe / additive: the new column is nullable, so existing rows and every
-- current query keep working unchanged.

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS last_name text;

-- Users who had set a nickname (username) were shown by it everywhere. Carry
-- it into first_name so nobody's display name changes on deploy; they can
-- edit it on the profile page. username is left in place but no longer read.
UPDATE public.app_users
SET first_name = btrim(username)
WHERE username IS NOT NULL AND btrim(username) <> '';
