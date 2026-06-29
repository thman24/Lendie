-- Admin moderation bypass. Without these, the /admin panel's client-side actions
-- (hide/delete a listing, cancel a booking, view/action reports) silently affect
-- 0 rows on OTHER users' content because RLS only allowed the resource owner —
-- the UI showed success while nothing persisted. These permissive policies let the
-- owner and granted admins (rows in the `admins` table) act on any user's content.
--
-- The `auth.uid() IN (SELECT user_id FROM admins)` subquery is safe: the admins
-- table's own "read own admin row" RLS means the subquery returns the caller's row
-- only when they are an admin, so the check is true iff the caller is an admin.

-- listings: admins can hide/show (UPDATE) and remove (DELETE) any listing
DROP POLICY IF EXISTS "listings_admin_update" ON listings;
CREATE POLICY "listings_admin_update" ON listings FOR UPDATE TO authenticated
  USING (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8' OR auth.uid() IN (SELECT user_id FROM admins))
  WITH CHECK (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8' OR auth.uid() IN (SELECT user_id FROM admins));

DROP POLICY IF EXISTS "listings_admin_delete" ON listings;
CREATE POLICY "listings_admin_delete" ON listings FOR DELETE TO authenticated
  USING (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8' OR auth.uid() IN (SELECT user_id FROM admins));

-- booking_requests: admins can cancel (UPDATE) any booking
DROP POLICY IF EXISTS "booking_requests_admin_update" ON booking_requests;
CREATE POLICY "booking_requests_admin_update" ON booking_requests FOR UPDATE TO authenticated
  USING (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8' OR auth.uid() IN (SELECT user_id FROM admins))
  WITH CHECK (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8' OR auth.uid() IN (SELECT user_id FROM admins));

-- reports: owner OR granted admins can view and action (was hardcoded owner-only,
-- so delegated admins saw an empty list and their status updates no-op'd silently)
DROP POLICY IF EXISTS "reports_select_admin" ON reports;
CREATE POLICY "reports_select_admin" ON reports FOR SELECT TO authenticated
  USING (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8' OR auth.uid() IN (SELECT user_id FROM admins));

DROP POLICY IF EXISTS "reports_update_admin" ON reports;
CREATE POLICY "reports_update_admin" ON reports FOR UPDATE TO authenticated
  USING (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8' OR auth.uid() IN (SELECT user_id FROM admins));
