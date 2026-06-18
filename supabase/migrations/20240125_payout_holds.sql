-- Hold owner payouts in the platform balance and release them on a timer.
-- We move from Stripe destination charges (which transfer to the owner the
-- instant the charge succeeds) to "separate charges and transfers": the full
-- amount is charged onto the platform account and the owner's cut is transferred
-- later, by the release-payouts function, once payout_release_at has passed.
ALTER TABLE booking_requests
  -- The Stripe charge backing the payment intent. Used as source_transaction
  -- when we create the transfer, and as the target for reversals on refund.
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  -- The owner's cut, in cents (rental + delivery - owner fee). Computed at
  -- checkout from authoritative listing data.
  ADD COLUMN IF NOT EXISTS payout_amount_cents integer,
  -- The renter's 8% service fee, in cents. Non-refundable when a renter cancels
  -- a rental within 72h of start, or cancels a purchase at any time.
  ADD COLUMN IF NOT EXISTS renter_fee_cents integer,
  -- When the held funds become eligible to transfer to the owner.
  -- Rentals: start_date 00:00 UTC + 24h. Sales / no dates: payment time + 24h.
  ADD COLUMN IF NOT EXISTS payout_release_at timestamptz,
  -- When the transfer actually succeeded — the true "paid out" date that
  -- owner earnings totals are reported against.
  ADD COLUMN IF NOT EXISTS payout_released_at timestamptz,
  -- pending | releasing | released | reversed | skipped | failed
  -- ('releasing' is a transient claim held by release-payouts during a transfer)
  ADD COLUMN IF NOT EXISTS payout_status text DEFAULT 'pending',
  -- The Stripe transfer id, once the payout has been released.
  ADD COLUMN IF NOT EXISTS transfer_id text;

-- The release job scans for due, unpaid-out, paid bookings every hour.
CREATE INDEX IF NOT EXISTS idx_booking_requests_payout_due
  ON booking_requests(payout_release_at)
  WHERE payout_status = 'pending';
