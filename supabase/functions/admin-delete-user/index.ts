import { createClient } from 'npm:@supabase/supabase-js@2';

const ADMIN_ID = '8f7af82b-b44e-436f-995a-530eb24925e8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    // Verify the caller is the admin.
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Caller must be the owner or a granted admin.
    const isAdmin = user.id === ADMIN_ID || !!(await admin.from('admins').select('user_id').eq('user_id', user.id).maybeSingle()).data;
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden — admin only' }), { status: 403, headers: corsHeaders });
    }

    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing userId' }), { status: 400, headers: corsHeaders });
    }
    // Must be a UUID — userId is interpolated into PostgREST .or() filters below,
    // so reject anything with filter metacharacters to prevent filter injection.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(userId))) {
      return new Response(JSON.stringify({ error: 'Invalid userId' }), { status: 400, headers: corsHeaders });
    }
    if (userId === ADMIN_ID) {
      return new Response(JSON.stringify({ error: "You can't delete the owner account" }), { status: 400, headers: corsHeaders });
    }

    // Fully scrub their footprint. The admin "users" list is DERIVED from
    // listings + bookings, so these rows must be deleted (not just cancelled) or
    // the user reappears on refresh. Each is best-effort (ignore unknown-column
    // errors across schema variations) — the auth delete below is the hard part.
    await admin.from('listings').delete().eq('user_id', userId);
    await admin.from('booking_requests').delete().or(`renter_id.eq.${userId},owner_id.eq.${userId}`);
    await admin.from('messages').delete().or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);
    await admin.from('reports').delete().or(`reporter_id.eq.${userId},reported_user_id.eq.${userId}`);
    await admin.from('blocks').delete().or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
    await admin.from('notifications').delete().eq('user_id', userId);
    await admin.from('push_subscriptions').delete().eq('user_id', userId);

    // Delete the auth account (profiles cascade via FK). Ignore "not found" so a
    // listing-only / anon record still cleans up the marketplace side.
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr && !/not.*found/i.test(delErr.message)) {
      console.error('[admin-delete-user] auth delete failed:', delErr.message);
      return new Response(JSON.stringify({ error: 'Listings removed, but account deletion failed: ' + delErr.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[admin-delete-user] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
