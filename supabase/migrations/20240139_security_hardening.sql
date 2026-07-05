-- ============================================================================
-- Security hardening (2026-07): anon grants, notification spoofing, fake reviews,
-- and home-address coordinate exposure. Edge functions use the service role and
-- bypass RLS, so system-generated rows (webhooks, crons, triggers) still work.
-- ============================================================================

-- ── #4 Revoke leftover anon write grants (defense in depth) ──────────────────
-- RLS already default-denies anon writes, but the old init migration left broad
-- GRANTs in place. Revoke them so a future policy slip can't hand anon full write.
revoke insert, update, delete on
  listings, users, bookings, messages, reviews, notifications,
  push_subscriptions, booking_requests
  from anon;

-- ── #3 Notifications: no more spoofing anyone's bell ─────────────────────────
-- A client may write a notification only to: itself, a genuine counterparty (a
-- shared booking or conversation), or — for admins — anyone. Everything else
-- (payment confirmations, auto-flags) is inserted by edge functions / SECURITY
-- DEFINER triggers under the service role, which bypasses RLS.
drop policy if exists "notifications_insert" on notifications;
create policy "notifications_insert" on notifications for insert to authenticated
  with check (
    auth.uid()::text = user_id
    or auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8'
    or auth.uid() in (select user_id from admins)
    or exists (select 1 from booking_requests b
                 where (b.renter_id = auth.uid()::text and b.owner_id = user_id)
                    or (b.owner_id  = auth.uid()::text and b.renter_id = user_id))
    or exists (select 1 from messages m
                 where (m.from_user_id = auth.uid()::text and m.to_user_id = user_id)
                    or (m.to_user_id  = auth.uid()::text and m.from_user_id = user_id))
  );

-- ── #2 Reviews: must come from the reviewer and a real transaction ───────────
-- Was WITH CHECK (true): anyone could post unlimited reviews for any listing as
-- any name. Now the row must be authored by the authenticated reviewer AND backed
-- by a non-pending, non-cancelled booking that reviewer had for the listing. One
-- review per user per listing.
alter table reviews add column if not exists reviewer_id text;

drop policy if exists "reviews_insert_authenticated" on reviews;
drop policy if exists "reviews_insert_verified" on reviews;
create policy "reviews_insert_verified" on reviews for insert to authenticated
  with check (
    auth.uid()::text = reviewer_id
    and exists (select 1 from booking_requests b
                 where b.renter_id = auth.uid()::text
                   and (b.item_json->>'id') = reviews.listing_id::text
                   and b.status not in ('pending','declined','cancelled'))
  );

create unique index if not exists reviews_one_per_user_listing
  on reviews (reviewer_id, listing_id) where reviewer_id is not null;

-- ── #5 Stop exposing listers' exact home coordinates ─────────────────────────
-- listings are world-readable (USING true), which exposed precise lat/lng — a
-- home address for many listers. Round stored coordinates to ~1km precision so
-- there's no exact location to leak; still accurate enough for the mile-radius
-- filter and the (already privacy-offset) map pins.
create or replace function public.round_listing_coords()
returns trigger
language plpgsql
as $$
begin
  if new.lat is not null then new.lat := round(new.lat::numeric, 2); end if;
  if new.lng is not null then new.lng := round(new.lng::numeric, 2); end if;
  return new;
end;
$$;

drop trigger if exists trg_round_listing_coords on listings;
create trigger trg_round_listing_coords
  before insert or update on listings
  for each row execute function public.round_listing_coords();

-- Round coordinates already stored.
update listings set lat = round(lat::numeric, 2) where lat is not null and lat::numeric <> round(lat::numeric, 2);
update listings set lng = round(lng::numeric, 2) where lng is not null and lng::numeric <> round(lng::numeric, 2);
