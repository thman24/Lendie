import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Scheduled job (pg_cron, hourly): releases held owner payouts whose
// payout_release_at has passed. We charged the full amount onto the platform
// account at checkout, so the money is sitting in our Stripe balance; here we
// create the Stripe transfer that moves the owner's cut to their connected
// account. Idempotent per booking via the transfer idempotency key.
Deno.serve(async (req) => {
  // Only the cron caller (service-role key) may invoke this.
  const auth = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (auth !== `Bearer ${serviceKey}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

  const nowIso = new Date().toISOString();

  // Due, paid, not-yet-paid-out bookings. Cap the batch so a backlog can't
  // exceed the function timeout — the next hourly run picks up the rest.
  const { data: due, error } = await supabase
    .from('booking_requests')
    .select('id, owner_id, stripe_charge_id, payout_amount_cents, payment_status, payout_status')
    .eq('payment_status', 'paid')
    .eq('payout_status', 'pending')
    .lte('payout_release_at', nowIso)
    .not('payout_amount_cents', 'is', null)
    .limit(100);

  if (error) {
    console.error('[release-payouts] query failed:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let released = 0, skipped = 0, failed = 0;

  for (const b of due ?? []) {
    if (!b.payout_amount_cents || b.payout_amount_cents <= 0 || !b.stripe_charge_id) {
      await supabase.from('booking_requests')
        .update({ payout_status: 'skipped' }).eq('id', b.id);
      skipped++;
      continue;
    }

    // Resolve the owner's connected account fresh (could have changed since checkout).
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('stripe_account_id, stripe_charges_enabled')
      .eq('id', b.owner_id)
      .single();

    if (!ownerProfile?.stripe_account_id || !ownerProfile?.stripe_charges_enabled) {
      // Leave as pending — owner may finish onboarding before the next run.
      console.warn(`[release-payouts] booking ${b.id}: owner not payable yet, leaving pending`);
      skipped++;
      continue;
    }

    // Atomically claim the row (pending -> releasing) before transferring, so a
    // concurrent refund can't neutralise the payout in the gap between our SELECT
    // and the transfer. If we don't win the claim, a refund took it — skip.
    const { data: claimed } = await supabase
      .from('booking_requests')
      .update({ payout_status: 'releasing' })
      .eq('id', b.id)
      .eq('payout_status', 'pending')
      .select('id');
    if (!claimed || claimed.length === 0) {
      skipped++;
      continue;
    }

    try {
      const transfer = await stripe.transfers.create({
        amount: b.payout_amount_cents,
        currency: 'usd',
        destination: ownerProfile.stripe_account_id,
        source_transaction: b.stripe_charge_id,
        metadata: { booking_id: String(b.id) },
      }, { idempotencyKey: `transfer-booking-${b.id}` });

      await supabase.from('booking_requests')
        .update({ payout_status: 'released', transfer_id: transfer.id, payout_released_at: new Date().toISOString() })
        .eq('id', b.id);
      released++;
    } catch (e) {
      // Roll the claim back to pending so it retries next run.
      await supabase.from('booking_requests')
        .update({ payout_status: 'pending' })
        .eq('id', b.id)
        .eq('payout_status', 'releasing');
      console.error(`[release-payouts] booking ${b.id} transfer failed:`, e.message);
      failed++;
    }
  }

  console.log(`[release-payouts] released=${released} skipped=${skipped} failed=${failed}`);
  return new Response(JSON.stringify({ released, skipped, failed }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
