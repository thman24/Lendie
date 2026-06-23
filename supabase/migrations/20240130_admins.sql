-- Additional admins (beyond the hardcoded owner). The owner grants/revokes via
-- the admin-access edge function (service role); clients can only read their OWN
-- row to check whether they themselves are an admin.
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  added_at timestamptz default now(),
  added_by uuid
);

alter table admins enable row level security;

drop policy if exists "read own admin row" on admins;
create policy "read own admin row" on admins for select using (auth.uid() = user_id);

grant select on admins to authenticated;
