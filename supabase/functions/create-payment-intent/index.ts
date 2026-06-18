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

    const { listingId, startDate, endDate, wantsDelivery, deliveryAddress, existingBookingId } = await req.json();

    // Use service role to read authoritative listing data — never trust client-supplied prices
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: listing, error: listingErr } = await supabaseAdmin
      .from('listings')
      .select('id, title, price, price_unit, delivery_fee, delivery_radius_miles, offers_delivery, user_id, emoji, color, listing_type')
      .eq('id', listingId)
      .single();

    if (listingErr || !listing) {
      return new Response(JSON.stringify({ error: 'Listing not found' }), { status: 404, headers: corsHeaders });
    }

    if (listing.user_id === user.id) {
      return new Response(JSON.stringify({ error: 'Cannot book your own listing' }), { status: 400, headers: corsHeaders });
    }

    // Calculate price server-side using DB values only
    const isService = listing.listing_type === 'service';
    const msPerDay = 1000 * 60 * 60 * 24;
    const days = startDate && endDate
      ? Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / msPerDay) + 1)
      : 1;

    // Read the booking once (when paying an existing one) for the service quote
    // or an accepted offer amount, both of which override the list price.
    let bookingRow: { quoted_cents: number | null; date_str: string | null } | null = null;
    if (existingBookingId) {
      const { data } = await supabaseAdmin
        .from('booking_requests')
        .select('quoted_cents, date_str')
        .eq('id', existingBookingId)
        .single();
      bookingRow = data;
    }
    // Accepted offer/counter — date_str is "Offer:<amount>".
    const offerMatch = bookingRow?.date_str?.match(/^Offer:(\d+(?:\.\d+)?)$/);

    // Services charge the provider's agreed flat quote; accepted offers charge the
    // agreed offer amount; both are flat (no date multiplier, no delivery).
    // Everything else prices by unit × duration.
    let rentalTotal: number;
    let deliveryTotal: number;
    if (isService) {
      rentalTotal = bookingRow?.quoted_cents != null ? bookingRow.quoted_cents / 100 : Number(listing.price);
      deliveryTotal = 0;
    } else if (offerMatch) {
      rentalTotal = Number(offerMatch[1]);
      deliveryTotal = 0;
    } else {
      const unitMultiplier: Record<string, number> = { hour: 1, day: days, night: days, week: Math.ceil(days / 7) };
      rentalTotal = listing.price * (unitMultiplier[listing.price_unit] ?? days);
      deliveryTotal = (wantsDelivery && listing.offers_delivery && listing.delivery_fee)
        ? Number(listing.delivery_fee)
        : 0;
    }
    // 8% charged to renter, 4% taken from owner payout — 12% total platform fee
    const renterFee = Math.round(rentalTotal * 0.08 * 100) / 100;
    const ownerFee  = Math.round(rentalTotal * 0.04 * 100) / 100;
    const grandTotal = rentalTotal + deliveryTotal + renterFee;
    const amountCents = Math.round(grandTotal * 100);
    // The renter's service fee in cents — kept (non-refundable) on a late rental
    // cancel or any purchase cancel.
    const renterFeeCents = Math.round(renterFee * 100);

    if (amountCents < 50) {
      return new Response(JSON.stringify({ error: 'Amount too small (minimum $0.50)' }), { status: 400, headers: corsHeaders });
    }

    // When STRIPE_CONNECT_ENABLED is set, verify the owner has a connected account.
    // We use "separate charges and transfers": the full amount is charged onto the
    // PLATFORM account (no transfer_data / application_fee_amount), so the money
    // stays in our Stripe balance. The owner's cut is transferred later by the
    // release-payouts job, 24h after the rental begins (or after purchase). This
    // is the hold — funds do not leave Stripe to the owner at charge time.
    const connectEnabled = Deno.env.get('STRIPE_CONNECT_ENABLED') === 'true';
    let payoutAmountCents: number | null = null;

    if (connectEnabled) {
      const { data: ownerProfile } = await supabaseAdmin
        .from('profiles')
        .select('stripe_account_id, stripe_charges_enabled')
        .eq('id', listing.user_id)
        .single();

      if (!ownerProfile?.stripe_account_id || !ownerProfile?.stripe_charges_enabled) {
        return new Response(JSON.stringify({
          error: "This owner hasn't set up payouts yet. Payments are temporarily unavailable for this item.",
        }), { status: 400, headers: corsHeaders });
      }

      // Owner receives everything except the 12% platform fee (renter 8% + owner 4%).
      payoutAmountCents = amountCents - Math.round((renterFee + ownerFee) * 100);
    }

    const renterName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Renter';
    const dateStr = startDate
      ? (endDate && endDate !== startDate ? `${startDate} – ${endDate}` : startDate)
      : '';

    // Reuse existing accepted booking if the renter is paying from chat, otherwise create a new one
    let booking: { id: number } | null = null;
    if (existingBookingId) {
      const { data: existing, error: fetchErr } = await supabaseAdmin
        .from('booking_requests')
        .select('id, renter_id, owner_id')
        .eq('id', existingBookingId)
        .single();
      if (fetchErr || !existing) {
        console.error('[create-payment-intent] existing booking not found:', fetchErr?.message);
        return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404, headers: corsHeaders });
      }
      if (existing.renter_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: corsHeaders });
      }
      await supabaseAdmin
        .from('booking_requests')
        .update({
          stripe_amount_cents: amountCents,
          payment_status: 'pending',
          payout_amount_cents: payoutAmountCents,
          renter_fee_cents: renterFeeCents,
          payout_status: 'pending',
        })
        .eq('id', existingBookingId);
      booking = { id: existing.id };
    } else {
      // Create booking record before charging — guarantees a record even if client crashes after payment
      const { data: newBooking, error: bookingErr } = await supabaseAdmin
        .from('booking_requests')
        .insert({
          renter_id: user.id,
          owner_id: listing.user_id,
          item_title: listing.title,
          item_json: {
            id: listing.id,
            title: listing.title,
            emoji: listing.emoji,
            color: listing.color,
            ownerId: listing.user_id,
            price: listing.price,
            priceUnit: listing.price_unit,
            deliveryFee: listing.delivery_fee,
          },
          date_str: dateStr,
          start_date: startDate || null,
          end_date: endDate || null,
          wants_delivery: wantsDelivery || false,
          delivery_address: (wantsDelivery && deliveryAddress) ? deliveryAddress : null,
          delivery_fee: deliveryTotal > 0 ? deliveryTotal : null,
          renter_name: renterName,
          status: 'pending',
          payment_status: 'pending',
          stripe_amount_cents: amountCents,
          payout_amount_cents: payoutAmountCents,
          renter_fee_cents: renterFeeCents,
          payout_status: 'pending',
        })
        .select('id')
        .single();
      if (bookingErr || !newBooking) {
        console.error('[create-payment-intent] booking insert failed:', bookingErr?.message);
        return new Response(JSON.stringify({ error: 'Failed to create booking' }), { status: 500, headers: corsHeaders });
      }
      booking = newBooking;
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

    // Idempotency key prevents duplicate charges on network retries
    const idempotencyKey = `pi-${user.id}-${listingId}-${startDate ?? 'open'}-${endDate ?? 'open'}-${booking.id}`;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        user_id: user.id,
        listing_id: String(listingId),
        listing_title: listing.title,
        booking_id: String(booking.id),
        start_date: startDate ?? '',
        end_date: endDate ?? '',
      },
    }, { idempotencyKey });

    // Attach payment intent ID to the booking record
    await supabaseAdmin
      .from('booking_requests')
      .update({ payment_intent_id: paymentIntent.id })
      .eq('id', booking.id);

    return new Response(JSON.stringify({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      bookingDbId: booking.id,
      breakdown: { rentalTotal, deliveryFee: deliveryTotal, renterFee, ownerFee, grandTotal, amountCents, days },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[create-payment-intent] error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
