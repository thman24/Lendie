-- Escrow buyer protection + disputes.
--
-- Payouts are now held until the buyer/renter has had a chance to raise a problem:
--   * Purchases / undated services: released when the buyer confirms receipt, or
--     automatically 72h after payment.
--   * Dated rentals / services: released 24h after the last day (end_date + 1 day
--     00:00 UTC + 24h), so either side can report a problem (incl. damage on return).
-- Reporting a problem moves payout_status pending -> 'disputed', which the hourly
-- release-payouts job never picks up. An admin resolves it (release / refund /
-- partial refund) via the booking-escrow edge function.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,             -- when the card charge succeeded
  ADD COLUMN IF NOT EXISTS buyer_confirmed_at timestamptz,  -- buyer tapped "Received — all good"
  ADD COLUMN IF NOT EXISTS dispute_status text,             -- null | 'open' | 'resolved'
  ADD COLUMN IF NOT EXISTS dispute_reason text,             -- not_as_described | not_received | damaged | other
  ADD COLUMN IF NOT EXISTS dispute_note text,
  ADD COLUMN IF NOT EXISTS disputed_by text,                -- user id of the reporter
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_resolution text,         -- released | refunded | partial_refund
  ADD COLUMN IF NOT EXISTS dispute_refund_cents integer,
  ADD COLUMN IF NOT EXISTS dispute_resolved_at timestamptz;

-- Best-effort backfill for any already-paid rows (card payments are dormant, so
-- normally none): payment time was release time - 24h under the old rule.
UPDATE booking_requests
   SET paid_at = COALESCE(payout_release_at - interval '24 hours', created_at)
 WHERE payment_status = 'paid' AND paid_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_requests_open_disputes
  ON booking_requests(disputed_at) WHERE dispute_status = 'open';

-- ── Money-field guard ────────────────────────────────────────────────────────
-- The update RLS policy lets the renter or owner update *any* column of their
-- booking row. Without this guard a user could, e.g., set payout_release_at to
-- now (skipping escrow), flip 'disputed' back to 'pending', inflate
-- payout_amount_cents, or mark a booking 'paid'. Only trusted server code
-- (service_role: edge functions, cron; or postgres in the SQL editor) may touch
-- payment/payout/dispute state. Ordinary client writes (status, cash,
-- delivery_confirmed, dates, conversation_id, ...) are unaffected.
CREATE OR REPLACE FUNCTION public.guard_booking_money_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  stripe_states text[] := ARRAY['saving','scheduled','charging','paid','refunded','payment_failed','processing'];
BEGIN
  IF coalesce(auth.role(), '') = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_status = ANY(stripe_states)
       OR NEW.payment_intent_id IS NOT NULL OR NEW.stripe_charge_id IS NOT NULL
       OR NEW.transfer_id IS NOT NULL OR NEW.payout_amount_cents IS NOT NULL
       OR NEW.payout_release_at IS NOT NULL OR NEW.payout_released_at IS NOT NULL
       OR NEW.stripe_amount_cents IS NOT NULL OR NEW.renter_fee_cents IS NOT NULL
       OR NEW.paid_at IS NOT NULL OR NEW.buyer_confirmed_at IS NOT NULL
       OR NEW.dispute_status IS NOT NULL
       OR coalesce(NEW.payout_status, 'pending') <> 'pending' THEN
      RAISE EXCEPTION 'payment fields can only be set by the server' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.payout_status        IS DISTINCT FROM OLD.payout_status
     OR NEW.payout_release_at  IS DISTINCT FROM OLD.payout_release_at
     OR NEW.payout_released_at IS DISTINCT FROM OLD.payout_released_at
     OR NEW.payout_amount_cents IS DISTINCT FROM OLD.payout_amount_cents
     OR NEW.transfer_id        IS DISTINCT FROM OLD.transfer_id
     OR NEW.stripe_charge_id   IS DISTINCT FROM OLD.stripe_charge_id
     OR NEW.payment_intent_id  IS DISTINCT FROM OLD.payment_intent_id
     OR NEW.stripe_amount_cents IS DISTINCT FROM OLD.stripe_amount_cents
     OR NEW.renter_fee_cents   IS DISTINCT FROM OLD.renter_fee_cents
     OR NEW.paid_at            IS DISTINCT FROM OLD.paid_at
     OR NEW.buyer_confirmed_at IS DISTINCT FROM OLD.buyer_confirmed_at
     OR NEW.dispute_status     IS DISTINCT FROM OLD.dispute_status
     OR NEW.dispute_reason     IS DISTINCT FROM OLD.dispute_reason
     OR NEW.dispute_note       IS DISTINCT FROM OLD.dispute_note
     OR NEW.disputed_by        IS DISTINCT FROM OLD.disputed_by
     OR NEW.disputed_at        IS DISTINCT FROM OLD.disputed_at
     OR NEW.dispute_resolution IS DISTINCT FROM OLD.dispute_resolution
     OR NEW.dispute_refund_cents IS DISTINCT FROM OLD.dispute_refund_cents
     OR NEW.dispute_resolved_at IS DISTINCT FROM OLD.dispute_resolved_at
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_payment_method_id IS DISTINCT FROM OLD.stripe_payment_method_id
     OR NEW.charge_at          IS DISTINCT FROM OLD.charge_at THEN
    RAISE EXCEPTION 'payment fields can only be changed by the server' USING ERRCODE = '42501';
  END IF;

  -- payment_status: clients may move between their own non-Stripe states
  -- (e.g. delivery_confirmed -> cash) but never into or out of a Stripe state.
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND (OLD.payment_status = ANY(stripe_states) OR NEW.payment_status = ANY(stripe_states)) THEN
    RAISE EXCEPTION 'payment status can only be changed by the server' USING ERRCODE = '42501';
  END IF;

  -- A card-paid booking must be cancelled through create-refund (which refunds
  -- and neutralises the payout), never by a bare status flip that would leave the
  -- payout scheduled and the buyer unrefunded.
  IF OLD.payment_status = 'paid'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('cancelled', 'declined') THEN
    RAISE EXCEPTION 'paid bookings must be cancelled through the refund flow' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_booking_money_fields ON public.booking_requests;
CREATE TRIGGER trg_guard_booking_money_fields
  BEFORE INSERT OR UPDATE ON public.booking_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_money_fields();
