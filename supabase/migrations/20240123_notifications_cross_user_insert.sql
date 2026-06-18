-- Allow authenticated users to create notifications for other users —
-- booking requests, accepts, declines, cancellations, completions, and reviews
-- all write to the recipient's bell from the sender's client.
-- (Reads/updates/deletes remain restricted to the owner of the notification.)
DROP POLICY IF EXISTS "notifications_insert" ON notifications;
CREATE POLICY "notifications_insert"
  ON notifications FOR INSERT TO authenticated
  WITH CHECK (true);
