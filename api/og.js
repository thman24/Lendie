// Vercel serverless function: per-listing Open Graph previews.
//
// A Lendie SPA can't give crawlers per-listing meta tags (the HTML is generic),
// so shared links unfurl with no photo/price. This endpoint (linked from the
// Share button as /api/og?item=<id>) fetches the listing, returns HTML whose
// og:*/twitter:* tags describe THAT listing, and redirects real browsers into
// the app. Crawlers read the tags; humans land on /?item=<id>.

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

export default async function handler(req, res) {
  const APP = 'https://www.lendie.app';
  const id = String((req.query && req.query.item) || '').replace(/[^0-9]/g, '');
  const redirect = id ? `${APP}/?item=${id}` : APP;

  let title = 'Lendie — rent, buy & hire from neighbors';
  let desc = 'Borrow tools, gear, and services from people nearby on Lendie.';
  let image = `${APP}/pwa-512x512.png`;

  try {
    const base = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_ANON_KEY;
    if (id && base && key) {
      const r = await fetch(
        `${base}/rest/v1/listings?id=eq.${id}&select=title,price,price_unit,listing_type,sale_price,uploaded_images`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const rows = await r.json();
      const l = Array.isArray(rows) && rows[0];
      if (l) {
        const unit = l.price_unit || (l.listing_type === 'service' ? 'hr' : 'day');
        const priceStr =
          l.listing_type === 'service' ? `from $${l.price}/${unit}`
          : l.listing_type === 'sale' ? `$${l.price}`
          : l.listing_type === 'both' && l.sale_price ? `$${l.price}/${unit} · buy $${l.sale_price}`
          : `$${l.price}/${unit}`;
        title = `${l.title} — ${priceStr} · Lendie`;
        desc = `${priceStr} on Lendie. Rent, buy, and hire from neighbors near you.`;
        const imgs = Array.isArray(l.uploaded_images) ? l.uploaded_images : [];
        if (imgs[0] && imgs[0].url) image = imgs[0].url;
      }
    }
  } catch (_) { /* fall back to generic preview */ }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Lendie"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:image" content="${esc(image)}"/>
<meta property="og:url" content="${esc(redirect)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${esc(image)}"/>
<meta http-equiv="refresh" content="0; url=${esc(redirect)}"/>
<script>location.replace(${JSON.stringify(redirect)});</script>
</head><body style="font-family:system-ui,sans-serif;padding:40px;text-align:center">
Redirecting to <a href="${esc(redirect)}">Lendie</a>…
</body></html>`);
}
