-- Usage of the scanner (receipts and order screenshots), for the developer
-- metrics page (/dev/metrics). One row per step of an attempt: an attempt
-- runs from opening the scanner to saving or leaving, and has a random id.
-- Counts and fixed codes only: never an address, a name, an image, any
-- text read from one, an amount or a merchant. User ids only ("u_...").
-- Additive: nothing reads it until it exists, and the app works without
-- it. Rows older than 180 days are deleted by the app.

create table if not exists public.scan_events (
  id           bigserial primary key,
  attempt      text not null,
  seq          int  not null default 1,
  user_id      text not null,
  event        text not null,
  outcome      text,
  detail       text,
  kind         text,
  app          text,
  n            int,
  ms           int,
  flag_missing  boolean,
  flag_mismatch boolean,
  edited       int,
  removed      int,
  added        int,
  test         boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (attempt, event, seq)
);
create index if not exists scan_events_created_idx on public.scan_events (created_at);
create index if not exists scan_events_user_idx on public.scan_events (user_id, created_at);
alter table public.scan_events enable row level security;
