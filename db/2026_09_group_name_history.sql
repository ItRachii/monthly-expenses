-- Group rename with SCD Type 2 history. Apply once to the production
-- database (Supabase SQL editor, the Supabase MCP apply_migration tool, or
-- `npm run db:push` for the table; the backfill below must be run as SQL).
--
-- Safe / additive: `groups.name` keeps holding the current name, so every
-- existing query keeps working unchanged. Each rename closes the open history
-- row (valid_to = now) and inserts a new open row (valid_to IS NULL).

CREATE TABLE IF NOT EXISTS public.group_name_history (
  id         serial PRIMARY KEY,
  group_id   text NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  name       text NOT NULL,
  valid_from timestamp(3) NOT NULL,
  valid_to   timestamp(3),
  changed_by text NOT NULL
);

CREATE INDEX IF NOT EXISTS group_name_history_group_idx
  ON public.group_name_history (group_id, valid_from DESC);

-- Backfill: seed one open row per existing group so the history starts at
-- creation, attributed to the creator. Idempotent.
INSERT INTO public.group_name_history (group_id, name, valid_from, valid_to, changed_by)
SELECT g.id, g.name, g.created_at, NULL, g.created_by
FROM public.groups g
WHERE NOT EXISTS (
  SELECT 1 FROM public.group_name_history h WHERE h.group_id = g.id
);
