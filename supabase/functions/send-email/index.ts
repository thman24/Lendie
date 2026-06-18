import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const wrap = (body: string) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
        <tr><td style="background:#00B894;padding:20px 28px;text-align:left">
          <span style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px">Lendie</span>
        </td></tr>
        <tr><td style="padding:28px 28px 8px">${body}</td></tr>
        <tr><td style="padding:16px 28px 28px;border-top:1px solid #f0f0f0;margin-top:20px">
          <p style="margin:0;font-size:12px;color:#9ca3af">You're receiving this because you have a Lendie account. <a href="https://www.lendie.app" style="color:#00B894;text-decoration:none">Open Lendie</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { userId, subject, html } = await req.json();

    if (!userId || !subject || !html) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: corsHeaders });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      console.log('[send-email] RESEND_API_KEY not set, skipping email');
      return new Response(JSON.stringify({ skipped: true }), { headers: corsHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userErr || !user?.email) {
      console.error('[send-email] user lookup failed:', userErr?.message);
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: corsHeaders });
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Lendie <notifications@lendie.app>',
        to: [user.email],
        subject,
        html: wrap(html),
      }),
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.message || 'Resend error');

    return new Response(JSON.stringify({ sent: true, id: result.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-email] error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
