-- A fingerprint of the statement row each imported expense came from, so
-- reading the same statement again finds the rows already added instead
-- of adding them twice. It is a keyed hash (HMAC with PII_SECRET) of the
-- card, the date, the amount, the description and which time that exact
-- row appears in the statement: no statement text is stored by it.
-- Apply once to the production database (Supabase SQL editor, the
-- Supabase MCP apply_migration tool, or `npm run db:push`) BEFORE
-- deploying the code that reads it: every expense query selects it.
--
-- Safe / additive: nullable, no backfill. Expenses imported before it
-- existed are still found by day, amount and card or description.

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS import_key text;
CREATE INDEX IF NOT EXISTS expenses_import_key_idx ON public.expenses(import_key);
