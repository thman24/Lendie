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

// Stripe wants a fast 2xx: slow side effects (email) run after the response via
// EdgeRuntime.waitUntil. DB state changes stay synchronous.
const background = (p: Promise<unknown>) => {
  const safe = p.catch(e => console.error('[stripe-webhook] background task failed:', e?.message ?? e));
  try { (globalThis as any).EdgeRuntime?.waitUntil(safe); } catch { /* runs anyway */ }
};

const sendEmail = async (userId: string, subject: string, html: string) => {
  background(fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, subject, html }),
  }));
};

// Lendie owner account — always an admin (mirrors admin-access / booking-escrow).
const OWNER_ID = '8f7af82b-b44e-436f-995a-530eb24925e8';
const money = (cents: number | null | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// In-app bell + email to every admin (owner + `admins` table). Used for card
// chargebacks, which need a human to respond in the Stripe Dashboard.
const alertAdmins = async (supabase: any, text: string, sub: string, subject: string, html: string) => {
  const { data: admins } = await supabase.from('admins').select('user_id, email');
  const ids = [OWNER_ID, ...((admins ?? []).map((a: any) => a.user_id))].filter((v, i, a) => a.indexOf(v) === i);
  for (const id of ids) {
    await supabase.from('notifications').insert({ user_id: id, icon: '⚠️', text, sub, time_label: 'Just now', unread: true, type: 'payment' });
  }
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return;
  background((async () => {
  const emails = new Set<string>((admins ?? []).map((a: any) => a.email).filter(Boolean));
  const { data: ownerUser } = await supabase.auth.admin.getUserById(OWNER_ID);
  if (ownerUser?.user?.email) emails.add(ownerUser.user.email);
  if (!emails.size) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Lendie <notifications@lendie.app>', to: [...emails], subject, html }),
  });
  })());
};

// Find the booking a Stripe charge belongs to (by charge id, then PaymentIntent id).
const bookingForCharge = async (supabase: any, chargeId: string | null, piId: string | null) => {
  const cols = 'id, item_title, renter_id, owner_id, payment_status, payout_status, payout_amount_cents, stripe_amount_cents, transfer_id, dispute_status, dispute_reason, dispute_note';
  if (chargeId) {
    const { data } = await supabase.from('booking_requests').select(cols).eq('stripe_charge_id', chargeId).maybeSingle();
    if (data) return data;
  }
  if (piId) {
    const { data } = await supabase.from('booking_requests').select(cols).eq('payment_intent_id', piId).maybeSingle();
    if (data) return data;
  }
  return null;
};

