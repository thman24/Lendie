-- ─────────────────────────────────────────────────────────────────────────────
-- Full RLS lockdown for all Lendie tables
-- listings.user_id is uuid; users.id, booking_requests cols are text
-- bookings table has no user ownership column — RLS enabled, no policies (blocks anon access)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── listings ─────────────────────────────────────────────────────────────────
-- listings.user_id is uuid; auth.uid() is uuid — compare directly
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read listings"              ON listings;
DROP POLICY IF EXISTS "Owners can insert their own listings"  ON listings;
DROP POLICY IF EXISTS "Owners can update their own listings"  ON listings;
DROP POLICY IF EXISTS "Owners can delete their own listings"  ON listings;
DROP POLICY IF EXISTS "listings_select_public"                ON listings;
DROP POLICY IF EXISTS "listings_insert_owner"                 ON listings;
DROP POLICY IF EXISTS "listings_update_owner"                 ON listings;
DROP POLICY IF EXISTS "listings_delete_owner"                 ON listings;

CREATE POLICY "listings_select_public"
  ON listings FOR SELECT TO public USING (true);

CREATE POLICY "listings_insert_owner"
  ON listings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "listings_update_owner"
  ON listings FOR UPDATE TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "listings_delete_owner"
  ON listings FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ── booking_requests ─────────────────────────────────────────────────────────
-- renter_id and owner_id are text; cast auth.uid() to text
ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_requests_select" ON booking_requests;
DROP POLICY IF EXISTS "booking_requests_insert" ON booking_requests;
DROP POLICY IF EXISTS "booking_requests_update" ON booking_requests;
DROP POLICY IF EXISTS "booking_requests_delete" ON booking_requests;

CREATE POLICY "booking_requests_select"
  ON booking_requests FOR SELECT TO authenticated
  USING (auth.uid()::text = renter_id OR auth.uid()::text = owner_id);

CREATE POLICY "booking_requests_insert"
  ON booking_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = renter_id);

CREATE POLICY "booking_requests_update"
  ON booking_requests FOR UPDATE TO authenticated
  USING (auth.uid()::text = renter_id OR auth.uid()::text = owner_id);

CREATE POLICY "booking_requests_delete"
  ON booking_requests FOR DELETE TO authenticated
  USING (auth.uid()::text = renter_id OR auth.uid()::text = owner_id);

-- ── bookings ─────────────────────────────────────────────────────────────────
-- This table has no user ownership column (only user_name text).
-- Enable RLS to block anonymous REST access; no policies needed since the app
-- does not query this table directly.
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_select" ON bookings;
DROP POLICY IF EXISTS "bookings_insert" ON bookings;
DROP POLICY IF EXISTS "bookings_update" ON bookings;
DROP POLICY IF EXISTS "bookings_delete" ON bookings;

-- ── messages ─────────────────────────────────────────────────────────────────
-- from_user_id and to_user_id are text
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;

CREATE POLICY "messages_select"
  ON messages FOR SELECT TO authenticated
  USING (auth.uid()::text = from_user_id OR auth.uid()::text = to_user_id);

CREATE POLICY "messages_insert"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = from_user_id);

-- ── reviews ───────────────────────────────────────────────────────────────────
-- No user ownership column; public read, any authenticated user can write
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_select"               ON reviews;
DROP POLICY IF EXISTS "reviews_insert"               ON reviews;
DROP POLICY IF EXISTS "reviews_select_public"        ON reviews;
DROP POLICY IF EXISTS "reviews_insert_authenticated" ON reviews;

CREATE POLICY "reviews_select_public"
  ON reviews FOR SELECT TO public USING (true);

CREATE POLICY "reviews_insert_authenticated"
  ON reviews FOR INSERT TO authenticated WITH CHECK (true);

-- ── notifications ─────────────────────────────────────────────────────────────
-- user_id is text
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select" ON notifications;
DROP POLICY IF EXISTS "notifications_insert" ON notifications;
DROP POLICY IF EXISTS "notifications_update" ON notifications;
DROP POLICY IF EXISTS "notifications_delete" ON notifications;

CREATE POLICY "notifications_select"
  ON notifications FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

CREATE POLICY "notifications_insert"
  ON notifications FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "notifications_update"
  ON notifications FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id);

CREATE POLICY "notifications_delete"
  ON notifications FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id);

-- ── push_subscriptions ───────────────────────────────────────────────────────
-- user_id is text
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions_select" ON push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_insert" ON push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_delete" ON push_subscriptions;

CREATE POLICY "push_subscriptions_select"
  ON push_subscriptions FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

CREATE POLICY "push_subscriptions_insert"
  ON push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "push_subscriptions_delete"
  ON push_subscriptions FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id);

-- ── users ─────────────────────────────────────────────────────────────────────
-- users.id is text (stores auth uid as text)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select"        ON users;
DROP POLICY IF EXISTS "users_update"        ON users;
DROP POLICY IF EXISTS "users_select_public" ON users;
DROP POLICY IF EXISTS "users_update_self"   ON users;

CREATE POLICY "users_select_public"
  ON users FOR SELECT TO public USING (true);

CREATE POLICY "users_update_self"
  ON users FOR UPDATE TO authenticated
  USING  (auth.uid()::text = id)
  WITH CHECK (auth.uid()::text = id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Ensure authenticated role has the grants it needs (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON listings           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON booking_requests   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON messages           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON reviews            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON users              TO authenticated;
