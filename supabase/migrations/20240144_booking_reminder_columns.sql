-- Timestamps recording which rental reminders have already been sent for a
-- booking, so the hourly booking-reminders job never pings the same booking twice
-- (guarded null→now updates make it safe across overlapping runs). Nullable; old
-- rows are unaffected.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS reminder_daybefore_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_startday_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_return_sent_at    timestamptz;
