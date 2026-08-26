-- Link each booking to its conversation.
--
-- Booking requests had no stored reference to the message thread they belong to,
-- so the item-sheet status banners ("Request sent" / "Confirmed — complete
-- payment") could only guess the thread heuristically by owner + listing title.
-- That fails whenever the heuristic breaks (re-seeded data, retitled listings,
-- or a booking whose conversation was never created), leaving an order the user
-- can neither complete nor cancel.
--
-- Storing the conversation_id makes the banner reopen the EXACT thread. Nullable
-- so existing rows are unaffected; new bookings populate it on creation.

ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS conversation_id text;
