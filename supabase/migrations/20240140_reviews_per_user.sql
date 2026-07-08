-- Make reviews PERSON-LEVEL: reputation follows the provider, not the listing.
-- Previously reviews were tied to a listing_id with ON DELETE CASCADE, so deleting
-- a listing wiped its reviews — letting a seller erase bad reviews by relisting,
-- and losing good ones. Now each review records who it's ABOUT (reviewed_user_id)
-- and survives listing deletion; ratings aggregate per user.

alter table reviews add column if not exists reviewed_user_id text;

-- Backfill: the reviewed user is the listing's owner.
update reviews r
   set reviewed_user_id = l.user_id
  from listings l
 where r.listing_id = l.id
   and r.reviewed_user_id is null;

-- Switch the listing_id FK from CASCADE to SET NULL so a deleted listing no longer
-- deletes the review (it stays attached to the user). Constraint name is looked up
-- dynamically since it was auto-generated.
do $$
declare fk text;
begin
  select conname into fk
    from pg_constraint
   where conrelid = 'reviews'::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'reviews'::regclass and attname = 'listing_id')];
  if fk is not null then execute format('alter table reviews drop constraint %I', fk); end if;
end $$;

alter table reviews
  add constraint reviews_listing_id_fkey
  foreign key (listing_id) references listings(id) on delete set null;

-- Tighten INSERT: the review must be written by the authenticated reviewer AND
-- backed by a real (non-cancelled) booking in which reviewed_user_id is the owner
-- the reviewer transacted with — so the target can't be spoofed.
drop policy if exists "reviews_insert_verified" on reviews;
create policy "reviews_insert_verified" on reviews for insert to authenticated
  with check (
    auth.uid()::text = reviewer_id
    and exists (select 1 from booking_requests b
                 where b.renter_id = auth.uid()::text
                   and b.owner_id = reviews.reviewed_user_id
                   and (b.item_json->>'id') = reviews.listing_id::text
                   and b.status not in ('pending','declined','cancelled'))
  );
