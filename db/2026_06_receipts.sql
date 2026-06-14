-- Receipt scanning: a "main expense" header that granular line items nest
-- under. Apply once to the production database (Supabase SQL editor, the
-- Supabase MCP apply_migration tool, or `npm run db:push`).
--
-- Safe / additive: the new columns on `expenses` are all nullable, so existing
-- rows are untouched and every current query keeps working unchanged. Line
-- items are ordinary expense rows grouped by `receipt_id`, so they flow into
-- summaries/settlements automatically with no double counting (the receipt
-- header is NOT an expense row).

CREATE TABLE IF NOT EXISTS public.receipts (
  id           text PRIMARY KEY,
  merchant     text NOT NULL DEFAULT '',
  total        double precision NOT NULL DEFAULT 0,
  purchased_on date,
  owner_email  text,
  group_id     text,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS receipt_id text REFERENCES public.receipts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS gst_rate   double precision,
  ADD COLUMN IF NOT EXISTS gst_amount double precision;

CREATE INDEX IF NOT EXISTS expenses_receipt_idx ON public.expenses(receipt_id);
