-- Monthly income + unequal group splits. Apply once to the production
-- database (Supabase SQL editor, the Supabase MCP apply_migration tool, or
-- `npm run db:push`). Safe / additive: existing rows and queries are
-- unaffected.

-- Unequal split: expenses.split = 'custom' and shares holds each
-- participant's amount as {"<user id>": rupees}. Null for every other split.
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS shares jsonb;

-- Fixed monthly income, one row per month it was set or changed. user_email
-- holds the user id, like every other *email column.
CREATE TABLE IF NOT EXISTS public.user_incomes (
  user_email      text NOT NULL,
  effective_month text NOT NULL CHECK (effective_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount          double precision NOT NULL CHECK (amount >= 0),
  updated_at      timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_email, effective_month)
);

-- Match every other app table: RLS on with no policies, so the table is
-- reachable only through the app's postgres role, never the anon API.
ALTER TABLE public.user_incomes ENABLE ROW LEVEL SECURITY;

-- Income prompt: new users are asked during onboarding; existing users get a
-- skippable popup with "Remind me later". NULL on existing rows means "not
-- asked yet", so every current user sees the popup once.
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS income_prompt text;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS income_prompt_at timestamp(3);
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamp(3);
