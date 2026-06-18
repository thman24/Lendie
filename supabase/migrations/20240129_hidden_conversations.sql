-- Per-user "delete from my inbox". Messages are shared rows, so a hard delete
-- removed the thread for both people. Instead each user can hide a conversation
-- for themselves; a new incoming message un-hides it (standard messaging UX).
create table if not exists hidden_conversations (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  hidden_at timestamptz default now(),
  primary key (user_id, conversation_id)
);

alter table hidden_conversations enable row level security;

drop policy if exists "manage own hidden convos" on hidden_conversations;
create policy "manage own hidden convos" on hidden_conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, delete on hidden_conversations to authenticated;
