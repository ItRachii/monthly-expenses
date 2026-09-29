-- Several payers on one expense. Apply once to the production database
-- (Supabase SQL editor, the Supabase MCP apply_migration tool, or
-- `npm run db:push`) BEFORE deploying the code that reads it: every expense
-- query selects this column, so the app fails until it exists.
--
-- Safe / additive: nullable, no backfill. expenses.payer = 'multiple' marks
-- a row where payers holds what each person put in as {"<user id>": rupees},
-- adding up to the amount. Null for every single-payer row.

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS payers jsonb;
