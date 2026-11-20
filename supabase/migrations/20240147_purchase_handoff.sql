-- Purchases: start the payout clock at the HANDOFF, not at payment.
-- A local pickup can be days after payment, so "72h after payment" could pay the
-- seller before the buyer has the item. Now, for undated (purchase/service) bookings:
--   * buyer taps "Received — all good"  -> payout 24h later
--   * seller marks it handed over        -> buyer notified; payout 72h later
--   * neither                            -> backstop: payout 14 days after payment
-- handed_over_at records the seller's mark (set only by the booking-escrow fn).

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS handed_over_at timestamptz;

-- Re-create the money-field guard (from 20240146) to also protect handed_over_at.
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
       OR NEW.paid_at IS NOT NULL OR NEW.buyer_confirmed_at IS NOT NULL OR NEW.handed_over_at IS NOT NULL
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
     OR NEW.handed_over_at     IS DISTINCT FROM OLD.handed_over_at
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

