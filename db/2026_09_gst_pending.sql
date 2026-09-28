-- GST charges added before the instalment they tax was on record. A lone
-- IGST line on an HDFC statement cites the reference of the interest line
-- it taxes; when that line's statement has not been uploaded yet, the
-- charge is still imported, remembered here by the reference's keyed hash,
-- flagged on the expense, and traced the moment the earlier statement is
-- uploaded. The reference itself is never stored.
-- Applied to Supabase as migration `gst_pending`.

create table if not exists public.gst_pending (
  id                     serial primary key,
  owner_email            text not null,
  expense_id             integer not null references public.expenses(id) on delete cascade,
  ref_key                text not null,
  amount                 double precision not null,
  date                   date not null,
  period                 text not null,
  resolved_at            timestamptz,
  resolved_instalment_id integer,
  created_at             timestamptz not null default now()
);
alter table public.gst_pending enable row level security;
create index if not exists gst_pending_owner_ref_idx on public.gst_pending (owner_email, ref_key);
create index if not exists gst_pending_expense_idx on public.gst_pending (expense_id);
