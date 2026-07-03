-- Delayed charging: don't charge the renter's card until 24h before the rental
-- day begins. Instead of charging at checkout, we SAVE the card (Stripe
-- SetupIntent → off-session-usable payment method) and charge it later via the
-- charge-due-bookings cron. A cancellation before that charge costs zero Stripe
-- fees because no charge ever happened.
--
-- Scope: rentals + dated services with a start_date more than 24h out are
-- scheduled. Sales, undated services, and bookings starting within 24h charge
-- immediately at the payment step (which directly follows owner acceptance), so
-- "charge on acceptance" holds for them.
--
-- payment_status lifecycle (card path):
--   saving         SetupIntent created, awaiting the renter to confirm the card
--   scheduled      card saved off-session; charge_at holds when we'll charge
--   paid           off-session charge succeeded (set by payment_intent.succeeded)
--   payment_failed off-session charge failed; in the notify+grace window
--   (existing: pending, failed, refunded, cancelled, delivery_confirmed)

ALTER TABLE booking_requests
  -- Stripe Customer that owns the saved card — the off-session charge is made
  -- against (customer, payment_method).
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  -- The saved card (pm_...) to charge off-session when charge_at arrives.
  ADD COLUMN IF NOT EXISTS stripe_payment_method_id text,
  -- When to charge: rental/dated-service start_date 00:00 UTC − 24h. NULL means
  -- there's nothing scheduled (immediate-charge path).
  ADD COLUMN IF NOT EXISTS charge_at timestamptz,
  -- Off-session charge retry counter (declines during the grace window).
  ADD COLUMN IF NOT EXISTS charge_attempts integer DEFAULT 0,
  -- Last decline/error reason, surfaced to the renter and admin.
  ADD COLUMN IF NOT EXISTS charge_last_error text,
  -- When the off-session charge first failed — the grace-window clock that the
  -- auto-cancel path measures against.
  ADD COLUMN IF NOT EXISTS payment_failed_at timestamptz;

-- The charge cron scans for scheduled, due bookings.
CREATE INDEX IF NOT EXISTS idx_booking_requests_charge_due
  ON booking_requests(charge_at)
  WHERE payment_status = 'scheduled';

-- The failure sweeper scans for bookings stuck in the grace window.
CREATE INDEX IF NOT EXISTS idx_booking_requests_payment_failed
  ON booking_requests(payment_failed_at)
  WHERE payment_status = 'payment_failed';
