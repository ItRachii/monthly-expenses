-- Credit cards and their statement summaries, filed under the user's own
-- account. A card is identified by the last four digits only.
-- Applied to Supabase as migration `cards_and_statements`.

create table if not exists public.cards (
  id          text primary key,
  owner_email text not null,
  bank        text not null,
  last4       text not null,
  product     text,
  created_at  timestamptz not null default now(),
  constraint cards_owner_bank_last4_key unique (owner_email, bank, last4)
);
alter table public.cards enable row level security;

create table if not exists public.card_statements (
  id                  serial primary key,
  card_id             text not null references public.cards(id) on delete cascade,
  period              text not null,
  statement_date      date,
  due_date            date,
  previous_dues       double precision,
  payments_credits    double precision,
  purchases           double precision,
  finance_charges     double precision,
  total_due           double precision,
  minimum_due         double precision,
  credit_limit        double precision,
  available_credit    double precision,
  available_cash      double precision,
  domestic_total      double precision,
  international_total double precision,
  emi_total           double precision,
  imported_at         timestamptz not null default now(),
  constraint card_statements_card_period_key unique (card_id, period)
);
alter table public.card_statements enable row level security;
create index if not exists card_statements_card_idx on public.card_statements (card_id, period desc);
