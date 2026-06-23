import { createClient } from 'npm:@supabase/supabase-js@2';

// The owner — always an admin, and the only one who can grant/revoke access.
const OWNER_ID = '8f7af82b-b44e-436f-995a-530eb24925e8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user || user.id !== OWNER_ID) return json({ error: 'Forbidden — owner only' }, 403);

    const { action, email, userId } = await req.json();
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === 'list') {
      const { data, error } = await admin.from('admins').select('user_id, email, added_at').order('added_at', { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ admins: data || [] });
    }

    if (action === 'add') {
      if (!email) return json({ error: 'Enter an email' }, 400);
      const target = String(email).trim().toLowerCase();
      // Find the registered user with this email.
      let found: { id: string; email?: string } | null = null;
      let page = 1;
      for (;;) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) return json({ error: error.message }, 500);
        const match = data.users.find(u => (u.email || '').toLowerCase() === target);
        if (match) { found = { id: match.id, email: match.email }; break; }
        if (data.users.length < 1000) break;
        page++;
      }
      if (!found) return json({ error: 'No Lendie account found with that email. They must sign up first.' }, 404);
      if (found.id === OWNER_ID) return json({ error: "That's the owner — already a permanent admin." }, 400);
      const { error: insErr } = await admin.from('admins').upsert({ user_id: found.id, email: found.email, added_by: OWNER_ID }, { onConflict: 'user_id' });
      if (insErr) return json({ error: insErr.message }, 500);
      return json({ success: true, admin: { user_id: found.id, email: found.email } });
    }

    if (action === 'remove') {
      if (!userId) return json({ error: 'Missing userId' }, 400);
      const { error } = await admin.from('admins').delete().eq('user_id', userId);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[admin-access] error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
