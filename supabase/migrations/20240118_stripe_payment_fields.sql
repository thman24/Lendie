-- Add Stripe payment tracking columns to booking_requests
ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS payment_intent_id text,
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS stripe_amount_cents integer,
  ADD COLUMN IF NOT EXISTS stripe_breakdown jsonb;

-- Index for webhook lookups by payment_intent_id
CREATE INDEX IF NOT EXISTS idx_booking_requests_payment_intent
  ON booking_requests(payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

-- Add payment_status to notifications allowed types (informational comment only)
-- payment_status values: 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled'
