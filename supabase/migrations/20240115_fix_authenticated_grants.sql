-- Fix: grant authenticated users the same table access as anon.
-- All tables created after the initial project setup only received anon grants.
-- Logged-in users operate under the `authenticated` role and were silently
-- blocked from UPDATE on booking_requests (accept/decline/cancel) and
-- DELETE on messages (inbox delete), and INSERT on notifications/push_subscriptions.

GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO authenticated;
GRANT USAGE ON SEQUENCE messages_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON booking_requests TO authenticated;
GRANT USAGE ON SEQUENCE booking_requests_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO authenticated;
GRANT USAGE ON SEQUENCE notifications_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO authenticated;
GRANT USAGE ON SEQUENCE push_subscriptions_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON reviews TO authenticated;
GRANT USAGE ON SEQUENCE bookings_id_seq, reviews_id_seq TO authenticated;
