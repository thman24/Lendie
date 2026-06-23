import { createClient } from 'npm:@supabase/supabase-js@2';

const ADMIN_ID = '8f7af82b-b44e-436f-995a-530eb24925e8';
const INDEFINITE = '876000h'; // ~100 years = "until reinstated"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    // Caller must be the admin.
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user || user.id !== ADMIN_ID) return json({ error: 'Forbidden — admin only' }, 403);

    const { action, userId, durationHours } = await req.json();
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // List currently-suspended users (so the admin UI can show badges on load).
    if (action === 'list') {
      const now = Date.now();
      const suspended: Record<string, string> = {};
      let page = 1;
      // Page through auth users (perPage max 1000).
      for (;;) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) return json({ error: error.message }, 500);
        for (const u of data.users) {
          const until = (u as { banned_until?: string }).banned_until;
          if (until && new Date(until).getTime() > now) suspended[u.id] = until;
        }
        if (data.users.length < 1000) break;
        page++;
      }
      return json({ suspended });
    }

    if (!userId) return json({ error: 'Missing userId' }, 400);
    if (userId === ADMIN_ID) return json({ error: "You can't suspend the admin account" }, 400);

    if (action === 'suspend') {
      const ban = durationHours && Number(durationHours) > 0 ? `${Math.round(Number(durationHours))}h` : INDEFINITE;
      const { data, error } = await admin.auth.admin.updateUserById(userId, { ban_duration: ban });
      if (error) return json({ error: error.message }, 500);
      // Hide their listings from the marketplace while suspended (not deleted).
      await admin.from('listings').update({ available: false }).eq('user_id', userId);
      return json({ success: true, bannedUntil: (data.user as { banned_until?: string })?.banned_until || null });
    }

    if (action === 'unsuspend') {
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      if (error) return json({ error: error.message }, 500);
      // Restore their listings to the marketplace.
      await admin.from('listings').update({ available: true }).eq('user_id', userId);
      return json({ success: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[admin-suspend-user] error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
