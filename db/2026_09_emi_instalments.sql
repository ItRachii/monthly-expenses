-- EMI instalments as statements bill them, so the GST that HDFC bills a
-- month later can be traced back to the instalment it belongs to. The loan
-- is known by a keyed hash computed in the browser plus its last four
-- digits; the loan number itself is never stored.
-- Applied to Supabase as migration `emi_instalments`.

create table if not exists public.emi_instalments (
  id            serial primary key,
  owner_email   text not null,
  card_id       text references public.cards(id) on delete set null,
  loan_key      text not null,
  loan_last4    text,
  instalment_no integer,
  date          date not null,
  principal     double precision not null,
  interest      double precision not null,
  ref_key       text,
  gst           double precision,
  gst_period    text,
  period        text not null,
  created_at    timestamptz not null default now(),
  constraint emi_instalments_owner_loan_date_key unique (owner_email, loan_key, date)
);
alter table public.emi_instalments enable row level security;
create index if not exists emi_instalments_owner_loan_idx on public.emi_instalments (owner_email, loan_key);
alter table public.emi_instalments add column if not exists ref_key text;
create index if not exists emi_instalments_owner_ref_idx on public.emi_instalments (owner_email, ref_key);
