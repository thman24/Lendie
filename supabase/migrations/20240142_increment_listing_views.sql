-- View counter for listings.
--
-- Bumping listings.views previously went through a raw UPDATE from the client,
-- which the owner-only UPDATE policy (see 20240113_listings_rls.sql) blocked for
-- guests and non-owners. Result: views were effectively never counted, and the
-- client logged "permission denied for table listings" on every listing open by
-- a logged-out visitor.
--
-- This SECURITY DEFINER function does ONLY the single increment, so it is safe to
-- expose to anyone (anon + authenticated) without loosening the owner-only UPDATE
-- policy that protects every other column on the row.

CREATE OR REPLACE FUNCTION increment_listing_views(listing_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE listings SET views = COALESCE(views, 0) + 1 WHERE id = listing_id;
$$;

GRANT EXECUTE ON FUNCTION increment_listing_views(bigint) TO anon, authenticated;
