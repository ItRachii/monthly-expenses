-- Category cleanup: merge categories that differ only by case, spacing or a
-- plural "s"/"ies" into one spelling. Same rule as categoryKey() in
-- src/lib/constants.ts, which the app now applies on every save, so new
-- duplicates can no longer be created. Apply once (Supabase SQL editor or the
-- Supabase MCP apply_migration tool). Idempotent: a second run changes nothing.
--
-- The winning spelling for each group is a standard app category when one is
-- present, otherwise the most used spelling. The expense_changes trigger logs
-- every row this touches, so each change can be traced and reverted.

WITH keyed AS (
  SELECT
    category,
    count(*) AS n,
    lower(regexp_replace(btrim(category), '\s+', ' ', 'g')) AS k0
  FROM public.expenses
  WHERE btrim(category) <> ''
  GROUP BY category
),
keys AS (
  SELECT
    category,
    n,
    CASE
      WHEN k0 LIKE '%ies' THEN left(k0, -3) || 'y'
      WHEN k0 LIKE '%s' AND k0 NOT LIKE '%ss' THEN left(k0, -1)
      ELSE k0
    END AS k
  FROM keyed
),
winner AS (
  SELECT DISTINCT ON (k) k, category AS canonical
  FROM keys
  ORDER BY
    k,
    category = ANY (ARRAY[
      'Housing','Groceries','Dining Out','Food','Transport','Healthcare',
      'Wellness','Entertainment','Shopping','Travel','Utilities',
      'Subscriptions','Other'
    ]) DESC,
    n DESC,
    category
)
UPDATE public.expenses e
SET category = w.canonical
FROM keys s
JOIN winner w ON w.k = s.k
WHERE e.category = s.category
  AND e.category <> w.canonical;
