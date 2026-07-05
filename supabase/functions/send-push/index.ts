import webpush from 'npm:web-push';
import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

webpush.setVapidDetails('mailto:push@lendie.app', VAPID_PUBLIC, VAPID_PRIVATE);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const isCounterparty = async (db: any, a: string, b: string): Promise<boolean> => {
  const { data: bk } = await db.from('booking_requests').select('id')
    .or(`and(renter_id.eq.${a},owner_id.eq.${b}),and(renter_id.eq.${b},owner_id.eq.${a})`).limit(1);
  if (bk && bk.length) return true;
  const { data: msg } = await db.from('messages').select('id')
    .or(`and(from_user_id.eq.${a},to_user_id.eq.${b}),and(from_user_id.eq.${b},to_user_id.eq.${a})`).limit(1);
  return !!(msg && msg.length);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const { userId, title, body, url, tag } = await req.json();
    if (!userId) throw new Error('userId required');

    // Authorize: internal (service-role) calls trusted; otherwise the caller must
    // be a signed-in user pushing to themselves or a genuine counterparty. Stops
    // this being an open push-phishing relay.
    const authHeader = req.headers.get('Authorization') || '';
    if (authHeader !== `Bearer ${SERVICE_KEY}`) {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: { user: caller } } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
      if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return new Response(JSON.stringify({ error: 'Invalid recipient' }), { status: 400, headers: cors });
      if (caller.id !== userId && !(await isCounterparty(admin, caller.id, userId))) {
        return new Response(JSON.stringify({ sent: 0, skipped: true }), { headers: cors });
      }
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=endpoint,p256dh,auth`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const subs: { endpoint: string; p256dh: string; auth: string }[] = await res.json();

    if (!Array.isArray(subs) || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const payload = JSON.stringify({ title, body, url: url || '/', tag: tag || 'lendie' });

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    );

    // Clean up expired/invalid subscriptions
    const expired = results
      .map((r, i) =>
        r.status === 'rejected' &&
        (r.reason?.statusCode === 404 || r.reason?.statusCode === 410)
          ? subs[i].endpoint
          : null
      )
      .filter(Boolean) as string[];

    if (expired.length > 0) {
      for (const endpoint of expired) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
          { method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
        );
      }
    }

    const sent = results.filter(r => r.status === 'fulfilled').length;
    return new Response(JSON.stringify({ sent }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-push]', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
