import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Escrow actions on a card-paid booking whose owner payout is still held.
//
//   confirm_receipt  (buyer of an undated purchase/service)
//       "Received — all good": releases the seller's payout now (next cron run).
//   report_problem   (renter/buyer or owner, while the payout is held)
//       Freezes the payout (payout_status pending -> disputed) and alerts admins.
//   list_disputes    (admin)  open disputes for the admin panel
//   resolve          (admin)  { resolution: 'release' | 'refund', refundCents? }
//       release -> payout goes to the owner now
//       refund  -> refund the buyer from the platform balance (full or partial);
//                  a partial refund comes out of the owner's held payout.
//
// The payout is still in the platform balance in every case here (we only act
// while payout_status is pending/disputed), so no transfer reversal is needed.
// All state changes are guarded updates (.eq on the expected payout_status) so
// they can't race the release-payouts cron or create-refund.

const OWNER_ID = '8f7af82b-b44e-436f-995a-530eb24925e8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const REASONS: Record<string, string> = {
  not_as_described: 'Not as described',
  not_received: 'Not received / no-show',
  damaged: 'Damaged',
  other: 'Other',
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (cents: number | null | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json();
    const { action } = body;

    const isAdmin = async () => {
      if (user.id === OWNER_ID) return true;
      const { data } = await db.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
      return !!data;
    };

    const notify = (userId: string | null, text: string, sub: string) => userId
      ? db.from('notifications').insert({ user_id: userId, icon: '🛡️', text, sub, time_label: 'Just now', unread: true, type: 'payment' })
      : Promise.resolve();

    // ── Admin: list open disputes ─────────────────────────────────────────────
    if (action === 'list_disputes') {
      if (!(await isAdmin())) return json({ error: 'Forbidden' }, 403);
      const { data, error } = await db.from('booking_requests')
        .select('id, item_title, renter_id, renter_name, owner_id, start_date, end_date, date_str, stripe_amount_cents, renter_fee_cents, payout_amount_cents, payout_status, dispute_status, dispute_reason, dispute_note, disputed_by, disputed_at, conversation_id')
        .eq('dispute_status', 'open')
        .order('disputed_at', { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ disputes: data ?? [] });
    }

    const bookingId = body.bookingId;
    if (!bookingId) return json({ error: 'Missing bookingId' }, 400);
    const { data: b, error: bErr } = await db.from('booking_requests')
      .select('id, renter_id, owner_id, renter_name, item_title, start_date, end_date, status, payment_status, payment_intent_id, stripe_amount_cents, renter_fee_cents, payout_amount_cents, payout_status, payout_release_at, buyer_confirmed_at, dispute_status')
      .eq('id', bookingId).single();
    if (bErr || !b) return json({ error: 'Booking not found' }, 404);

    const isRenter = b.renter_id === user.id;
    const isOwner = b.owner_id === user.id;
    const held = b.payment_status === 'paid' && b.payout_status === 'pending';

    // ── Buyer confirms receipt ────────────────────────────────────────────────
    if (action === 'confirm_receipt') {
      if (!isRenter) return json({ error: 'Forbidden' }, 403);
      if (b.start_date) return json({ error: 'Only purchases and undated services can be confirmed early.' }, 400);
      if (!held) return json({ error: 'This payment is no longer being held.' }, 400);
      const now = new Date().toISOString();
      const { data: won } = await db.from('booking_requests')
        .update({ buyer_confirmed_at: now, payout_release_at: now })
        .eq('id', b.id).eq('payout_status', 'pending').is('dispute_status', null)
        .select('id');
      if (!won?.length) return json({ error: 'This payment is no longer being held.' }, 409);
      await notify(b.owner_id, `Buyer confirmed: ${b.item_title}`, 'Your payout is being released now');
      return json({ success: true });
    }

    // ── Either party reports a problem ────────────────────────────────────────
    if (action === 'report_problem') {
      if (!isRenter && !isOwner) return json({ error: 'Forbidden' }, 403);
      if (b.dispute_status === 'open') return json({ error: 'A problem report is already open for this transaction.' }, 400);
      if (!held) return json({ error: "The seller has already been paid, so this can't be reported here. Please email support." }, 400);
      // A renter can't report before a dated rental has started (they can still cancel then).
      if (isRenter && b.start_date && String(b.start_date).slice(0, 10) > new Date().toISOString().slice(0, 10)) {
        return json({ error: "This rental hasn't started yet — you can cancel it instead." }, 400);
      }
      const reason = REASONS[body.reason] ? body.reason : 'other';
      const note = String(body.note ?? '').trim().slice(0, 2000);
      if (note.length < 5) return json({ error: 'Please describe the problem.' }, 400);

      const { data: won } = await db.from('booking_requests')
        .update({ payout_status: 'disputed', dispute_status: 'open', dispute_reason: reason, dispute_note: note, disputed_by: user.id, disputed_at: new Date().toISOString() })
        .eq('id', b.id).eq('payout_status', 'pending')
        .select('id');
      if (!won?.length) return json({ error: 'The payout is being processed right now. Please try again in a minute or email support.' }, 409);

      const other = isRenter ? b.owner_id : b.renter_id;
      await notify(other, `Problem reported: ${b.item_title}`, 'The payment is on hold while Lendie reviews it');
      await notify(user.id, `Report received: ${b.item_title}`, "The payment is on hold. We'll be in touch.");

      // Alert admins: in-app + email.
      const { data: admins } = await db.from('admins').select('user_id, email');
      const adminIds = [OWNER_ID, ...((admins ?? []).map((a: any) => a.user_id))].filter((v, i, a) => a.indexOf(v) === i);
      for (const id of adminIds) await notify(id, `New dispute: ${b.item_title}`, `${REASONS[reason]} · open the Admin tab`);
      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (resendKey) {
        const emails = new Set<string>((admins ?? []).map((a: any) => a.email).filter(Boolean));
        const { data: ownerUser } = await db.auth.admin.getUserById(OWNER_ID);
        if (ownerUser?.user?.email) emails.add(ownerUser.user.email);
        if (emails.size) {
          const html = `<h2 style="margin:0 0 12px">New dispute — ${esc(b.item_title)}</h2>
            <p><strong>Booking:</strong> #${b.id}<br/><strong>Reported by:</strong> ${isRenter ? 'Renter/buyer' : 'Owner/seller'}<br/>
            <strong>Reason:</strong> ${esc(REASONS[reason])}<br/><strong>Amount held:</strong> ${money(b.stripe_amount_cents)} (owner payout ${money(b.payout_amount_cents)})</p>
            <p style="white-space:pre-wrap;background:#f4f4f5;padding:12px;border-radius:8px">${esc(note)}</p>
            <p>The payout is frozen. Resolve it in the Lendie app → Profile → Admin → Disputes.</p>`;
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'Lendie <notifications@lendie.app>', to: [...emails], subject: `Dispute: ${b.item_title} (#${b.id})`, html }),
          }).catch(e => console.error('[booking-escrow] admin email failed:', e?.message));
        }
      }
      return json({ success: true });
    }

    // ── Admin resolves a dispute ──────────────────────────────────────────────
    if (action === 'resolve') {
      if (!(await isAdmin())) return json({ error: 'Forbidden' }, 403);
      if (b.dispute_status !== 'open' || b.payout_status !== 'disputed') return json({ error: 'This dispute is not open.' }, 400);
      const now = new Date().toISOString();

      if (body.resolution === 'release') {
        const { data: won } = await db.from('booking_requests')
          .update({ payout_status: 'pending', payout_release_at: now, dispute_status: 'resolved', dispute_resolution: 'released', dispute_resolved_at: now })
          .eq('id', b.id).eq('payout_status', 'disputed').select('id');
        if (!won?.length) return json({ error: 'Dispute changed — reload.' }, 409);
        await notify(b.owner_id, `Dispute resolved: ${b.item_title}`, 'Your payout is being released');
        await notify(b.renter_id, `Dispute resolved: ${b.item_title}`, 'Reviewed — the payment has been released to the owner');
        return json({ success: true });
      }

      if (body.resolution === 'refund') {
        const total = b.stripe_amount_cents ?? 0;
        const refundCents = body.refundCents == null ? total : Math.round(Number(body.refundCents));
        if (!Number.isFinite(refundCents) || refundCents <= 0 || refundCents > total) return json({ error: `Refund must be between $0.01 and ${money(total)}.` }, 400);
        if (!b.payment_intent_id) return json({ error: 'No payment to refund' }, 400);
        const full = refundCents >= total;
        // The refund comes out of the owner's held payout; the platform covers
        // anything beyond it (only possible on a near-full partial refund).
        const newPayout = full ? 0 : Math.max(0, (b.payout_amount_cents ?? 0) - refundCents);

        // Claim first (disputed -> skipped) so nothing else can act mid-refund.
        const { data: claimed } = await db.from('booking_requests')
          .update({ payout_status: 'skipped' }).eq('id', b.id).eq('payout_status', 'disputed').select('id');
        if (!claimed?.length) return json({ error: 'Dispute changed — reload.' }, 409);

        const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
        try {
          const refund = await stripe.refunds.create(
            { payment_intent: b.payment_intent_id, amount: refundCents, metadata: { booking_id: String(b.id), reason: 'dispute' } },
            { idempotencyKey: `dispute-refund-${b.id}` },
          );
          if (refund.status !== 'succeeded' && refund.status !== 'pending') throw new Error(`refund status ${refund.status}`);
        } catch (e) {
          await db.from('booking_requests').update({ payout_status: 'disputed' }).eq('id', b.id).eq('payout_status', 'skipped');
          console.error(`[booking-escrow] booking ${b.id} dispute refund failed:`, e?.message);
          return json({ error: 'Refund failed: ' + (e?.message ?? 'unknown error') }, 500);
        }

        const resolved = { dispute_status: 'resolved', dispute_resolution: full ? 'refunded' : 'partial_refund', dispute_refund_cents: refundCents, dispute_resolved_at: now };
        if (full) {
          // Attributed to the seller (a full dispute refund means they were at
          // fault), not the admin, so it counts toward the seller's record.
          await db.from('booking_requests')
            .update({ ...resolved, payment_status: 'refunded', status: 'cancelled', cancelled_by: b.owner_id, cancellation_reason: 'dispute_refund' })
            .eq('id', b.id);
        } else {
          await db.from('booking_requests')
            .update({ ...resolved, payout_amount_cents: newPayout, payout_status: newPayout > 0 ? 'pending' : 'skipped', payout_release_at: now })
            .eq('id', b.id);
        }
        await notify(b.renter_id, `Dispute resolved: ${b.item_title}`, `${money(refundCents)} refunded to your card (5-10 business days)`);
        await notify(b.owner_id, `Dispute resolved: ${b.item_title}`, full ? 'The buyer was refunded in full' : `${money(refundCents)} refunded to the buyer · ${money(newPayout)} released to you`);
        return json({ success: true, refundedCents: refundCents, payoutCents: newPayout });
      }

      return json({ error: 'Unknown resolution' }, 400);
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[booking-escrow] error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
