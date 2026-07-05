import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Scheduled job (pg_cron, hourly) for delayed charging.
//
//  Part A — charge saved cards that are now due. Bookings sit in 'scheduled'
//  (card saved off-session) with charge_at = 24h before the rental. When due we
//  create an off-session PaymentIntent against the saved (customer, card). On
//  success the booking becomes 'paid' and the normal payout hold / release-payouts
//  flow takes over (dates were already blocked at owner acceptance).
//
//  Part B — sweep failed charges. A decline moves the booking to 'payment_failed'
//  and notifies the renter with a pay-now link (also clears any 3DS requirement).
//  We retry through a grace window; if still unpaid by the rental day, auto-cancel
//  and free the dates (via the free_booked_dates_on_cancel trigger).
//
// Scheduled-charge PaymentIntents carry metadata.flow='scheduled' so the
// stripe-webhook ignores them — this cron owns their outcome + notifications, so
// there's no double-processing.

const RELEASE_DELAY_MS = 24 * 60 * 60 * 1000; // owner payout held until start + 24h
const MAX_ATTEMPTS = 4;
const STUCK_CHARGING_MS = 2 * 60 * 60 * 1000;  // reclaim a 'charging' row abandoned >2h

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
    console.error('[charge-due-bookings] sendEmail failed:', e);
  }
};

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (auth !== `Bearer ${serviceKey}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  const nowIso = new Date().toISOString();

  const cols = 'id, renter_id, owner_id, item_title, start_date, stripe_amount_cents, payout_amount_cents, stripe_customer_id, stripe_payment_method_id, charge_attempts, payment_failed_at, payment_status';

  // Attempt an off-session charge for a booking. Returns 'paid' | 'failed'.
  // Idempotency key makes re-attempts (including a recovered 'charging' row whose
  // PI already succeeded) safe — Stripe returns the existing PI rather than
  // charging twice.
  const attemptCharge = async (b: any): Promise<'paid' | 'failed'> => {
    if (!b.stripe_amount_cents || !b.stripe_customer_id || !b.stripe_payment_method_id) {
      await markFailed(b, 'Missing saved card');
      return 'failed';
    }
    try {
      const pi = await stripe.paymentIntents.create({
        amount: b.stripe_amount_cents,
        currency: 'usd',
        customer: b.stripe_customer_id,
        payment_method: b.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        payment_method_types: ['card'],
        metadata: { flow: 'scheduled', booking_id: String(b.id), user_id: b.renter_id },
        // Include the attempt number so a retry after a decline is a genuinely new
        // charge, not Stripe replaying the cached decline for the same key. Still
        // idempotent within a single attempt (guards double-charge on our retries).
      }, { idempotencyKey: `pi-scheduled-${b.id}-${b.charge_attempts || 0}` });

      if (pi.status !== 'succeeded' && pi.status !== 'processing') {
        await markFailed(b, `PaymentIntent status ${pi.status}`);
        return 'failed';
      }

      const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
      // Hold the owner's payout until 24h after the rental begins.
      const releaseAt = new Date(new Date(`${b.start_date}T00:00:00Z`).getTime() + RELEASE_DELAY_MS).toISOString();

      // Guarded transition: only the run that flips charging→paid notifies.
      const { data: won } = await supabase
        .from('booking_requests')
        .update({
          payment_status: 'paid',
          payment_intent_id: pi.id,
          stripe_charge_id: chargeId,
          payout_release_at: releaseAt,
          charge_last_error: null,
        })
        .eq('id', b.id)
        .eq('payment_status', 'charging')
        .select('id');

      if (won && won.length) {
        const amt = (b.stripe_amount_cents / 100).toFixed(2);
        await supabase.from('notifications').insert([
          { user_id: b.renter_id, icon: '✅', text: `Payment charged: $${amt}`, sub: `${b.item_title} is confirmed — you're all set!`, time_label: 'Just now', unread: true, type: 'payment' },
          { user_id: b.owner_id, icon: '💰', text: `Payment received: $${amt}`, sub: `For ${b.item_title} — booking confirmed`, time_label: 'Just now', unread: true, type: 'payment' },
        ]);
        await sendEmail(b.renter_id, `Payment charged — ${b.item_title}`,
          `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">✅ Payment charged</h2>
           <p style="margin:0 0 16px;color:#3A3B3C;font-size:15px">As scheduled, your card was charged <strong>$${amt}</strong> for <strong>${b.item_title}</strong>. You're all set!</p>`);
      }
      return 'paid';
    } catch (e: any) {
      await markFailed(b, e?.code || e?.message || 'charge failed');
      return 'failed';
    }
  };

  // Move a booking into the notify+grace window and ping the renter.
  const markFailed = async (b: any, reason: string) => {
    const firstFail = !b.payment_failed_at;
    await supabase
      .from('booking_requests')
      .update({
        payment_status: 'payment_failed',
        charge_attempts: (b.charge_attempts || 0) + 1,
        charge_last_error: reason,
        payment_failed_at: b.payment_failed_at || nowIso,
      })
      .eq('id', b.id);

    // Only notify on the first failure — retries shouldn't spam.
    if (firstFail) {
      await supabase.from('notifications').insert({
        user_id: b.renter_id, icon: '❌',
        text: 'Payment needs attention',
        sub: `We couldn't charge your card for ${b.item_title}. Tap to pay before your rental day.`,
        time_label: 'Just now', unread: true, type: 'payment',
      });
      await sendEmail(b.renter_id, `Action needed: payment for ${b.item_title}`,
        `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">❌ We couldn't charge your card</h2>
         <p style="margin:0 0 12px;color:#3A3B3C;font-size:15px">Your scheduled payment for <strong>${b.item_title}</strong> didn't go through. Please complete payment before your rental day, or the booking will be cancelled.</p>
         <a href="https://www.lendie.app/?tab=messages" style="display:inline-block;background:#00B894;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Complete Payment</a>`);
    }
  };

  let charged = 0, failed = 0, cancelled = 0, skipped = 0;

  // ── Part A: due 'scheduled' bookings (+ recovery of abandoned 'charging') ────
  const { data: due } = await supabase
    .from('booking_requests')
    .select(cols)
    .eq('payment_status', 'scheduled')
    .lte('charge_at', nowIso)
    .neq('status', 'cancelled')
    .neq('status', 'declined')
    .limit(50);

  for (const b of due ?? []) {
    // Atomically claim scheduled→charging so overlapping runs can't double-charge.
    const { data: claimed } = await supabase
      .from('booking_requests')
      .update({ payment_status: 'charging' })
      .eq('id', b.id)
      .eq('payment_status', 'scheduled')
      .neq('status', 'cancelled')
      .neq('status', 'declined')
      .select('id');
    if (!claimed || !claimed.length) { skipped++; continue; }
    const res = await attemptCharge({ ...b, payment_status: 'charging' });
    res === 'paid' ? charged++ : failed++;
  }

  // Recover rows left in 'charging' by a crashed prior run (idempotent charge).
  const stuckBefore = new Date(Date.now() - STUCK_CHARGING_MS).toISOString();
  const { data: stuck } = await supabase
    .from('booking_requests')
    .select(cols)
    .eq('payment_status', 'charging')
    .neq('status', 'cancelled')
    .neq('status', 'declined')
    .lte('charge_at', stuckBefore)
    .limit(25);
  for (const b of stuck ?? []) {
    const res = await attemptCharge(b);
    res === 'paid' ? charged++ : failed++;
  }

  // ── Part B: sweep 'payment_failed' — retry, or auto-cancel by rental day ─────
  // Exclude already-cancelled/declined bookings: a renter can cancel during the
  // grace window (which leaves payment_status='payment_failed'), and we must not
  // charge or re-cancel a booking that's already cancelled.
  const { data: stuckFailed } = await supabase
    .from('booking_requests')
    .select(cols)
    .eq('payment_status', 'payment_failed')
    .neq('status', 'cancelled')
    .neq('status', 'declined')
    .limit(50);

  for (const b of stuckFailed ?? []) {
    // Rental day reached (start_date 00:00 UTC) → give up and auto-cancel. The
    // renter has the full ~24h from charge_at to the rental day as grace; the
    // attempts cap only stops us retrying, it doesn't cancel early.
    const rentalDayMs = b.start_date ? new Date(`${b.start_date}T00:00:00Z`).getTime() : 0;
    const pastDeadline = rentalDayMs && Date.now() >= rentalDayMs;

    if (pastDeadline) {
      // Auto-cancel. cancelled_by left null = system action (counts against no
      // one); the DB triggers stamp cancelled_at and free the held dates.
      await supabase.from('booking_requests')
        .update({ status: 'cancelled', payment_status: 'cancelled', cancellation_reason: 'payment_failed_autocancel' })
        .eq('id', b.id)
        .eq('payment_status', 'payment_failed');
      await supabase.from('notifications').insert([
        { user_id: b.renter_id, icon: '🚫', text: `Booking cancelled — ${b.item_title}`, sub: 'Payment could not be completed in time.', time_label: 'Just now', unread: true, type: 'cancel' },
        { user_id: b.owner_id, icon: '🚫', text: `Booking cancelled — ${b.item_title}`, sub: "The renter's payment could not be completed; dates are free again.", time_label: 'Just now', unread: true, type: 'cancel' },
      ]);
      await sendEmail(b.renter_id, `Booking cancelled — ${b.item_title}`,
        `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">🚫 Booking cancelled</h2>
         <p style="margin:0 0 12px;color:#3A3B3C;font-size:15px">We weren't able to charge your card for <strong>${b.item_title}</strong> before the rental day, so the booking was cancelled and no charge was made.</p>`);
      cancelled++;
      continue;
    }

    // Still before the deadline — retry while we have attempts left.
    if ((b.charge_attempts || 0) < MAX_ATTEMPTS) {
      // Re-claim payment_failed→charging so attemptCharge's guarded paid-transition works.
      const { data: claimed } = await supabase
        .from('booking_requests')
        .update({ payment_status: 'charging' })
        .eq('id', b.id)
        .eq('payment_status', 'payment_failed')
        .select('id');
      if (!claimed || !claimed.length) { skipped++; continue; }
      const res = await attemptCharge({ ...b, payment_status: 'charging' });
      res === 'paid' ? charged++ : failed++;
    } else {
      skipped++;
    }
  }

  console.log(`[charge-due-bookings] charged=${charged} failed=${failed} cancelled=${cancelled} skipped=${skipped}`);
  return new Response(JSON.stringify({ charged, failed, cancelled, skipped }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
