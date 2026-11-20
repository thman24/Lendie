-- Don't let conversations, messages or bookings be deleted while a payment is
-- still open on them. "Open" = not cancelled/declined AND any of:
--   * accepted/confirmed and still awaiting payment (unpaid/pending/delivery_confirmed)
--   * card being saved / scheduled / charging / failed-awaiting-retry / processing
--   * paid but the owner payout is still held (pending / disputed / releasing)
--   * a dispute is open
-- Cash bookings (payment_status 'cash') are settled outside Lendie: not "open".
-- Service-role code (edge functions, admin tools) is exempt.

CREATE OR REPLACE FUNCTION public.booking_payment_open(b booking_requests)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(b.status, '') NOT IN ('cancelled', 'declined') AND (
       (b.status IN ('accepted', 'confirmed') AND coalesce(b.payment_status, 'unpaid') IN ('unpaid', 'pending', 'delivery_confirmed'))
    OR b.payment_status IN ('saving', 'scheduled', 'charging', 'payment_failed', 'processing')
    OR (b.payment_status = 'paid' AND b.payout_status IN ('pending', 'disputed', 'releasing'))
    OR b.dispute_status = 'open'
  );
$$;

CREATE OR REPLACE FUNCTION public.conversation_payment_open(conv text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT conv IS NOT NULL AND EXISTS (
    SELECT 1 FROM booking_requests b
     WHERE b.conversation_id = conv AND public.booking_payment_open(b));
$$;

CREATE OR REPLACE FUNCTION public.is_trusted_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(auth.role(), '') = 'service_role'
      OR current_user IN ('postgres', 'supabase_admin', 'service_role');
$$;

-- 1) Hiding ("deleting") a conversation from your inbox.
CREATE OR REPLACE FUNCTION public.guard_hide_open_conversation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.is_trusted_role() AND public.conversation_payment_open(NEW.conversation_id::text) THEN
    RAISE EXCEPTION 'This conversation has a payment that is still open and can''t be deleted yet.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_hide_open_conversation ON public.hidden_conversations;
CREATE TRIGGER trg_guard_hide_open_conversation
  BEFORE INSERT OR UPDATE ON public.hidden_conversations
  FOR EACH ROW EXECUTE FUNCTION public.guard_hide_open_conversation();

-- 2) Actually deleting messages (e.g. the account-deletion path).
CREATE OR REPLACE FUNCTION public.guard_delete_open_messages()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.is_trusted_role() AND public.conversation_payment_open(OLD.conversation_id::text) THEN
    RAISE EXCEPTION 'Messages in a conversation with an open payment can''t be deleted yet.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_delete_open_messages ON public.messages;
CREATE TRIGGER trg_guard_delete_open_messages
  BEFORE DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_delete_open_messages();

-- 3) Deleting a booking row that still has an open payment.
CREATE OR REPLACE FUNCTION public.guard_delete_open_booking()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.is_trusted_role() AND public.booking_payment_open(OLD) THEN
    RAISE EXCEPTION 'A booking with an open payment can''t be deleted.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_delete_open_booking ON public.booking_requests;
CREATE TRIGGER trg_guard_delete_open_booking
  BEFORE DELETE ON public.booking_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_delete_open_booking();
