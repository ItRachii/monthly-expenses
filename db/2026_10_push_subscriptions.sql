-- Web Push: one row per device that turned notifications on. The endpoint
-- is the push service's address for that device (Google, Apple, Mozilla);
-- p256dh and auth are the keys its payloads are encrypted with. User ids
-- only ("u_..."). Rows are deleted when the push service says the device is
-- gone (404/410), when the device turns notifications off, and when the
-- same device signs in as someone else.
-- Additive: nothing reads it until it exists, and the app works without it.

create table if not exists public.push_subscriptions (
  id         bigserial primary key,
  user_id    text not null,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