Deno.serve(async (req) => {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  // Two event destinations post here: "Your account" (STRIPE_WEBHOOK_SECRET) and
  // "Connected accounts" (STRIPE_CONNECT_WEBHOOK_SECRET, for account.updated etc.).
  // Each has its own signing secret; accept a signature valid for either.
  const secrets = [Deno.env.get('STRIPE_WEBHOOK_SECRET'), Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')].filter(Boolean) as string[];
  let event: Stripe.Event | null = null;
  let lastErr = 'no webhook secret configured';
  for (const secret of secrets) {
    try { event = await stripe.webhooks.constructEventAsync(body, sig, secret); break; }
    catch (err) { lastErr = (err as Error).message; }
  }
  if (!event) {
    console.error('[stripe-webhook] signature verification failed:', lastErr);
    return new Response(`Webhook error: ${lastErr}`, { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      // Scheduled off-session charges are owned end-to-end by charge-due-bookings
      // (it sets 'paid', the payout hold, and notifications). Ignore them here so
      // we don't double-process or double-notify.
      if (pi.metadata?.flow === 'scheduled') break;
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
          .select('renter_id, owner_id, item_json, start_date, end_date, status, payment_status, stripe_amount_cents, item_title')
          .eq('id', bookingId)
          .single();
        if (error) console.error('[stripe-webhook] failed to fetch booking:', error.message);
        // Stripe redelivers events. If this booking was already cancelled/refunded,
        // do nothing — otherwise we'd flip it back to 'paid' and re-block the dates
        // that were freed on cancel.
        // Stripe redelivers and may send events out of order. Already paid → this
        // is a duplicate: don't reset the payout timer or re-notify.
        if (booking?.payment_status === 'paid') {
          console.log(`[stripe-webhook] booking ${bookingId} already paid — duplicate succeeded event`);
          break;
        }
        if (booking && booking.status === 'cancelled' && booking.payment_status !== 'refunded') {
          // The card was charged after the booking was cancelled (e.g. the renter
          // finished paying just as it auto-cancelled). Give the money back.
          try {
            await stripe.refunds.create({ payment_intent: pi.id, metadata: { booking_id: String(bookingId), reason: 'paid_after_cancel' } }, { idempotencyKey: `autorefund-${pi.id}` });
            await supabase.from('booking_requests').update({ payment_status: 'refunded', payment_intent_id: pi.id, payout_status: 'skipped' }).eq('id', bookingId);
          } catch (e) {
            console.error(`[stripe-webhook] auto-refund of ${pi.id} failed:`, (e as Error).message);
          }
          await alertAdmins(supabase, `Charged after cancel: ${booking.item_title ?? bookingId}`, `${money(pi.amount)} auto-refunded — check it went through`,
            `Payment arrived for a cancelled booking (#${bookingId})`, `<p>PaymentIntent ${esc(pi.id)} (${money(pi.amount)}) succeeded after booking #${esc(bookingId)} was cancelled. Lendie attempted an automatic refund — confirm it in the Stripe Dashboard.</p>`);
          break;
        }
        if (booking?.payment_status === 'refunded') {
          console.log(`[stripe-webhook] booking ${bookingId} already refunded — skipping succeeded handler`);
          break;
        }
        if (booking && booking.stripe_amount_cents != null && pi.amount !== booking.stripe_amount_cents) {
          await alertAdmins(supabase, `Amount mismatch: ${booking.item_title ?? bookingId}`, `Charged ${money(pi.amount)}, booking says ${money(booking.stripe_amount_cents)}`,
            `Payment amount mismatch on booking #${bookingId}`, `<p>PaymentIntent ${esc(pi.id)} charged ${money(pi.amount)} but booking #${esc(bookingId)} expects ${money(booking.stripe_amount_cents)}. Payout amount was computed from the booking — review before it releases.</p>`);
        }
        if (booking) {
          renterId = booking.renter_id;
          ownerId = booking.owner_id;
          // Prefer the authoritative booking row over PI metadata
          listingId = booking.item_json?.id ?? listingId;
          startDate = booking.start_date ?? startDate;
          endDate = booking.end_date ?? endDate;
        }
        // Escrow: hold the owner's payout in the platform balance until the
        // buyer/renter has had a chance to report a problem. Dated bookings:
        // 24h after the last day (end_date + 1 day 00:00 UTC + 24h). Purchases /
        // undated: the clock starts at the HANDOFF (booking-escrow pulls this in to
        // 24h after the buyer confirms, or 72h after the seller marks it handed
        // over); this 14-day value is only the backstop if neither happens.
        // The release-payouts job transfers it then (never while 'disputed').
        const HOUR = 60 * 60 * 1000;
        const lastDay = endDate || startDate;
        const releaseAt = lastDay
          ? new Date(new Date(`${String(lastDay).slice(0, 10)}T00:00:00Z`).getTime() + 48 * HOUR)
          : new Date(Date.now() + 14 * 24 * HOUR);
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
            paid_at: new Date().toISOString(),
            payout_release_at: releaseAt.toISOString(),
          })
          .eq('id', bookingId)
          .neq('payment_status', 'paid');
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
      // Scheduled-charge failures are handled by charge-due-bookings (grace +
      // retry + auto-cancel). Don't let the webhook flip them to terminal 'failed'.
      if (pi.metadata?.flow === 'scheduled') break;
      const bookingId = pi.metadata?.booking_id;

      if (bookingId) {
        // Only while still awaiting this payment — a late/out-of-order failure must
        // never overwrite 'paid' (the owner would never be paid out).
        await supabase
          .from('booking_requests')
          .update({ payment_status: 'failed' })
          .eq('id', bookingId)
          .eq('payment_status', 'pending');
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
          .in('payment_status', ['pending', 'failed'])
          .eq('id', bookingId);
      }
      break;
    }

    // A renter finished saving their card for a delayed charge. Store the saved
    // card + customer and move the booking from 'saving' to 'scheduled' so the
    // charge-due-bookings cron can charge it 24h before the rental.
    case 'setup_intent.succeeded': {
      const si = event.data.object as Stripe.SetupIntent;
      const bookingId = si.metadata?.booking_id;
      if (!bookingId) break;

      const customerId = typeof si.customer === 'string' ? si.customer : si.customer?.id ?? null;
      const pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id ?? null;

      // Don't resurrect a booking the renter cancelled while the card was saving.
      const { data: booking } = await supabase
        .from('booking_requests')
        .select('renter_id, item_title, status, payment_status, charge_at, stripe_amount_cents')
        .eq('id', bookingId)
        .single();
      if (!booking || booking.status === 'cancelled' || booking.payment_status === 'refunded') break;

      await supabase
        .from('booking_requests')
        .update({ payment_status: 'scheduled', stripe_customer_id: customerId, stripe_payment_method_id: pmId })
        .eq('id', bookingId);

      if (booking.renter_id) {
        const amt = booking.stripe_amount_cents ? (booking.stripe_amount_cents / 100).toFixed(2) : null;
        const when = booking.charge_at ? new Date(booking.charge_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'before your rental';
        await supabase.from('notifications').insert({
          user_id: booking.renter_id, icon: '💳',
          text: 'Card saved — nothing charged yet',
          sub: `${amt ? `$${amt} ` : ''}will be charged on ${when} for ${booking.item_title}. Cancel free until then.`,
          time_label: 'Just now', unread: true, type: 'payment',
        });
        await sendEmail(booking.renter_id, `Card saved — ${booking.item_title}`,
          `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">💳 Card saved — you haven't been charged</h2>
           <p style="margin:0 0 12px;color:#3A3B3C;font-size:15px">Your card is saved for <strong>${booking.item_title}</strong>. ${amt ? `We'll charge <strong>$${amt}</strong>` : "We'll charge it"} on <strong>${when}</strong> (24 hours before your rental). You can cancel free of charge any time before then.</p>`);
      }
      break;
    }

    // ── Refunds made outside Lendie's own flow, and failed refunds ──────────────
    // Our flows (create-refund, booking-escrow) claim the payout (-> 'skipped')
    // BEFORE refunding, so a refund that finds the payout still 'pending' or
    // 'disputed' was issued elsewhere (e.g. the Stripe Dashboard). Stop the owner
    // being paid for money we've given back, and tell an admin.
    case 'charge.refunded': {
      const ch = event.data.object as Stripe.Charge;
      const piId = typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id ?? null;
      const b = await bookingForCharge(supabase, ch.id, piId);
      if (!b || !['pending', 'disputed'].includes(b.payout_status) || b.payment_status !== 'paid') break;
      const full = ch.amount_refunded >= ch.amount;
      if (full) {
        await supabase.from('booking_requests')
          .update({ payout_status: 'skipped', payment_status: 'refunded', status: 'cancelled', cancellation_reason: 'refunded_in_stripe' })
          .eq('id', b.id).in('payout_status', ['pending', 'disputed']);
      } else {
        await supabase.from('booking_requests')
          .update({ payout_status: 'disputed', dispute_status: 'open', dispute_reason: 'other', disputed_at: new Date().toISOString(),
                    dispute_note: `Partial refund of ${money(ch.amount_refunded)} was issued outside the app (Stripe Dashboard). Decide the owner payout.` })
          .eq('id', b.id).eq('payout_status', 'pending');
      }
      await alertAdmins(supabase, `Refunded in Stripe: ${b.item_title}`,
        full ? 'Full refund — owner payout cancelled' : `Partial ${money(ch.amount_refunded)} — owner payout frozen for review`,
        `Refund issued outside the app — ${b.item_title} (#${b.id})`,
        `<p>${full ? 'A full' : `A partial (${money(ch.amount_refunded)})`} refund was issued on booking #${b.id} outside Lendie's refund flow. ${full ? 'The owner payout was cancelled.' : 'The owner payout is frozen — resolve it in Admin → Disputes.'}</p>`);
      break;
    }

    case 'refund.failed': {
      const r = event.data.object as Stripe.Refund;
      if (r.status !== 'failed') break;
      const chargeId = typeof r.charge === 'string' ? r.charge : r.charge?.id ?? null;
      const piId = typeof r.payment_intent === 'string' ? r.payment_intent : r.payment_intent?.id ?? null;
      const b = await bookingForCharge(supabase, chargeId, piId);
      await alertAdmins(supabase, `Refund FAILED: ${b?.item_title ?? r.id}`, `${money(r.amount)} · ${r.failure_reason ?? 'unknown reason'} — customer was not refunded`,
        `Refund failed — ${b?.item_title ?? r.id}`,
        `<p>Refund ${esc(r.id)} of ${money(r.amount)}${b ? ` for booking #${b.id} (${esc(b.item_title)})` : ''} failed: <strong>${esc(r.failure_reason ?? 'unknown')}</strong>. The app shows it as refunded — contact the customer and refund another way.</p>`);
      break;
    }

    // ── Card chargebacks ────────────────────────────────────────────────────────
    // With separate charges & transfers, Stripe debits chargebacks (amount + fee)
    // from the PLATFORM balance. So: if we're still holding the owner's payout,
    // freeze it (payout_status 'disputed', dispute_reason 'chargeback') so the
    // release cron can't pay it out; if it's already paid, alert an admin to decide
    // on a transfer reversal. Evidence is submitted by an admin in the Stripe
    // Dashboard; charge.dispute.closed settles the held payout automatically.
    case 'charge.dispute.created': {
      const d = event.data.object as Stripe.Dispute;
      const chargeId = typeof d.charge === 'string' ? d.charge : d.charge?.id ?? null;
      const piId = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id ?? null;
      const b = await bookingForCharge(supabase, chargeId, piId);
      const due = d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'see Stripe';
      const note = `Card chargeback ${d.id}: reason "${d.reason}", ${money(d.amount)}. Respond in the Stripe Dashboard (Payments → Disputes) by ${due}.`;
      let state = 'no matching booking';
      if (b) {
        if (b.payout_status === 'pending') {
          const { data: won } = await supabase.from('booking_requests')
            .update({ payout_status: 'disputed', dispute_status: 'open', dispute_reason: 'chargeback', dispute_note: note, disputed_by: b.renter_id, disputed_at: new Date().toISOString() })
            .eq('id', b.id).eq('payout_status', 'pending').select('id');
          state = won?.length ? 'owner payout frozen' : 'payout changed while freezing — check it';
        } else if (b.payout_status === 'disputed') {
          // An in-app problem report was already open: convert it to a chargeback
          // so admins can't also refund it in-app (that would double-refund).
          await supabase.from('booking_requests')
            .update({ dispute_status: 'open', dispute_reason: 'chargeback', dispute_note: `${note}\n\nEarlier in-app report: ${b.dispute_note ?? ''}`.slice(0, 4000) })
            .eq('id', b.id);
          state = 'owner payout already frozen (in-app report) — now marked as chargeback';
        } else if (b.payout_status === 'released' || b.payout_status === 'releasing') {
          state = `owner ALREADY PAID (transfer ${b.transfer_id ?? 'in progress'}) — decide whether to reverse it`;
        } else {
          state = `payout ${b.payout_status}, payment ${b.payment_status} (e.g. already refunded — submit the refund as evidence)`;
        }
      }
      await alertAdmins(supabase,
        `Chargeback: ${b?.item_title ?? 'unknown booking'}`,
        `${money(d.amount)} · ${state}`,
        `Chargeback opened — ${b?.item_title ?? d.id} (${money(d.amount)})`,
        `<h2 style="margin:0 0 12px">Card chargeback opened</h2>
         <p><strong>Booking:</strong> ${b ? `#${b.id} — ${esc(b.item_title)}` : 'not found'}<br/>
         <strong>Amount:</strong> ${money(d.amount)} · <strong>Reason:</strong> ${esc(d.reason)}<br/>
         <strong>Evidence due:</strong> ${esc(due)}<br/><strong>Status:</strong> ${esc(state)}</p>
         <p>Stripe has debited the amount plus a dispute fee from Lendie's balance. Respond in the Stripe Dashboard → Payments → Disputes with messages, photos and the booking details. The held payout settles automatically when the bank decides.</p>`);
      break;
    }

    case 'charge.dispute.closed': {
      const d = event.data.object as Stripe.Dispute;
      const chargeId = typeof d.charge === 'string' ? d.charge : d.charge?.id ?? null;
      const piId = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id ?? null;
      const b = await bookingForCharge(supabase, chargeId, piId);
      const won = d.status === 'won' || d.status === 'warning_closed';
      let state = 'no matching booking';
      if (b && b.dispute_reason === 'chargeback' && b.payout_status === 'disputed') {
        const now = new Date().toISOString();
        if (won) {
          // Bank sided with us: funds come back to the platform — pay the owner.
          await supabase.from('booking_requests')
            .update({ payout_status: 'pending', payout_release_at: now, dispute_status: 'resolved', dispute_resolution: 'released', dispute_resolved_at: now })
            .eq('id', b.id).eq('payout_status', 'disputed');
          state = 'won — owner payout released';
          if (b.owner_id) await supabase.from('notifications').insert({ user_id: b.owner_id, icon: '🛡️', text: `Payment cleared: ${b.item_title}`, sub: 'Your payout is being released', time_label: 'Just now', unread: true, type: 'payment' });
        } else {
          // Lost: the cardholder already got the money back via the bank. Do NOT
          // refund again — just close it out and skip the owner payout.
          await supabase.from('booking_requests')
            .update({ payout_status: 'skipped', payment_status: 'refunded', status: 'cancelled', cancellation_reason: 'chargeback_lost', dispute_status: 'resolved', dispute_resolution: 'chargeback_lost', dispute_refund_cents: d.amount, dispute_resolved_at: now })
            .eq('id', b.id).eq('payout_status', 'disputed');
          state = 'lost — owner payout cancelled (customer was refunded by their bank)';
          if (b.owner_id) await supabase.from('notifications').insert({ user_id: b.owner_id, icon: '↩️', text: `Payment reversed: ${b.item_title}`, sub: "The renter's bank reversed the charge, so there's no payout for this booking", time_label: 'Just now', unread: true, type: 'payment' });
        }
      } else if (b) {
        state = `${d.status} — payout was ${b.payout_status}; review manually${!won && b.payout_status === 'released' ? ' (consider reversing the owner transfer)' : ''}`;
      }
      await alertAdmins(supabase,
        `Chargeback ${won ? 'won' : 'lost'}: ${b?.item_title ?? 'unknown booking'}`,
        state,
        `Chargeback ${d.status} — ${b?.item_title ?? d.id}`,
        `<h2 style="margin:0 0 12px">Chargeback closed: ${esc(d.status)}</h2><p><strong>Booking:</strong> ${b ? `#${b.id} — ${esc(b.item_title)}` : 'not found'}<br/><strong>Amount:</strong> ${money(d.amount)}<br/><strong>Result:</strong> ${esc(state)}</p>`);
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
