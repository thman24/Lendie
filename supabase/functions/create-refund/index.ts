import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { bookingId } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: booking, error: bookingErr } = await supabaseAdmin
      .from('booking_requests')
      .select('id, renter_id, owner_id, payment_intent_id, payment_status, item_title, renter_name, transfer_id, payout_status, status, start_date, end_date, stripe_amount_cents, renter_fee_cents')
      .eq('id', bookingId)
      .single();

    if (bookingErr || !booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404, headers: corsHeaders });
    }

    if (booking.renter_id !== user.id && booking.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
    }

    if (booking.payment_status !== 'paid') {
      return new Response(JSON.stringify({ error: 'Booking is not in a paid state' }), { status: 400, headers: corsHeaders });
    }

    // Past transactions cannot be refunded: already completed, or (for rentals)
    // the rental window has elapsed. Sales/services have no dates and are only
    // blocked once completed. This is the authoritative server-side enforcement.
    const lastDay = booking.end_date || booking.start_date;
    const rentalEnded = lastDay && String(lastDay).slice(0, 10) < new Date().toISOString().slice(0, 10);
    if (booking.status === 'completed' || rentalEnded) {
      return new Response(JSON.stringify({ error: 'This transaction has ended and can no longer be refunded.' }), { status: 400, headers: corsHeaders });
    }

    if (!booking.payment_intent_id) {
      return new Response(JSON.stringify({ error: 'No payment to refund' }), { status: 400, headers: corsHeaders });
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

    // Gentle cancellation policy. With delayed charging, a booking is only ever
    // charged within 24h of the rental (or immediately for sales / last-minute) —
    // cancellations before that happen while unpaid and never reach this function.
    // So once we're here (payment is 'paid'):
    //  - Owner/provider cancels -> always full refund, no fee kept.
    //  - Renter/buyer cancels    -> refund everything except the 8% service fee.
    const isOwner = user.id === booking.owner_id;
    const feeCents = booking.renter_fee_cents ?? 0;
    const keepFee = !isOwner && feeCents > 0;
    const refundCents = keepFee
      ? Math.max(0, (booking.stripe_amount_cents ?? 0) - feeCents)
      : null; // null => full refund

    // Coordinate the payout BEFORE refunding so the hourly release-payouts cron
    // can't transfer the owner's cut in the gap between refund and DB update —
    // that race would pay the owner AND fully refund the renter. These guarded
    // updates (where payout_status=<expected>) are atomic; a 0-row match means
    // another actor changed the row, so we re-read and react.
    let claimedToSkipped = false;
    if (booking.payout_status === 'pending') {
      const { data: claimed } = await supabaseAdmin
        .from('booking_requests')
        .update({ payout_status: 'skipped' })
        .eq('id', bookingId)
        .eq('payout_status', 'pending')
        .select('id');
      if (claimed && claimed.length > 0) {
        booking.payout_status = 'skipped';
        claimedToSkipped = true;
      } else {
        // Lost the claim — the cron grabbed it. Re-read to see where it landed.
        const { data: fresh } = await supabaseAdmin
          .from('booking_requests')
          .select('transfer_id, payout_status')
          .eq('id', bookingId)
          .single();
        booking.transfer_id = fresh?.transfer_id ?? booking.transfer_id;
        booking.payout_status = fresh?.payout_status ?? booking.payout_status;
      }
    }

    // If a transfer is mid-flight, don't refund yet, or we'd pay out AND refund
    // with no reversal. Re-read once in case it just finished: if it's now
    // 'released' we fall through and reverse it below; if still in flight, bail
    // and let the renter retry in a moment. This must run on EVERY path (the
    // initial read itself can already be 'releasing'), not just the pending one.
    if (booking.payout_status === 'releasing') {
      const { data: fresh } = await supabaseAdmin
        .from('booking_requests')
        .select('transfer_id, payout_status')
        .eq('id', bookingId)
        .single();
      booking.transfer_id = fresh?.transfer_id ?? booking.transfer_id;
      booking.payout_status = fresh?.payout_status ?? booking.payout_status;
      if (booking.payout_status === 'releasing') {
        return new Response(JSON.stringify({
          error: 'This payout is processing right now. Please try cancelling again in a minute.',
        }), { status: 409, headers: corsHeaders });
      }
    }

    // Refund the renter from the platform balance.
    let refund;
    try {
      refund = await stripe.refunds.create({
        payment_intent: booking.payment_intent_id,
        ...(refundCents != null ? { amount: refundCents } : {}),
      });
      if (refund.status !== 'succeeded' && refund.status !== 'pending') {
        throw new Error(`refund status ${refund.status}`);
      }
    } catch (e) {
      // Roll our own claim back so the still-valid booking can pay out normally.
      if (claimedToSkipped) {
        await supabaseAdmin
          .from('booking_requests')
          .update({ payout_status: 'pending' })
          .eq('id', bookingId)
          .eq('payout_status', 'skipped');
      }
      console.error(`[create-refund] booking ${booking.id} refund failed:`, e.message);
      return new Response(JSON.stringify({ error: 'Refund failed' }), { status: 500, headers: corsHeaders });
    }

    // If the owner's payout already left the platform (transfer released — i.e. we
    // lost the claim race above), claw it back so the refund doesn't come purely
    // out of platform funds. Pending payouts were already neutralised to 'skipped'.
    let payoutUpdate: Record<string, unknown> = {};
    if (booking.transfer_id && booking.payout_status === 'released') {
      try {
        await stripe.transfers.createReversal(booking.transfer_id, {
          metadata: { booking_id: String(booking.id), reason: 'refund' },
        }, { idempotencyKey: `reversal-booking-${booking.id}` });
        payoutUpdate = { payout_status: 'reversed' };
      } catch (e) {
        // Surface the failure — the refund succeeded but the clawback didn't, so
        // this needs manual attention rather than a silent loss.
        console.error(`[create-refund] booking ${booking.id} transfer reversal failed:`, e.message);
        return new Response(JSON.stringify({
          error: 'Refund issued, but reversing the owner payout failed. Contact support.',
        }), { status: 500, headers: corsHeaders });
      }
    }

    await supabaseAdmin
      .from('booking_requests')
      // Base 'skipped' neutralises any inert leftover status; a reversal in
      // payoutUpdate overrides it to 'reversed'. cancelled_by attributes the
      // cancellation to whoever initiated it (this fn runs as service_role, so
      // the DB trigger's auth.uid() fallback would be null without this).
      .update({ payment_status: 'refunded', status: 'cancelled', payout_status: 'skipped', cancelled_by: user.id, cancellation_reason: isOwner ? 'owner_cancelled' : 'renter_cancelled', ...payoutUpdate })
      .eq('id', bookingId);

    // Notify the other party
    const isRenter = user.id === booking.renter_id;
    const notifyUserId = isRenter ? booking.owner_id : booking.renter_id;
    const notifyText = isRenter
      ? `Booking cancelled: ${booking.item_title}`
      : `Booking cancelled by owner: ${booking.item_title}`;
    const notifySub = isRenter
      ? `${booking.renter_name} cancelled — refund issued`
      : 'A refund has been issued to the renter';

    if (notifyUserId) {
      await supabaseAdmin.from('notifications').insert({
        user_id: notifyUserId,
        icon: '↩️',
        text: notifyText,
        sub: notifySub,
        time_label: 'Just now',
        unread: true,
        type: 'payment',
      });
    }

    return new Response(JSON.stringify({
      success: true,
      refundId: refund.id,
      refundedCents: refund.amount,
      feeKeptCents: keepFee ? feeCents : 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[create-refund] error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
