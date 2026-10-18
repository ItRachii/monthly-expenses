-- Days on which each user opened the app, for the developer metrics page
-- (/dev/metrics): daily, weekly and monthly active users count people who
-- only looked, not just those who added something. One row per user per
-- day (India time), written on the first page they open that day.
-- Additive: nothing reads it until this exists, and the app keeps working
-- without it. Holds user ids ("u_..."), never addresses.

create table if not exists public.user_activity_days (
  user_id text not null,
  day     date not null,
  primary key (user_id, day)
);
create index if not exists user_activity_days_day_idx on public.user_activity_days (day);
alter table public.user_activity_days enable row level security;
