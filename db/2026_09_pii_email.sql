-- PII protection for email addresses: schema prep.
--
-- Every column that used to hold an email now holds an opaque user id
-- ("u_" + HMAC-SHA256 of the lowercased email under PII_SECRET). The real
-- address is kept once, AES-256-GCM encrypted, in app_users.email_enc (and in
-- group_invites.invited_email_enc for people who have not signed up yet).
--
-- This file is additive and safe to apply while the old app version is live.
-- The data itself is rewritten by the app (src/lib/piiMigration.ts) on the
-- first request served by the production deployment that has PII_SECRET, and
-- the run is recorded in pii_migrations.

alter table public.app_users add column if not exists email_enc text;
alter table public.group_invites add column if not exists invited_email_enc text;

create table if not exists public.pii_migrations (
  id         text primary key,
  applied_at timestamptz not null default now()
);
alter table public.pii_migrations enable row level security;

-- app_users.email changes from address to user id, so the inviter reference
-- has to follow it.
alter table public.group_invites drop constraint if exists group_invites_invited_by_fkey;
alter table public.group_invites
  add constraint group_invites_invited_by_fkey
  foreign key (invited_by) references public.app_users(email) on update cascade;

-- Let a transaction opt out of change capture (SET LOCAL app.skip_cdc = 'on'),
-- so rewriting emails does not log hundreds of fake "edits".
create or replace function public.capture_expense_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.skip_cdc', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if (tg_op = 'INSERT') then
    insert into public.expense_changes (expense_id, operation, old_data, new_data)
    values (new.id, 'INSERT', null, to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    if to_jsonb(old) is distinct from to_jsonb(new) then
      insert into public.expense_changes (expense_id, operation, old_data, new_data)
      values (new.id, 'UPDATE', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.expense_changes (expense_id, operation, old_data, new_data)
    values (old.id, 'DELETE', to_jsonb(old), null);
    return old;
  end if;
  return null;
end;
$$;
