-- One membership per person per group. The app already adds members under
-- a lock on the group (groups.ts lockMembers); this makes the database
-- refuse a second row too, so an equal split can never count someone twice.
-- Checked before adding: no group has a duplicate member (October 2026).
-- The PII sweep (piiMigration.ts mergeMembers) folds a raw-address row
-- into the same person's id row first, so it never trips this index.

create unique index if not exists group_members_group_email_key on public.group_members (group_id, email);
