import { createClient } from 'npm:@supabase/supabase-js@2';

// Scheduled job (pg_cron, hourly). Sends rental reminders via push + in-app bell
// to BOTH the renter and the owner:
//   1. Day-before start — the day before the rental's start date
//   2. Morning-of start — the morning the rental begins
//      (1 & 2 only when the booking was reserved >1 day in advance)
//   3. Return due       — the morning of the last rental day (due back next day)
//
// Send moments are anchored to ~13:00 UTC (≈9am ET / 6am PT) so "morning" reads
// like a morning for US users rather than firing at midnight UTC. start_date /
// end_date are plain YYYY-MM-DD strings. Each reminder is stamped with a guarded
// null→now update so it fires exactly once, even if two cron runs overlap.
//
// Reuses the release-payouts / charge-due Vault secrets (project_url,
// service_role_key) — no new secrets needed.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DAY_MS = 24 * 60 * 60 * 1000;
const ANCHOR_MS = 13 * 60 * 60 * 1000; // 13:00 UTC ≈ 9am ET / 6am PT
const APP_URL = 'https://www.lendie.app/?tab=messages';

const dayStartUTC = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${SERVICE_KEY}`) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  // Lower bound for the query: don't scan bookings whose dates are well in the past.
  const lowerBound = new Date(now - 2 * DAY_MS).toISOString().slice(0, 10);

  const sendPush = async (userId: string, title: string, body: string, tag: string) => {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, title, body, url: APP_URL, tag }),
      });
    } catch (e) { console.error('[booking-reminders] push failed', e); }
  };
  const notify = async (userId: string, icon: string, text: string, sub: string) => {
    try {
      await supabase.from('notifications').insert({
        user_id: userId, icon, text, sub, time_label: 'Just now', unread: true, type: 'reminder',
      });
    } catch (e) { console.error('[booking-reminders] notify failed', e); }
  };
  // Claim a reminder slot: only the run that flips the flag null→now proceeds.
  const claim = async (id: number, col: string): Promise<boolean> => {
    const { data } = await supabase.from('booking_requests')
      .update({ [col]: nowIso }).eq('id', id).is(col, null).select('id');
    return !!(data && data.length);
  };

  const { data: rows } = await supabase
    .from('booking_requests')
    .select('id, renter_id, owner_id, renter_name, item_title, item_json, start_date, end_date, status, payment_status, created_at, reminder_daybefore_sent_at, reminder_startday_sent_at, reminder_return_sent_at')
    .not('status', 'in', '(cancelled,declined,completed)')
    .or(`start_date.gte.${lowerBound},end_date.gte.${lowerBound}`)
    .limit(500);

  let daybefore = 0, startday = 0, ret = 0;

  for (const b of rows ?? []) {
    // Only confirmed/active bookings — not still-pending requests.
    const active =
      ['accepted', 'confirmed'].includes(b.status) ||
      ['paid', 'cash', 'scheduled', 'delivery_confirmed'].includes(b.payment_status);
    if (!active) continue;

    const title = b.item_title || 'your rental';
    const renter = b.renter_name || 'the renter';
    const listingType = b.item_json?.listingType;

    const createdMs = b.created_at ? new Date(b.created_at).getTime() : 0;
    const startMs = b.start_date ? dayStartUTC(b.start_date) : null;
    // Due back at the END of the last rental day.
    const returnMs = b.end_date ? dayStartUTC(b.end_date) + DAY_MS : null;
    const advance = startMs != null && createdMs > 0 && (startMs - createdMs) > DAY_MS;

    // 1. Day-before start — window [start−11h, start+13h) ≈ 9am the day before
    const dayBeforeAnchor = startMs != null ? startMs - DAY_MS + ANCHOR_MS : null;
    const morningAnchor = startMs != null ? startMs + ANCHOR_MS : null;
    if (advance && dayBeforeAnchor != null && morningAnchor != null &&
        !b.reminder_daybefore_sent_at && now >= dayBeforeAnchor && now < morningAnchor) {
      if (await claim(b.id, 'reminder_daybefore_sent_at')) {
        await sendPush(b.renter_id, 'Rental starts tomorrow', `Your rental of ${title} starts tomorrow.`, `rental-soon-${b.id}`);
        await notify(b.renter_id, '⏰', `Starts tomorrow: ${title}`, 'Your rental begins tomorrow.');
        await sendPush(b.owner_id, 'Rental goes out tomorrow', `${title} goes out to ${renter} tomorrow.`, `rental-out-${b.id}`);
        await notify(b.owner_id, '⏰', `Goes out tomorrow: ${title}`, `${renter} picks up tomorrow.`);
        daybefore++;
      }
    }

    // 2. Morning-of start — window [start+13h, start+37h) ≈ 9am on the start day
    if (advance && morningAnchor != null &&
        !b.reminder_startday_sent_at && now >= morningAnchor && now < morningAnchor + DAY_MS) {
      if (await claim(b.id, 'reminder_startday_sent_at')) {
        await sendPush(b.renter_id, 'Rental starts today', `Your rental of ${title} starts today.`, `rental-today-${b.id}`);
        await notify(b.renter_id, '📅', `Starts today: ${title}`, 'Your rental begins today.');
        await sendPush(b.owner_id, 'Rental goes out today', `${title} goes out to ${renter} today.`, `rental-out-today-${b.id}`);
        await notify(b.owner_id, '📅', `Goes out today: ${title}`, `${renter} picks up today.`);
        startday++;
      }
    }

    // 3. Return due — rentals only (sales/services aren't "returned").
    // Window [returnDue−11h, returnDue+13h) ≈ 9am on the last rental day.
    const returnable = returnMs != null && listingType !== 'service' && listingType !== 'sale';
    const returnAnchor = returnMs != null ? returnMs - DAY_MS + ANCHOR_MS : null;
    if (returnable && returnAnchor != null &&
        !b.reminder_return_sent_at && now >= returnAnchor && now < returnAnchor + DAY_MS) {
      if (await claim(b.id, 'reminder_return_sent_at')) {
        await sendPush(b.renter_id, 'Return due soon', `Reminder: ${title} is due back tomorrow.`, `rental-return-${b.id}`);
        await notify(b.renter_id, '↩️', `Due back tomorrow: ${title}`, 'Please return it on time.');
        await sendPush(b.owner_id, 'Item due back tomorrow', `${title} is due back from ${renter} tomorrow.`, `rental-return-owner-${b.id}`);
        await notify(b.owner_id, '↩️', `Due back tomorrow: ${title}`, `${renter} returns it tomorrow.`);
        ret++;
      }
    }
  }

  console.log(`[booking-reminders] daybefore=${daybefore} startday=${startday} return=${ret}`);
  return new Response(JSON.stringify({ daybefore, startday, return: ret }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
