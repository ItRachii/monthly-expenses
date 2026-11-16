-- Balances are all-time: a payment settles what is owed overall, not one
-- month. New payments are stored without a month; older ones keep theirs
-- (only for history, the balance counts every payment either way).
-- Additive: the old app version still writes a month, which stays valid.

alter table public.settlements alter column month drop not null;
