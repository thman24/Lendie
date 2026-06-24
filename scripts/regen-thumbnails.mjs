// One-time maintenance: generate 400px thumbnails for listing photos uploaded
// before thumbnails existed. Uses sharp's .rotate() (no args) which auto-applies
// EXIF orientation exactly like the browser does, then strips the tag — so thumbs
// match how the full image displays. Safe to re-run (upserts, bumps ?v= cache-bust).
// Run with SUPABASE_URL + SERVICE_KEY in env.
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SERVICE_KEY;
const VERSION      = process.env.THUMB_VERSION || '3'; // bump to bust CDN/browser cache
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing SUPABASE_URL / SERVICE_KEY'); process.exit(1); }

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = 'listing-images';

const { data: listings, error } = await sb
  .from('listings')
  .select('id, title, uploaded_images')
  .not('uploaded_images', 'is', null);
if (error) { console.error('Query failed:', error.message); process.exit(1); }

let madeThumbs = 0, updatedRows = 0;

for (const l of listings) {
  const imgs = Array.isArray(l.uploaded_images) ? l.uploaded_images : [];
  if (!imgs.length) continue;
  let changed = false;

  for (const img of imgs) {
    if (!img?.url) continue;
    // Strip any existing ?query so we resolve the underlying object path.
    const cleanUrl = img.url.split('?')[0];
    const marker = `/${BUCKET}/`;
    const i = cleanUrl.indexOf(marker);
    if (i === -1) { console.warn('  ! odd url, skipping:', cleanUrl); continue; }
    const objectPath = cleanUrl.slice(i + marker.length);
    const thumbPath = objectPath.replace(/\.[a-z0-9]+$/i, '') + '-thumb.jpg';

    try {
      const res = await fetch(cleanUrl);
      if (!res.ok) { console.warn(`  ! download ${res.status}:`, objectPath); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const thumbBuf = await sharp(buf)
        .rotate() // auto-orient from EXIF, then drop the tag
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();

      const { error: upErr } = await sb.storage.from(BUCKET)
        .upload(thumbPath, thumbBuf, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
      if (upErr) { console.warn('  ! upload failed:', upErr.message); continue; }

      const base = sb.storage.from(BUCKET).getPublicUrl(thumbPath).data.publicUrl;
      img.thumb = `${base}?v=${VERSION}`;
      changed = true; madeThumbs++;
      console.log(`  ✓ ${l.title}: ${(thumbBuf.length/1024).toFixed(0)}KB thumb`);
    } catch (e) {
      console.warn('  ! error on', objectPath, '-', e.message);
    }
  }

  if (changed) {
    const { error: updErr } = await sb.from('listings').update({ uploaded_images: imgs }).eq('id', l.id);
    if (updErr) console.warn(`  ! row update failed for ${l.title}:`, updErr.message);
    else updatedRows++;
  }
}

console.log(`\nDone. ${madeThumbs} thumbnails created across ${updatedRows} listings (v=${VERSION}).`);
