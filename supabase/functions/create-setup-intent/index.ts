import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Delayed-charge counterpart to create-payment-intent. Instead of charging the
// renter now, it SAVES their card (Stripe SetupIntent, usage off_session) and
// schedules the charge for 24h before the rental begins. The full authoritative
// pricing + booking-row logic is identical to create-payment-intent — only the
// Stripe object created differs (SetupIntent vs PaymentIntent) and the booking
// is parked in payment_status 'saving' until setup_intent.succeeded flips it to
// 'scheduled'. The charge-due-bookings cron does the actual off-session charge.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Charge 24h before the rental day (start_date 00:00 UTC − 24h).
const RELEASE_LEAD_MS = 24 * 60 * 60 * 1000;

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

    // Scheduling only applies to dated bookings whose charge point is still in
    // the future. Anything else must use the immediate-charge path.
    if (!startDate) {
      return new Response(JSON.stringify({ error: 'Delayed charge requires a rental date' }), { status: 400, headers: corsHeaders });
    }
    const chargeAtMs = new Date(`${startDate}T00:00:00Z`).getTime() - RELEASE_LEAD_MS;
    if (!Number.isFinite(chargeAtMs) || chargeAtMs <= Date.now()) {
      return new Response(JSON.stringify({ error: 'Rental begins too soon to schedule — charge immediately instead' }), { status: 400, headers: corsHeaders });
    }

    // ── Authoritative price (identical to create-payment-intent) ──────────────
    const isService = listing.listing_type === 'service';
    const msPerDay = 1000 * 60 * 60 * 24;
    const days = startDate && endDate
      ? Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / msPerDay) + 1)
      : 1;

    let bookingRow: { quoted_cents: number | null; date_str: string | null } | null = null;
    if (existingBookingId) {
      const { data } = await supabaseAdmin
        .from('booking_requests')
        .select('quoted_cents, date_str')
        .eq('id', existingBookingId)
        .single();
      bookingRow = data;
    }
    const offerMatch = bookingRow?.date_str?.match(/^Offer:(\d+(?:\.\d+)?)$/);

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
    const renterFee = Math.round(rentalTotal * 0.08 * 100) / 100;
    const ownerFee  = Math.round(rentalTotal * 0.04 * 100) / 100;
    const grandTotal = rentalTotal + deliveryTotal + renterFee;
    const amountCents = Math.round(grandTotal * 100);
    const renterFeeCents = Math.round(renterFee * 100);

    if (amountCents < 50) {
      return new Response(JSON.stringify({ error: 'Amount too small (minimum $0.50)' }), { status: 400, headers: corsHeaders });
    }

    // Owner payout eligibility + amount (same as immediate path). We don't move
    // any money now, but we compute + store payout_amount_cents so the later
    // charge + release-payouts flow is unchanged.
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
      payoutAmountCents = amountCents - Math.round((renterFee + ownerFee) * 100);
    }

    const renterName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Renter';
    const dateStr = (endDate && endDate !== startDate) ? `${startDate} – ${endDate}` : startDate;

    // ── Reuse or create the booking row ───────────────────────────────────────
    let bookingId: number;
    let existingCustomerId: string | null = null;
    if (existingBookingId) {
      const { data: existing, error: fetchErr } = await supabaseAdmin
        .from('booking_requests')
        .select('id, renter_id, stripe_customer_id')
        .eq('id', existingBookingId)
        .single();
      if (fetchErr || !existing) {
        return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404, headers: corsHeaders });
      }
      if (existing.renter_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: corsHeaders });
      }
      existingCustomerId = existing.stripe_customer_id;
      bookingId = existing.id;
    } else {
      const { data: newBooking, error: bookingErr } = await supabaseAdmin
        .from('booking_requests')
        .insert({
          renter_id: user.id,
          owner_id: listing.user_id,
          item_title: listing.title,
          item_json: {
            id: listing.id, title: listing.title, emoji: listing.emoji, color: listing.color,
            ownerId: listing.user_id, price: listing.price, priceUnit: listing.price_unit,
            deliveryFee: listing.delivery_fee,
          },
          date_str: dateStr,
          start_date: startDate,
          end_date: endDate || null,
          wants_delivery: wantsDelivery || false,
          delivery_address: (wantsDelivery && deliveryAddress) ? deliveryAddress : null,
          delivery_fee: deliveryTotal > 0 ? deliveryTotal : null,
          renter_name: renterName,
          status: 'pending',
          payment_status: 'pending',
        })
        .select('id')
        .single();
      if (bookingErr || !newBooking) {
        console.error('[create-setup-intent] booking insert failed:', bookingErr?.message);
        return new Response(JSON.stringify({ error: 'Failed to create booking' }), { status: 500, headers: corsHeaders });
      }
      bookingId = newBooking.id;
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

    // Reuse the customer across a renter's bookings when we already have one.
    let customerId = existingCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: renterName,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
    }

    // SetupIntent saves the card for later off-session charging. No money moves.
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: {
        booking_id: String(bookingId),
        user_id: user.id,
        listing_id: String(listingId),
        listing_title: listing.title,
        start_date: startDate,
        end_date: endDate ?? '',
      },
    });

    // Park the booking: 'saving' until setup_intent.succeeded confirms the card,
    // then the webhook flips it to 'scheduled'. Store the amounts + charge_at now.
    await supabaseAdmin
      .from('booking_requests')
      .update({
        payment_status: 'saving',
        stripe_customer_id: customerId,
        charge_at: new Date(chargeAtMs).toISOString(),
        stripe_amount_cents: amountCents,
        payout_amount_cents: payoutAmountCents,
        renter_fee_cents: renterFeeCents,
        payout_status: 'pending',
      })
      .eq('id', bookingId);

    return new Response(JSON.stringify({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      bookingDbId: bookingId,
      chargeAt: new Date(chargeAtMs).toISOString(),
      breakdown: { rentalTotal, deliveryFee: deliveryTotal, renterFee, ownerFee, grandTotal, amountCents, days },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[create-setup-intent] error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
