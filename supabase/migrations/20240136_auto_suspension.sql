-- Auto-flag users with excessive booking cancellations for admin review.
--
-- Goal: when a user cancels their 3rd COMMITTED booking within a rolling 120-day
-- window — tracked separately for their renter side and their owner side — raise
-- a pending flag in the admin review queue (user_flags) with evidence, and light
-- up the owner's notification bell. This does NOT auto-suspend; a human reviews
-- and suspends/dismisses from the /admin Flags section.
--
-- "Committed" excludes pending-request withdrawals and owner declines: it only
-- counts bookings that had been accepted/confirmed or paid before cancellation,
-- so backing out of an un-accepted request never counts against anyone. Admin
-- cancellations (actor is neither party) count against no one.

-- ── 1. Cancellation attribution on booking_requests ──────────────────────────
-- Previously a cancellation was only `status='cancelled'` with no record of who
-- did it or when, so cancellations couldn't be attributed. These capture that.
alter table booking_requests add column if not exists cancelled_by text;
alter table booking_requests add column if not exists cancelled_at timestamptz;
alter table booking_requests add column if not exists cancellation_reason text;
-- Set true only when the booking was past the pending stage at cancel time.
alter table booking_requests add column if not exists committed_cancel boolean default false;

-- ── 2. Admin review queue ────────────────────────────────────────────────────
create table if not exists user_flags (
  id           bigserial primary key,
  user_id      text    not null,
  role         text    not null,                         -- 'renter' | 'owner'
  reason       text    not null default 'excessive_cancellations',
  count        int     not null default 0,               -- occurrences in window
  window_days  int     not null default 120,
  evidence     jsonb   not null default '[]'::jsonb,      -- the offending bookings
  status       text    not null default 'pending',       -- pending | actioned | dismissed
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  resolved_at  timestamptz,
  resolved_by  text
);

-- At most one open flag per (user, side, reason): re-offending refreshes the
-- existing pending flag rather than spawning duplicates.
create unique index if not exists user_flags_one_pending
  on user_flags (user_id, role, reason) where status = 'pending';

alter table user_flags enable row level security;

-- Admin-only (owner UUID or a row in `admins`), mirroring the reports queue.
drop policy if exists "user_flags_select_admin" on user_flags;
create policy "user_flags_select_admin" on user_flags for select to authenticated
  using (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8' OR auth.uid() IN (SELECT user_id FROM admins));

drop policy if exists "user_flags_update_admin" on user_flags;
create policy "user_flags_update_admin" on user_flags for update to authenticated
  using  (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8' OR auth.uid() IN (SELECT user_id FROM admins))
  with check (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8' OR auth.uid() IN (SELECT user_id FROM admins));

-- Inserts happen only via the SECURITY DEFINER trigger below (as table owner),
-- so authenticated users get read + resolve (update) rights only, never insert.
grant select, update on user_flags to authenticated;

-- ── 3. Stamp cancellation metadata (BEFORE UPDATE) ───────────────────────────
-- Runs before the row is written so it can read old.* to decide committed-ness
-- and default the actor. The app sets cancelled_by explicitly on every cancel
-- path (needed for the create-refund edge fn, which updates as service_role
-- where auth.uid() is null); auth.uid() is only a fallback for direct updates.
create or replace function public.stamp_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if new.cancelled_by is null then
      new.cancelled_by := auth.uid()::text;
    end if;
    if new.cancelled_at is null then
      new.cancelled_at := now();
    end if;
    -- Committed = progressed past a pending request: accepted/confirmed, or money
    -- was taken. Pending withdrawals and owner declines leave this false.
    new.committed_cancel := (
      old.status in ('accepted','confirmed')
      or old.payment_status in ('paid','refunded')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_cancellation on public.booking_requests;
create trigger trg_stamp_cancellation
  before update on public.booking_requests
  for each row
  execute function public.stamp_cancellation();

-- ── 4. Count + flag (AFTER UPDATE) ───────────────────────────────────────────
-- Any error here is swallowed so a flagging bug can NEVER abort a cancellation
-- (the trigger shares the cancel's transaction).
create or replace function public.flag_excessive_cancellations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     text;
  v_role      text;
  v_threshold int := 3;
  v_window    int := 120;
  v_count     int;
  v_evidence  jsonb;
  v_inserted  boolean;
begin
  if new.status <> 'cancelled' or not coalesce(new.committed_cancel, false) then
    return new;
  end if;

  v_actor := new.cancelled_by;
  if v_actor is null then
    return new;
  end if;

  -- Which side was the actor on? Admin cancels (neither party) => skip.
  if v_actor = new.owner_id then
    v_role := 'owner';
  elsif v_actor = new.renter_id then
    v_role := 'renter';
  else
    return new;
  end if;

  begin
    -- This actor's committed cancellations, acting in this same role, in-window.
    select count(*),
           coalesce(jsonb_agg(jsonb_build_object(
             'booking_id',   br.id,
             'item',         coalesce(br.item_title, br.item_json->>'title'),
             'date_str',     br.date_str,
             'cancelled_at', br.cancelled_at,
             'reason',       br.cancellation_reason
           ) order by br.cancelled_at desc), '[]'::jsonb)
      into v_count, v_evidence
    from booking_requests br
    where br.committed_cancel
      and br.status = 'cancelled'
      and br.cancelled_by = v_actor
      and br.cancelled_at > now() - make_interval(days => v_window)
      and ( (v_role = 'owner'  and br.owner_id  = v_actor)
         or (v_role = 'renter' and br.renter_id = v_actor) );

    if v_count < v_threshold then
      return new;
    end if;

    -- Upsert the single pending flag; refresh count/evidence if it exists.
    insert into user_flags (user_id, role, reason, count, window_days, evidence, status)
    values (v_actor, v_role, 'excessive_cancellations', v_count, v_window, v_evidence, 'pending')
    on conflict (user_id, role, reason) where status = 'pending'
    do update set count = excluded.count, evidence = excluded.evidence, updated_at = now()
    returning (xmax = 0) into v_inserted;  -- true only when a NEW row was inserted

    -- Notify the owner's bell only the first time (avoid re-pinging on refresh).
    if v_inserted then
      insert into notifications (user_id, icon, text, sub, time_label, unread, type)
      values ('8f7af82b-b44e-436f-995a-530eb24925e8', '🚩',
              'Flag: excessive cancellations',
              v_count || ' committed ' || v_role || ' cancellations in ' || v_window || ' days — review in Admin',
              'Just now', true, 'general');
    end if;
  exception when others then
    raise warning 'flag_excessive_cancellations failed for %: %', v_actor, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_flag_excessive_cancellations on public.booking_requests;
create trigger trg_flag_excessive_cancellations
  after update on public.booking_requests
  for each row
  execute function public.flag_excessive_cancellations();
