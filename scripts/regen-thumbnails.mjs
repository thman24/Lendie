// One-time maintenance: generate 400px thumbnails for listing photos uploaded
// before thumbnails existed. Safe to re-run (skips images that already have a
// thumb, upserts the thumb file). Run with SUPABASE_URL + SERVICE_KEY in env.
import { createClient } from '@supabase/supabase-js';
import Jimp from 'jimp';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing SUPABASE_URL / SERVICE_KEY'); process.exit(1); }

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = 'listing-images';

const { data: listings, error } = await sb
  .from('listings')
  .select('id, title, uploaded_images')
  .not('uploaded_images', 'is', null);
if (error) { console.error('Query failed:', error.message); process.exit(1); }

let madeThumbs = 0, updatedRows = 0, skipped = 0;

for (const l of listings) {
  const imgs = Array.isArray(l.uploaded_images) ? l.uploaded_images : [];
  if (!imgs.length) continue;
  let changed = false;

  for (const img of imgs) {
    if (!img?.url || img.thumb) { if (img?.thumb) skipped++; continue; }
    const marker = `/${BUCKET}/`;
    const i = img.url.indexOf(marker);
    if (i === -1) { console.warn('  ! odd url, skipping:', img.url); continue; }
    const objectPath = img.url.slice(i + marker.length);
    const thumbPath = objectPath.replace(/\.[a-z0-9]+$/i, '') + '-thumb.jpg';

    try {
      const res = await fetch(img.url);
      if (!res.ok) { console.warn(`  ! download ${res.status}:`, objectPath); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const image = await Jimp.read(buf);
      image.scaleToFit(400, 400).quality(70);
      const thumbBuf = await image.getBufferAsync(Jimp.MIME_JPEG);

      const { error: upErr } = await sb.storage.from(BUCKET)
        .upload(thumbPath, thumbBuf, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
      if (upErr) { console.warn('  ! upload failed:', upErr.message); continue; }

      img.thumb = sb.storage.from(BUCKET).getPublicUrl(thumbPath).data.publicUrl;
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

console.log(`\nDone. ${madeThumbs} thumbnails created across ${updatedRows} listings (${skipped} already had thumbs).`);
