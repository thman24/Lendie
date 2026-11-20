-- Offers expire after 24 hours without a reply.
-- An offer thread stays alive while new offers/counters keep coming: a pending
-- offer row is expired only when it is >24h old AND its conversation has had no
-- "💸 Offer:" message in the last 24h. Expiry = status 'cancelled' with
-- cancellation_reason 'offer_expired' (pending -> cancelled is not a committed
-- cancellation, so it counts against no one). The buyer gets a notification.
-- The chat UI hides Accept/Counter on offers older than 24h on its own.

CREATE OR REPLACE FUNCTION public.expire_stale_offers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
  r record;
BEGIN
  FOR r IN
    UPDATE booking_requests br
       SET status = 'cancelled', cancellation_reason = 'offer_expired'
     WHERE br.status = 'pending'
       AND (br.date_str = 'Offer' OR br.date_str LIKE 'Offer:%')
       AND br.created_at < now() - interval '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM messages m
          WHERE br.conversation_id IS NOT NULL
            AND m.conversation_id::text = br.conversation_id::text
            AND m.content LIKE '💸 Offer:%'
            AND m.created_at > now() - interval '24 hours')
    RETURNING br.renter_id, br.item_title
  LOOP
    n := n + 1;
    INSERT INTO notifications (user_id, icon, text, sub, time_label, unread, type)
    VALUES (r.renter_id, '⌛', 'Offer expired: ' || coalesce(r.item_title, 'item'),
            'No reply within 24 hours. You can make a new offer.', 'Just now', true, 'cancel');
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_offers() FROM public, anon, authenticated;

SELECT cron.unschedule('expire-offers-hourly')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-offers-hourly');
SELECT cron.schedule('expire-offers-hourly', '45 * * * *', $$ select public.expire_stale_offers(); $$);
