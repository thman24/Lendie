-- Enroll tables in supabase_realtime publication so postgres_changes subscriptions fire
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE booking_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
