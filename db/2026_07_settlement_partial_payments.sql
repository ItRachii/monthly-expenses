-- Partial settlement payments: record WHO received each payment so a month
-- only closes when every debt is fully recovered. Apply once to the
-- production database (Supabase SQL editor or `npm run db:push` for the
-- column — the backfill below must be run as SQL either way).
--
-- Safe / additive: the new column is nullable, so existing rows and every
-- current query keep working unchanged.

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS settled_to text;

-- Backfill: in a two-member group the recipient of a settlement payment is
-- unambiguous — it is the member who is not the payer. Groups with three or
-- more members are left NULL (the app applies those greedily to the payer's
-- debts, so already-settled months stay settled).
UPDATE public.settlements s
SET settled_to = other.email
FROM public.group_members other
WHERE s.settled_to IS NULL
  AND s.group_id IS NOT NULL
  AND other.group_id = s.group_id
  AND other.email <> s.settled_by
  AND (
    SELECT count(*) FROM public.group_members gm WHERE gm.group_id = s.group_id
  ) = 2;
