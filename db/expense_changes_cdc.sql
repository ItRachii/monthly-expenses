-- Change Data Capture for expenses.
-- Applied to Supabase (project nvvduedcsehnnokljvvp) as migration
-- `expense_changes_cdc`. Kept here for reproducibility / version control.
--
-- A trigger records every INSERT/UPDATE/DELETE on `expenses` into
-- `expense_changes` (old/new row snapshots as JSONB). The app reads the latest
-- rows to show "Recent updates" on the Expense Log.

create table if not exists public.expense_changes (
  id          bigint generated always as identity primary key,
  expense_id  integer,
  operation   text not null check (operation in ('INSERT','UPDATE','DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  changed_at  timestamptz not null default now()
);

create index if not exists expense_changes_changed_at_idx
  on public.expense_changes (changed_at desc);
create index if not exists expense_changes_expense_id_idx
  on public.expense_changes (expense_id);

create or replace function public.capture_expense_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

drop trigger if exists expenses_capture_changes on public.expenses;
create trigger expenses_capture_changes
after insert or update or delete on public.expenses
for each row execute function public.capture_expense_change();
