-- Re-assert strict message privacy. Drops ANY existing SELECT/UPDATE/DELETE
-- policies on messages (in case a stray permissive one was ever added to the live
-- DB) and recreates the single correct policy: a user may only read/modify a
-- message they sent or received. Paired with a client-side .or(from,to) filter as
-- defense in depth — never rely on RLS alone.

alter table messages enable row level security;

-- Drop every existing policy on messages by name, whatever they're called.
do $$
declare p record;
begin
  for p in select polname from pg_policy where polrelid = 'public.messages'::regclass loop
    execute format('drop policy if exists %I on public.messages', p.polname);
  end loop;
end $$;

-- SELECT: only the sender or recipient.
create policy "messages_select" on messages for select to authenticated
  using (auth.uid()::text = from_user_id or auth.uid()::text = to_user_id);

-- INSERT: you can only send as yourself.
create policy "messages_insert" on messages for insert to authenticated
  with check (auth.uid()::text = from_user_id);

-- UPDATE: only the recipient may mark a message read (or the sender edit their own).
create policy "messages_update" on messages for update to authenticated
  using (auth.uid()::text = from_user_id or auth.uid()::text = to_user_id)
  with check (auth.uid()::text = from_user_id or auth.uid()::text = to_user_id);

-- DELETE: only a party to the message.
create policy "messages_delete" on messages for delete to authenticated
  using (auth.uid()::text = from_user_id or auth.uid()::text = to_user_id);

-- No anon access to messages at all.
revoke all on messages from anon;
