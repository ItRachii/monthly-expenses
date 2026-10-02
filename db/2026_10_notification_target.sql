-- What each notification points at, so opening one lands on the exact
-- expense or payment: the ids of the expenses added or edited, a short
-- snapshot of an expense that was deleted (it has no row left to show),
-- or the id of the recorded payment. Apply once to the production database
-- (Supabase SQL editor, the Supabase MCP apply_migration tool, or
-- `npm run db:push`) BEFORE deploying the code that reads it: every
-- notification query selects this column.
--
-- Safe / additive: nullable, no backfill. Notifications created before it
-- existed keep opening their group, as they always did.

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS target jsonb;
