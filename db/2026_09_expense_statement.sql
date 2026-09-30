-- Links each imported expense to the card statement it came from, so the
-- Statements tab can list a statement's expenses under its summary. Apply
-- once to the production database (Supabase SQL editor, the Supabase MCP
-- apply_migration tool, or `npm run db:push`) BEFORE deploying the code
-- that reads it: every expense query selects this column.
--
-- Safe / additive: nullable, no backfill. Expenses imported before this
-- column existed stay unlinked; hand-entered expenses are always null.
-- Removing a statement keeps its expenses (the link is cleared).

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS statement_id integer
  REFERENCES public.card_statements(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS expenses_statement_idx ON public.expenses(statement_id);
