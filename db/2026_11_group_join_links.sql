-- Join links: a link a member shares (WhatsApp, SMS, ...) that lets whoever
-- opens it and signs in join the group. One link serves many people, up to
-- max_uses, until it expires or an admin revokes it.
-- Only the SHA-256 of the link's token is stored, so a database reader
-- cannot rebuild a working link. created_by is a user id ("u_...").
-- Additive: without this table the app works as before and says that links
-- are not available.

create table if not exists public.group_join_links (
  id         serial primary key,
  group_id   text not null references public.groups(id) on delete cascade,
  token_hash text not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses   integer not null,
  use_count  integer not null default 0,
  revoked_at timestamptz
);
create index if not exists group_join_links_group_idx on public.group_join_links (group_id);
create index if not exists group_join_links_creator_idx on public.group_join_links (created_by, created_at);

-- Like every other app table: RLS on with no policies, so it is reachable
-- only through the app's postgres role, never the anon API.
alter table public.group_join_links enable row level security;
