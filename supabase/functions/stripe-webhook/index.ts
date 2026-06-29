import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Mirror App.jsx getDatesInRange — produces UTC YYYY-MM-DD keys that match
// the format stored in listings.booked and rendered by the calendar.
const getDatesInRange = (start: string | null, end: string | null): string[] => {
  if (!start) return [];
  const dates: string[] = [];
  const d = new Date(start);
  const e = new Date(end || start);
  if (isNaN(d.getTime()) || isNaN(e.getTime())) return [];
  // Guard against a malformed range producing an unbounded loop
  let guard = 0;
  while (d <= e && guard < 400) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
    guard++;
  }
  return dates;
};

const sendEmail = async (userId: string, subject: string, html: string) => {
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, subject, html }),
    });
  } catch (e) {
    console.error('[stripe-webhook] sendEmail failed:', e);
  }
};

Deno.serve(async (req) => {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata?.booking_id;
      const listingTitle = pi.metadata?.listing_title;
      const amountDollars = (pi.amount / 100).toFixed(2);

      // Fetch booking to get both renter and owner IDs (plus the listing + dates
      // we need to block the calendar)
      let renterId: string | null = pi.metadata?.user_id || null;
      let ownerId: string | null = null;
      let listingId: string | number | null = pi.metadata?.listing_id || null;
      let startDate: string | null = pi.metadata?.start_date || null;
      let endDate: string | null = pi.metadata?.end_date || null;

      if (bookingId) {
        const { data: booking, error } = await supabase
          .from('booking_requests')
          .select('renter_id, owner_id, item_json, start_date, end_date, status, payment_status')
          .eq('id', bookingId)
          .single();
        if (error) console.error('[stripe-webhook] failed to fetch booking:', error.message);
        // Stripe redelivers events. If this booking was already cancelled/refunded,
        // do nothing — otherwise we'd flip it back to 'paid' and re-block the dates
        // that were freed on cancel.
        if (booking && (booking.payment_status === 'refunded' || booking.status === 'cancelled')) {
          console.log(`[stripe-webhook] booking ${bookingId} already ${booking.status}/${booking.payment_status} — skipping succeeded handler`);
          break;
        }
        if (booking) {
          renterId = booking.renter_id;
          ownerId = booking.owner_id;
          // Prefer the authoritative booking row over PI metadata
          listingId = booking.item_json?.id ?? listingId;
          startDate = booking.start_date ?? startDate;
          endDate = booking.end_date ?? endDate;
        }
        // Hold the owner's payout in the platform balance until 24h after the
        // rental begins (start_date 00:00 UTC + 24h), or 24h after payment for
        // sales / open-ended bookings. The release-payouts job transfers it then.
        const RELEASE_DELAY_MS = 24 * 60 * 60 * 1000;
        const releaseAt = startDate
          ? new Date(new Date(`${startDate}T00:00:00Z`).getTime() + RELEASE_DELAY_MS)
          : new Date(Date.now() + RELEASE_DELAY_MS);
        // latest_charge is the charge we transfer from (source_transaction) and
        // reverse against on refund.
        const chargeId = typeof pi.latest_charge === 'string'
          ? pi.latest_charge
          : pi.latest_charge?.id ?? null;

        await supabase
          .from('booking_requests')
          .update({
            payment_status: 'paid',
            payment_intent_id: pi.id,
            stripe_charge_id: chargeId,
            payout_release_at: releaseAt.toISOString(),
          })
          .eq('id', bookingId);
      }

      // Block the booked dates on the listing calendar. Owner-accepted bookings
      // block at accept time, but a pure pay-first card booking has no accept
      // step — without this the dates stay open and another renter could
      // double-book them. Set-dedupe keeps this idempotent on Stripe redelivery.
      if (listingId && startDate) {
        const newDates = getDatesInRange(startDate, endDate);
        if (newDates.length) {
          const { data: listing, error: listingErr } = await supabase
            .from('listings')
            .select('booked')
            .eq('id', listingId)
            .single();
          if (listingErr) {
            console.error('[stripe-webhook] failed to fetch listing for date block:', listingErr.message);
          } else {
            const merged = [...new Set([...(listing?.booked || []), ...newDates])];
            const { error: updErr } = await supabase
              .from('listings')
              .update({ booked: merged })
              .eq('id', listingId);
            if (updErr) console.error('[stripe-webhook] failed to block dates:', updErr.message);
          }
        }
      }

      // Notify owner
      if (ownerId) {
        await supabase.from('notifications').insert({
          user_id: ownerId,
          icon: '💰',
          text: `Payment received: $${amountDollars}`,
          sub: `For ${listingTitle} — booking confirmed`,
          time_label: 'Just now',
          unread: true,
          type: 'payment',
        });
        await sendEmail(ownerId, `Payment received: $${amountDollars}`,
          `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">💰 Payment received!</h2>
           <p style="margin:0 0 16px;color:#3A3B3C;font-size:15px">You received a payment of <strong>$${amountDollars}</strong> for <strong>${listingTitle}</strong>. The booking is confirmed.</p>
           <a href="https://www.lendie.app" style="display:inline-block;background:#00B894;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">View in Lendie</a>`
        );
      }

      // Notify renter — confirm their payment went through
      if (renterId) {
        await supabase.from('notifications').insert({
          user_id: renterId,
          icon: '✅',
          text: `Payment confirmed: $${amountDollars}`,
          sub: `${listingTitle} is booked — you're all set!`,
          time_label: 'Just now',
          unread: true,
          type: 'payment',
        });
        await sendEmail(renterId, `Payment confirmed — ${listingTitle}`,
          `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">✅ Payment confirmed!</h2>
           <p style="margin:0 0 16px;color:#3A3B3C;font-size:15px">Your payment of <strong>$${amountDollars}</strong> for <strong>${listingTitle}</strong> went through — you're all set!</p>
           <a href="https://www.lendie.app" style="display:inline-block;background:#00B894;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">View in Lendie</a>`
        );
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata?.booking_id;

      if (bookingId) {
        await supabase
          .from('booking_requests')
          .update({ payment_status: 'failed' })
          .eq('id', bookingId);
      }

      const renterId = pi.metadata?.user_id;
      if (renterId) {
        await supabase.from('notifications').insert({
          user_id: renterId,
          icon: '❌',
          text: 'Payment failed',
          sub: `Your payment for ${pi.metadata?.listing_title} could not be processed`,
          time_label: 'Just now',
          unread: true,
          type: 'payment',
        });
        await sendEmail(renterId, 'Payment failed — action required',
          `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">❌ Payment failed</h2>
           <p style="margin:0 0 16px;color:#3A3B3C;font-size:15px">Your payment for <strong>${pi.metadata?.listing_title}</strong> could not be processed. Please update your payment method and try again.</p>
           <a href="https://www.lendie.app" style="display:inline-block;background:#00B894;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Try Again</a>`
        );
      }
      break;
    }

    case 'payment_intent.canceled': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata?.booking_id;
      if (bookingId) {
        await supabase
          .from('booking_requests')
          .update({ payment_status: 'cancelled' })
          .eq('id', bookingId);
      }
      break;
    }

    // Update owner's payout status when they complete or update their Connect account
    case 'account.updated': {
      const account = event.data.object as Stripe.Account;
      const userId = account.metadata?.user_id;

      if (userId) {
        // Read the PRIOR state before updating, so we can detect first activation
        // (was false → now true). Reading after the update always returns true.
        const { data: prior } = await supabase
          .from('profiles')
          .select('stripe_charges_enabled')
          .eq('id', userId)
          .single();

        await supabase.from('profiles').update({
          stripe_charges_enabled: account.charges_enabled,
          stripe_details_submitted: account.details_submitted,
          updated_at: new Date().toISOString(),
        }).eq('id', userId);

        // Notify the owner only on first activation (was not enabled, now enabled)
        if (account.charges_enabled && !prior?.stripe_charges_enabled) {
          await supabase.from('notifications').insert({
            user_id: userId,
            icon: '🎉',
            text: 'Payouts activated!',
            sub: 'Your Stripe account is verified — you can now receive payments',
            time_label: 'Just now',
            unread: true,
            type: 'payment',
          });
        }
      }
      break;
    }

    default:
      console.log('[stripe-webhook] unhandled event type:', event.type);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
