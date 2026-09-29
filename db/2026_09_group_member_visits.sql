-- When a member last opened a group, so the sidebar can list the groups
-- they used most recently. Nullable: groups never opened sort after the
-- ones that were, newest first.
-- Applied to Supabase as migration `group_member_visits`.

alter table public.group_members add column if not exists last_visited_at timestamptz;
create index if not exists group_members_email_visit_idx on public.group_members (email, last_visited_at desc);
